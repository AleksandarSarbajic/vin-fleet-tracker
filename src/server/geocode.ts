import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from './audit';
import { geocodeCache } from '@/db/schema';
import { hasStreetLine, isAddressEmpty, normalizeAddress, type AddressParts } from '@/lib/address';

/**
 * Forward geocoding, server-side only, one call per stop whose address
 * changed (§12.24).
 *
 * This is the ONLY file that talks to a geocoding provider. Everything else
 * takes coordinates as data.
 *
 * It never throws. A provider that is down, slow, out of quota, refusing our
 * licence terms or simply unable to find a warehouse must not be able to stop
 * a dispatcher saving a stop — the stop saves with null coordinates and the
 * board falls back to the clock, which is exactly what it did before this
 * file existed.
 *
 * The token is PASSED IN rather than read from `serverEnv` here. That keeps
 * the env boundary in one place, keeps this file free of `server-only` so it
 * can be unit tested, and makes "which token is this call spending?" visible
 * at the call site — which matters when one of the two Mapbox tokens in this
 * project ships to browsers and the other must never leave the server.
 */

/* --------------------------------- policy -------------------------------- */

const ENDPOINT = 'https://api.mapbox.com/search/geocode/v6/forward';

/**
 * A slow vendor must not become "the app is down". The geocode runs BEFORE
 * the transaction opens, so this timeout bounds a dispatcher's save, not a
 * held pooler connection.
 */
const TIMEOUT_MS = 2_500;

/**
 * Hits expire at 30 days, misses at 7.
 *
 * 30 days is the licence path, not a performance one: if the Mapbox account
 * cannot grant `permanent=true`, storage has to be a cache rather than a
 * record, and a 30-day TTL makes it one. Coordinates re-derive from an
 * address we already own, so expiry costs one call per stop per month — which
 * at 20-40 stops a day is nothing. Built regardless of how the account
 * answers, so the answer stops mattering.
 *
 * Misses expire sooner because a miss is usually a typo. Caching a typo for a
 * month keeps punishing the corrected version.
 */
export const CACHE_TTL_DAYS = { hit: 30, miss: 7 } as const;

/**
 * Two candidates this close are the same place ranked twice; further apart
 * they are different places and the top one is a guess. See `outcomeFor`.
 */
const AMBIGUITY_MILES = 1;

/* -------------------------------- outcomes ------------------------------- */

export type GeocodeMiss =
  | 'not-configured'
  | 'empty-address'
  | 'no-results'
  | 'low-confidence'
  | 'ambiguous'
  | 'provider-error'
  | 'timeout'
  /** The account cannot store results. We refuse to keep them. */
  | 'permanent-refused';

export interface GeocodeHit {
  ok: true;
  lat: number;
  lng: number;
  precision: 'rooftop' | 'city';
  confidence: string;
  matchedAddress: string;
}

export interface GeocodeFailure {
  ok: false;
  reason: GeocodeMiss;
  /** Which components the provider could not match — named in the warning. */
  unmatched: string[];
  detail: string | null;
}

export type GeocodeOutcome = GeocodeHit | GeocodeFailure;

const fail = (
  reason: GeocodeMiss,
  unmatched: string[] = [],
  detail: string | null = null,
): GeocodeFailure => ({ ok: false, reason, unmatched, detail });

/** What the modal shows. Never an error — a stop with no coordinates is valid. */
export const MISS_MESSAGE: Record<GeocodeMiss, string> = {
  'not-configured': 'The geocoder is not configured, so this stop has no ETA.',
  'empty-address': 'No address to locate, so this stop has no ETA.',
  'no-results': 'This address could not be located, so the stop has no ETA.',
  'low-confidence': 'This address only matched loosely, so no ETA was projected.',
  ambiguous: 'This address matched more than one place, so no ETA was projected.',
  'provider-error': 'The address lookup failed, so this stop has no ETA yet.',
  timeout: 'The address lookup timed out, so this stop has no ETA yet.',
  'permanent-refused':
    'The address was found but the Mapbox account does not permit storing it, ' +
    'so it was discarded. Nobody can project an ETA until this is fixed.',
};

/* ----------------------------- provider parsing -------------------------- */

/**
 * Only the fields we act on. Parsed rather than trusted: this is the one
 * place in the app where a third party's JSON becomes a number a dispatcher
 * acts on, and `properties.coordinates.latitude` being absent must read as
 * "no result", not as `undefined` flowing into a distance calculation.
 */
const MatchCode = z.object({
  address_number: z.string().optional(),
  street: z.string().optional(),
  postcode: z.string().optional(),
  place: z.string().optional(),
  region: z.string().optional(),
  confidence: z.enum(['exact', 'high', 'medium', 'low']),
});

const Feature = z.object({
  properties: z.object({
    feature_type: z.string().optional(),
    full_address: z.string().optional(),
    name: z.string().optional(),
    coordinates: z.object({
      latitude: z.number(),
      longitude: z.number(),
    }),
    match_code: MatchCode.optional(),
  }),
});

const MapboxResponse = z.object({ features: z.array(Feature).default([]) });

export type MapboxFeature = z.infer<typeof Feature>;

/* ------------------------------ the decision ----------------------------- */

const EARTH_MILES = 3958.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

const NAMED = {
  address_number: 'the street number',
  street: 'the street',
  postcode: 'the ZIP',
  place: 'the city',
  region: 'the state',
} as const;

/**
 * The confidence cutoff, exported so the tests read as a table rather than as
 * a sequence of fetch stubs.
 *
 *   typed street + city/state -> `exact` or `high`, AND address_number and
 *                                street both matched -> `rooftop`
 *   typed city/state only     -> `exact` or `high` on a place result -> `city`
 *   anything else             -> refused
 *
 * Two tiers rather than one threshold because the ERROR MATTERS DIFFERENTLY
 * by distance: a city centroid is a couple of miles out, which is noise on a
 * 400-mile run and nonsense on a 12-mile one. Recording which kind we got
 * lets the row say "±5 mi" instead of implying a precision we do not have,
 * and lets a future rule treat a city-precision LATE more cautiously than a
 * rooftop one before it sends a dispatcher to a broker.
 */
export function outcomeFor(features: MapboxFeature[], wantsRooftop: boolean): GeocodeOutcome {
  const top = features[0];
  if (!top) return fail('no-results');

  const code = top.properties.match_code;
  const confidence = code?.confidence ?? 'low';
  const strong = confidence === 'exact' || confidence === 'high';

  const unmatched = code
    ? (Object.keys(NAMED) as (keyof typeof NAMED)[])
        .filter((k) => code[k] === 'unmatched')
        .map((k) => NAMED[k])
    : [];

  if (!strong) return fail('low-confidence', unmatched, `confidence: ${confidence}`);

  const numberMatched = code?.address_number === 'matched';
  const streetMatched = code?.street === 'matched';

  // A street was typed but the provider matched something coarser. Returning
  // its city centroid as if it were the warehouse is exactly the "confident
  // wrong match" this cutoff exists to refuse.
  if (wantsRooftop && !(numberMatched && streetMatched)) {
    return fail(
      'low-confidence',
      unmatched.length > 0 ? unmatched : ['the street number'],
      'street did not match; refused rather than falling back to the city',
    );
  }

  const precision: 'rooftop' | 'city' = wantsRooftop ? 'rooftop' : 'city';
  const lat = top.properties.coordinates.latitude;
  const lng = top.properties.coordinates.longitude;

  // The runner-up veto. Mapbox ranks, so #1 is the answer — the danger is not
  // choosing badly between distinct candidates but a TIE: the same street
  // name, equally confident, in two different towns. Close together means one
  // place ranked twice and #1 is fine.
  const second = features[1];
  const secondConfidence = second?.properties.match_code?.confidence;
  if (second && secondConfidence === confidence) {
    const apart = milesBetween(
      { lat, lng },
      {
        lat: second.properties.coordinates.latitude,
        lng: second.properties.coordinates.longitude,
      },
    );
    if (apart > AMBIGUITY_MILES) {
      return fail(
        'ambiguous',
        [],
        `${top.properties.full_address ?? 'one match'} and ` +
          `${second.properties.full_address ?? 'another'} are ${Math.round(apart)} mi apart`,
      );
    }
  }

  return {
    ok: true,
    lat,
    lng,
    precision,
    confidence,
    matchedAddress: top.properties.full_address ?? top.properties.name ?? '',
  };
}

/* ------------------------------- the request ----------------------------- */

/** Visible for testing: the exact query we send. */
export function buildQuery(parts: AddressParts, token: string): URLSearchParams {
  const query = new URLSearchParams();
  if (parts.addressLine) query.set('address_line1', parts.addressLine);
  if (parts.city) query.set('place', parts.city);
  if (parts.state) query.set('region', parts.state);
  if (parts.zip) query.set('postcode', parts.zip);

  // US only, per the brief's operating area.
  query.set('country', 'us');
  // Ask for what was typed. Requesting `address` for a city-only stop returns
  // an arbitrary street in that city, which would look like a rooftop match.
  query.set('types', hasStreetLine(parts) ? 'address' : 'place,locality');
  // Enough to see a runner-up without paying for a page of them.
  query.set('limit', '5');
  // We store the result, so we must ask for the terms that allow storing it.
  // If the account cannot grant this, Mapbox refuses and we discard the
  // result rather than keeping it under temporary terms.
  query.set('permanent', 'true');
  query.set('access_token', token);
  return query;
}

type Fetcher = typeof fetch;

export interface GeocodeOptions {
  /** `serverEnv.MAPBOX_GEOCODING_TOKEN`. Undefined degrades to a miss. */
  token: string | undefined;
  fetchImpl?: Fetcher;
  /** Injected so the TTL tests do not depend on wall-clock time. */
  now?: Date;
}

/** The network half, with no cache and no database. Exported for tests. */
export async function geocodeOnce(
  parts: AddressParts,
  options: GeocodeOptions,
): Promise<GeocodeOutcome> {
  const { token } = options;
  if (!token) return fail('not-configured');
  if (isAddressEmpty(parts)) return fail('empty-address');

  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`${ENDPOINT}?${buildQuery(parts, token).toString()}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
  } catch (error: unknown) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return fail(timedOut ? 'timeout' : 'provider-error', [], messageOf(error));
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    // The licence refusal, surfaced loudly rather than worked around. The
    // only correct response to "you may not store this" is not to store it.
    if (isPermanentRefusal(response.status, body)) {
      console.error(
        'MAPBOX PERMANENT GEOCODING REFUSED — coordinates were found and ' +
          'DISCARDED, because storing them without `permanent=true` would ' +
          'breach the terms. No stop will get an ETA until the Mapbox ' +
          'account grants permanent geocoding.',
        { status: response.status, body: body.slice(0, 300) },
      );
      return fail('permanent-refused', [], `HTTP ${response.status}`);
    }
    return fail('provider-error', [], `HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  const parsed = MapboxResponse.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return fail('provider-error', [], 'unreadable response');

  return outcomeFor(parsed.data.features, hasStreetLine(parts));
}

function isPermanentRefusal(status: number, body: string): boolean {
  if (status !== 401 && status !== 403 && status !== 422) return false;
  return /permanent/i.test(body);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* --------------------------------- caching -------------------------------- */

/**
 * Cache-then-network. The cache key is the NORMALISED address, so the same DC
 * entered two different ways costs one call.
 *
 * A `permanent-refused` result is never cached: it is a configuration fault,
 * not a fact about the address, and caching it would keep the board broken
 * for a week after the account is fixed.
 */
export async function geocodeAddress(
  db: Db,
  parts: AddressParts,
  options: GeocodeOptions,
): Promise<GeocodeOutcome> {
  if (isAddressEmpty(parts)) return fail('empty-address');

  const key = normalizeAddress(parts);
  const now = options.now ?? new Date();

  const [cached] = await db
    .select()
    .from(geocodeCache)
    .where(eq(geocodeCache.normalizedAddress, key))
    .limit(1);

  if (cached) {
    const ageDays = (now.getTime() - cached.fetchedAt.getTime()) / 86_400_000;
    const ttl = cached.lat === null ? CACHE_TTL_DAYS.miss : CACHE_TTL_DAYS.hit;
    if (ageDays < ttl) {
      if (cached.lat !== null && cached.lng !== null && cached.precision !== null) {
        return {
          ok: true,
          lat: cached.lat,
          lng: cached.lng,
          precision: cached.precision,
          confidence: cached.confidence ?? 'cached',
          matchedAddress: cached.matchedAddress ?? '',
        };
      }
      return fail((cached.missReason ?? 'no-results') as GeocodeMiss, [], 'from cache');
    }
  }

  const fresh = await geocodeOnce(parts, options);

  // Not cached: a misconfiguration is not a property of this address, and
  // neither is a transient provider failure.
  if (!fresh.ok && (fresh.reason === 'permanent-refused' || fresh.reason === 'not-configured')) {
    return fresh;
  }

  const row = fresh.ok
    ? {
        normalizedAddress: key,
        lat: fresh.lat,
        lng: fresh.lng,
        precision: fresh.precision,
        confidence: fresh.confidence,
        matchedAddress: fresh.matchedAddress,
        missReason: null,
        fetchedAt: now,
      }
    : {
        normalizedAddress: key,
        lat: null,
        lng: null,
        precision: null,
        confidence: null,
        matchedAddress: null,
        missReason: fresh.reason,
        fetchedAt: now,
      };

  await db
    .insert(geocodeCache)
    .values(row)
    .onConflictDoUpdate({ target: geocodeCache.normalizedAddress, set: row });

  return fresh;
}

/** Drops expired rows. Called by the backfill script; safe to run any time. */
export async function sweepGeocodeCache(db: Db): Promise<number> {
  const result = await db
    .delete(geocodeCache)
    .where(
      sql`(${geocodeCache.lat} is null
             and ${geocodeCache.fetchedAt} < now() - ${`${CACHE_TTL_DAYS.miss} days`}::interval)
          or (${geocodeCache.lat} is not null
             and ${geocodeCache.fetchedAt} < now() - ${`${CACHE_TTL_DAYS.hit} days`}::interval)`,
    )
    .returning({ key: geocodeCache.normalizedAddress });
  return result.length;
}
