import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from './audit';
import { geocodeCache } from '@/db/schema';
import { hasStreetLine, isAddressEmpty, normalizeAddress, type AddressParts } from '@/lib/address';
import { ZIP_CENTROID_VINTAGE, zipCentroid } from '@/lib/geo/zip-centroid';

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

/**
 * The US Census Bureau geocoder — locations/address, structured input.
 *
 * Chosen over a commercial provider because the fleet is US-only and every
 * stop is a US street address, so its coverage fits the whole problem. No API
 * key, no card, and no storage restriction — which removes the
 * permanent-vs-temporary licensing question rather than paying to resolve it,
 * and removes a spend-cap risk on an account with no hard cap.
 *
 * The tradeoff is coverage: TIGER is weaker than a commercial geocoder on
 * very new industrial addresses. The no-ETA fallback absorbs that, which is
 * why the fallback was built before the provider.
 */
const ENDPOINT = 'https://geocoding.geo.census.gov/geocoder/locations/address';

/** Current public address ranges. The service's own default, pinned anyway. */
const BENCHMARK = 'Public_AR_Current';

/**
 * A slow vendor must not become "the app is down". The geocode runs BEFORE
 * the transaction opens, so this timeout bounds a dispatcher's save, not a
 * held pooler connection.
 *
 * Census is a free government service with no published rate limit. It can be
 * slow or briefly unavailable, and when it is, that is a warning and a saved
 * stop with no coordinates — never a failed save.
 */
const TIMEOUT_MS = 2_500;

/**
 * Hits expire at 30 days, misses at 7.
 *
 * Census imposes no storage restriction, so this is no longer a licence path
 * — it is freshness. TIGER gains addresses between releases, so a miss today
 * may resolve next month, and a hit can be superseded by a better range.
 * Kept at 30/7 because re-deriving costs one free call per stop per month.
 *
 * Misses expire sooner because a miss is usually a typo. Caching a typo for a
 * month keeps punishing the corrected version.
 */
export const CACHE_TTL_DAYS = { hit: 30, miss: 7 } as const;

/**
 * What produced a cache row. Bumped whenever the CHAIN changes, not just the
 * provider — a row is only reusable if it would be reached the same way today.
 *
 * This is not bookkeeping. When the ZIP fallback landed, every address that
 * had previously missed was sitting in the cache as a miss with days left on
 * its TTL, so the new fallback would not have run for any of them until the
 * following week. Stale misses are the failure mode a cache has that a bug
 * does not: it keeps working, at the old answer.
 */
export const CHAIN_VERSION = 'census-v6+block+zcta2023+accuracy';

/**
 * Two matches this far apart are different places and the top one is a guess.
 *
 * The veto SURVIVED the provider swap in simplified form. Census returns no
 * confidence, so the old "equally confident runner-up" precondition became
 * vacuous — the rule is now distance alone. It still fires: `1 Broadway, New
 * York` returns two matches 0.1 mi apart (one street, two ZIP segments), which
 * passes, while two genuinely different places do not.
 */
const AMBIGUITY_MILES = 1;

/**
 * House numbers probed on the same street when the typed one does not match
 * (§12.30).
 *
 * Census requires a house number — a bare street name always returns zero
 * matches, measured — so the only way to learn whether a street exists is to
 * try numbers on it.
 *
 * These four were chosen by measurement, not taste. Probing ten numbers
 * across four known streets, the ones that landed were:
 *
 *     W Buckeye Rd, Phoenix        1, 50, 200, 500, 1000, 2000, 4000, 8000
 *     N Washington St, Grand Forks 1, 50, 200, 500, 1000, 2000, 4000, 8000
 *     Fulton Industrial Blvd SW    200, 1000, 4000
 *     Laraway Rd, New Lenox        500
 *     Walton Dr, Elwood            none — the street is genuinely absent
 *
 * {200, 500, 1000, 4000} is the smallest set that finds all four real streets
 * and still finds nothing on the absent one. One probe would have missed
 * Fulton; two would have been luck.
 *
 * They run in PARALLEL, so the cost is four calls but one round trip —
 * about 0.7 s measured — and only ever on an address that already failed.
 */
const PROBE_NUMBERS = [200, 500, 1000, 4000] as const;

/* -------------------------------- outcomes ------------------------------- */

export type GeocodeMiss =
  | 'empty-address'
  /** Census requires a street; city-only input is rejected outright. */
  | 'no-street'
  | 'no-results'
  | 'low-confidence'
  | 'ambiguous'
  | 'provider-error'
  | 'timeout';

export interface GeocodeHit {
  ok: true;
  lat: number;
  lng: number;
  precision: 'street' | 'block' | 'zip';
  /** The ± to show a dispatcher. Only meaningful below `street`. */
  accuracyMiles?: number;
  /**
   * What the signal actually was, not a fabricated grade. Census returns no
   * confidence value, so inventing an `exact` here would be dressing a
   * coarser signal in the previous provider's clothes.
   */
  confidence: string;
  matchedAddress: string;
}

export interface GeocodeFailure {
  ok: false;
  reason: GeocodeMiss;
  /** Which components disagreed — named in the warning. */
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
  'empty-address': 'No address to locate, so this stop has no ETA.',
  'no-street':
    'A street address is needed to locate this stop, so it has no ETA. ' +
    'City and state alone cannot be placed.',
  'no-results': 'This address could not be located, so the stop has no ETA.',
  'low-confidence': 'This address only matched loosely, so no ETA was projected.',
  ambiguous: 'This address matched more than one place, so no ETA was projected.',
  'provider-error': 'The address lookup failed, so this stop has no ETA yet.',
  timeout: 'The address lookup timed out, so this stop has no ETA yet.',
};

/* ----------------------------- provider parsing -------------------------- */

/**
 * Only the fields we act on. Parsed rather than trusted: this is the one
 * place in the app where a third party's JSON becomes a number a dispatcher
 * acts on, and a missing coordinate must read as "no result" rather than as
 * `undefined` flowing into a distance calculation.
 *
 * Note `coordinates` is {x, y} — x is LONGITUDE. Getting that backwards puts
 * every truck in the Indian Ocean, which is at least loud.
 */
const AddressMatch = z.object({
  matchedAddress: z.string().optional(),
  coordinates: z.object({ x: z.number(), y: z.number() }),
  tigerLine: z.object({ side: z.string().optional() }).optional(),
  addressComponents: z
    .object({
      fromAddress: z.string().optional(),
      toAddress: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      zip: z.string().optional(),
    })
    .optional(),
});

const CensusResponse = z.object({
  result: z.object({ addressMatches: z.array(AddressMatch).default([]) }),
});

export type CensusMatch = z.infer<typeof AddressMatch>;

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

const same = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const norm = (v: string | null | undefined) =>
    (v ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
  const left = norm(a);
  return left !== '' && left === norm(b);
};

/** The 5-digit ZIP, so a typed ZIP+4 compares against a returned ZIP5. */
const zip5 = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '').slice(0, 5);

/**
 * The cutoff.
 *
 * ## Why this checks components itself
 *
 * The previous provider returned a `match_code` reporting each component
 * matched or unmatched. **Census returns nothing of the kind, and worse, it
 * silently ignores components that disagree.** Both measured against the live
 * service:
 *
 *     street=1804 North Washington Street city=Grand Forks state=TX
 *       -> 1804 N WASHINGTON ST, GRAND FORKS, ND, 58203   (wrong state, answered)
 *
 *     street=200 Center Street city=Chicago state=IL
 *       -> 200 CENTER ST, WEST CHICAGO, IL, 60185         (different city)
 *
 * So agreement is checked here or it is not checked at all, and an unchecked
 * match is exactly the confident wrong number this cutoff exists to refuse.
 *
 * ## The rule
 *
 * - `state` must agree. Hard.
 * - `city` OR `zip` must agree — not both. Legitimate disagreement happens in
 *   each direction: `5500 E 56th Ave, Denver CO 80216` correctly matches ZIP
 *   80022, and a `St. Paul` / `SAINT PAUL` spelling differs while the ZIP
 *   holds. BOTH disagreeing is the West Chicago case above.
 *
 * Erring toward refusal is deliberate: a refusal costs an ETA, an acceptance
 * costs a WRONG ETA, and only one of those sends a dispatcher somewhere.
 */
export function outcomeFor(matches: CensusMatch[], typed: AddressParts): GeocodeOutcome {
  const top = matches[0];
  if (!top) return fail('no-results');

  const parts = top.addressComponents;
  const unmatched: string[] = [];

  if (typed.state && !same(typed.state, parts?.state)) unmatched.push('the state');

  const cityAgrees = same(typed.city, parts?.city);
  const zipAgrees = zip5(typed.zip) !== '' && zip5(typed.zip) === zip5(parts?.zip);
  if (!cityAgrees && !zipAgrees) {
    if (typed.city) unmatched.push('the city');
    if (typed.zip) unmatched.push('the ZIP');
  }

  if (unmatched.length > 0) {
    return fail(
      'low-confidence',
      unmatched,
      `matched ${top.matchedAddress ?? 'something else'} instead`,
    );
  }

  const lat = top.coordinates.y;
  const lng = top.coordinates.x;

  // The runner-up veto, on distance alone — see AMBIGUITY_MILES.
  const second = matches[1];
  if (second) {
    const apart = milesBetween({ lat, lng }, { lat: second.coordinates.y, lng: second.coordinates.x });
    if (apart > AMBIGUITY_MILES) {
      return fail(
        'ambiguous',
        [],
        `${top.matchedAddress ?? 'one match'} and ${second.matchedAddress ?? 'another'} ` +
          `are ${Math.round(apart)} mi apart`,
      );
    }
  }

  return {
    ok: true,
    lat,
    lng,
    // Census never returns a parcel point. See the enum comment in schema.ts.
    precision: 'street',
    confidence: zipAgrees ? 'census:in-range' : 'census:zip-differs',
    matchedAddress: top.matchedAddress ?? '',
  };
}

/* ------------------------------- the request ----------------------------- */

/** Visible for testing: the exact query we send. */
export function buildQuery(parts: AddressParts): URLSearchParams {
  const query = new URLSearchParams();
  // Structured input, not a concatenated one-liner: we hold the fields
  // separately already, and re-splitting them is where "1804 North Washington
  // Street" becomes a match on "Washington".
  if (parts.addressLine) query.set('street', parts.addressLine);
  if (parts.city) query.set('city', parts.city);
  if (parts.state) query.set('state', parts.state);
  if (parts.zip) query.set('zip', parts.zip);
  query.set('benchmark', BENCHMARK);
  query.set('format', 'json');
  return query;
}

type Fetcher = typeof fetch;

export interface GeocodeOptions {
  /**
   * No token, deliberately. Census needs no key, so there is no
   * `not-configured` state and nothing to thread from the environment — the
   * option and its miss reason were both removed rather than left as
   * plumbing that can never carry anything.
   */
  fetchImpl?: Fetcher;
  /** Injected so the TTL tests do not depend on wall-clock time. */
  now?: Date;
}

/** One exact-address attempt. No fallback, no cache, no database. */
export async function geocodeExact(
  parts: AddressParts,
  options: GeocodeOptions = {},
): Promise<GeocodeOutcome> {
  if (isAddressEmpty(parts)) return fail('empty-address');
  // Measured: city-only input is HTTP 400, not a coarse match. Spending a
  // call to be told so is a call wasted.
  if (!hasStreetLine(parts)) return fail('no-street', ['the street']);

  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`${ENDPOINT}?${buildQuery(parts).toString()}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
  } catch (error: unknown) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return fail(timedOut ? 'timeout' : 'provider-error', [], messageOf(error));
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    return fail('provider-error', [], `HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  const parsed = CensusResponse.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return fail('provider-error', [], 'unreadable response');

  return outcomeFor(parsed.data.result.addressMatches, parts);
}

/* ------------------------------ the fallbacks ---------------------------- */

/**
 * The whole chain: exact address, then the street, then the ZIP (§12.30).
 *
 * Ordered by how much it claims to know, and each step is only reached
 * because the one above it found nothing. A stop that geocodes normally —
 * the common case — costs exactly one call and never touches any of this.
 */
export async function geocodeOnce(
  parts: AddressParts,
  options: GeocodeOptions = {},
): Promise<GeocodeOutcome> {
  if (isAddressEmpty(parts)) return fail('empty-address');

  // 1. The address as typed.
  const exact = hasStreetLine(parts)
    ? await geocodeExact(parts, options)
    : fail('no-street', ['the street']);

  // Only `no-results` falls through. A LOW-CONFIDENCE or AMBIGUOUS match
  // means Census found something and we refused it — falling back would be
  // answering a question the cutoff already answered, and the dispatcher
  // needs to see that their state or city is wrong (§12.24), not a centroid
  // quietly standing in for it.
  if (exact.ok || (exact.reason !== 'no-results' && exact.reason !== 'no-street')) {
    return exact;
  }

  // 2. Is the street there at all? Four numbers, in parallel, one round trip.
  if (hasStreetLine(parts)) {
    const block = await probeStreet(parts, options);
    if (block) return block;
  }

  // 3. The ZIP centroid. No network: a vendored static file, so the last
  //    resort cannot fail because someone else's service is down.
  const centroid = zipCentroid(parts.zip);
  if (centroid) {
    return {
      ok: true,
      lat: centroid.lat,
      lng: centroid.lng,
      precision: 'zip',
      accuracyMiles: centroid.radiusMiles,
      confidence: `census:zcta-centroid-${ZIP_CENTROID_VINTAGE}`,
      matchedAddress: `ZIP ${parts.zip} centroid (±${centroid.radiusMiles.toFixed(1)} mi)`,
    };
  }

  return exact;
}

/**
 * Whether the street exists, and if so the nearest block to what was typed.
 *
 * Returns null when no probe lands, which is the honest reading of "Census
 * does not have this street" — the Elwood intermodal case.
 */
async function probeStreet(
  parts: AddressParts,
  options: GeocodeOptions,
): Promise<GeocodeHit | null> {
  const typedNumber = Number.parseInt((parts.addressLine ?? '').trim(), 10);

  const settled = await Promise.all(
    PROBE_NUMBERS.map(async (number) => {
      const street = withHouseNumber(parts.addressLine, number);
      if (!street) return null;
      const outcome = await geocodeExact({ ...parts, addressLine: street }, options);
      return outcome.ok ? { number: number as number, outcome } : null;
    }),
  );

  const landed = settled.filter(
    (r): r is NonNullable<(typeof settled)[number]> => r !== null,
  );
  if (landed.length === 0) return null;

  /**
   * NEAREST to the typed number, not the first to answer.
   *
   * This is the entire value of the step. Taking any hit puts you at an
   * arbitrary point on a road that can be nine miles long — measured, on
   * W Buckeye Rd — which is worse than the ZIP centroid. Taking the nearest
   * block measured 0.16–0.78 mi from truth on every address that could be
   * checked.
   */
  const best = Number.isFinite(typedNumber)
    ? landed.reduce((a, b) =>
        Math.abs(a.number - typedNumber) <= Math.abs(b.number - typedNumber) ? a : b,
      )
    : landed[0]!;

  return {
    ...best.outcome,
    precision: 'block',
    // Half the gap to the next probe is a fair statement of what we know.
    accuracyMiles: 0.8,
    confidence: `census:block-${best.number}`,
    matchedAddress: `${best.outcome.matchedAddress} (nearest block; ${typedNumber || 'the number'} is not in Census's range)`,
  };
}

/** Swaps the leading house number, keeping the street as typed. */
function withHouseNumber(addressLine: string | null, number: number): string | null {
  const line = (addressLine ?? '').trim();
  if (line === '') return null;
  const withoutNumber = line.replace(/^\s*\d+\s*/, '').trim();
  return withoutNumber === '' ? null : `${number} ${withoutNumber}`;
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
  options: GeocodeOptions = {},
): Promise<GeocodeOutcome> {
  if (isAddressEmpty(parts)) return fail('empty-address');

  const key = normalizeAddress(parts);
  const now = options.now ?? new Date();

  const [cached] = await db
    .select()
    .from(geocodeCache)
    .where(eq(geocodeCache.normalizedAddress, key))
    .limit(1);

  // A row from an older chain is not a fact about the address, it is a fact
  // about code that no longer exists.
  if (cached && cached.provider === CHAIN_VERSION) {
    const ageDays = (now.getTime() - cached.fetchedAt.getTime()) / 86_400_000;
    const ttl = cached.lat === null ? CACHE_TTL_DAYS.miss : CACHE_TTL_DAYS.hit;
    if (ageDays < ttl) {
      if (cached.lat !== null && cached.lng !== null && cached.precision !== null) {
        return {
          ok: true,
          lat: cached.lat,
          lng: cached.lng,
          precision: cached.precision,
          ...(cached.accuracyMiles !== null ? { accuracyMiles: cached.accuracyMiles } : {}),
          confidence: cached.confidence ?? 'cached',
          matchedAddress: cached.matchedAddress ?? '',
        };
      }
      return fail((cached.missReason ?? 'no-results') as GeocodeMiss, [], 'from cache');
    }
  }

  const fresh = await geocodeOnce(parts, options);

  /**
   * A transient failure is a property of the SERVICE, not of the address.
   * Caching "Census was down at 14:02" for a week would keep a perfectly
   * good address unlocatable long after the service came back.
   *
   * Census is a free government service with no published rate limit and no
   * uptime guarantee, so this branch matters more here than it did with a
   * paid provider.
   */
  if (!fresh.ok && (fresh.reason === 'provider-error' || fresh.reason === 'timeout')) {
    return fresh;
  }

  const row = fresh.ok
    ? {
        normalizedAddress: key,
        lat: fresh.lat,
        lng: fresh.lng,
        precision: fresh.precision,
        accuracyMiles: fresh.accuracyMiles ?? null,
        confidence: fresh.confidence,
        matchedAddress: fresh.matchedAddress,
        missReason: null,
        provider: CHAIN_VERSION,
        fetchedAt: now,
      }
    : {
        normalizedAddress: key,
        lat: null,
        lng: null,
        precision: null,
        accuracyMiles: null,
        confidence: null,
        matchedAddress: null,
        missReason: fresh.reason,
        provider: CHAIN_VERSION,
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
