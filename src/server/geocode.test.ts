import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createPooledDb } from '@/db/connection';
import { geocodeCache } from '@/db/schema';
import { normalizeAddress, type AddressParts } from '@/lib/address';
import {
  CACHE_TTL_DAYS,
  buildQuery,
  geocodeAddress,
  geocodeExact,
  geocodeOnce,
  fallbackWarning,
  outcomeFor,
  type CensusMatch,
} from './geocode';
import type { Tx } from './audit';

const url = process.env.DATABASE_URL;
const withDb = url ? describe : describe.skip;

let handle: ReturnType<typeof createPooledDb> | null = null;
const connect = () => (handle ??= createPooledDb(url!));
afterAll(async () => {
  await handle?.client.end({ timeout: 5 });
});

async function rolledBack<T>(body: (tx: Tx) => Promise<T>): Promise<T> {
  const { db } = connect();
  let out: T;
  try {
    await db.transaction(async (tx) => {
      out = await body(tx);
      tx.rollback();
    });
  } catch (error) {
    if (out! === undefined) throw error;
  }
  return out!;
}

/**
 * The street is deliberately one no real dispatcher would type.
 *
 * `geocode_cache` is a real table these tests read through, and the
 * transaction they run in does not hide rows COMMITTED outside it. When the
 * fixture used a genuine address, the production backfill cached that exact
 * key and every call-count assertion silently started reading a live cache
 * hit instead of the mock — six tests went green-to-red the moment real data
 * existed. A fixture address the application can never produce cannot collide.
 */
const address: AddressParts = {
  addressLine: '1804 Vitest Fixture Street',
  city: 'Grand Forks',
  state: 'ND',
  zip: '58203',
};
const cityOnly: AddressParts = {
  addressLine: null,
  city: 'Grand Forks',
  state: 'ND',
  zip: null,
};

/**
 * A Census `addressMatches` entry, shaped as the live service returns one.
 * Verified against https://geocoding.geo.census.gov/geocoder/locations/address
 * rather than written from the documentation.
 */
function match(over: {
  lat?: number;
  lng?: number;
  city?: string;
  state?: string;
  zip?: string;
  from?: string;
  to?: string;
  matchedAddress?: string;
}): CensusMatch {
  return {
    /**
     * The SAME street the fixture types, in Census's own spelling.
     *
     * This defaulted to `1804 N WASHINGTON ST` against a typed
     * `1804 Vitest Fixture Street` — a pairing no real response could
     * produce, which nothing noticed because nothing compared the two. Once
     * §12.55's guard existed, nine tests failed on a fixture that had been
     * describing a wrong-street match all along.
     */
    matchedAddress: over.matchedAddress ?? '1804 VITEST FIXTURE ST, GRAND FORKS, ND, 58203',
    // x is LONGITUDE, y is latitude. Backwards puts the fleet in the ocean.
    coordinates: { x: over.lng ?? -97.057369, y: over.lat ?? 47.936987 },
    tigerLine: { side: 'R' },
    addressComponents: {
      fromAddress: over.from ?? '1800',
      toAddress: over.to ?? '1818',
      city: over.city ?? 'GRAND FORKS',
      state: over.state ?? 'ND',
      zip: over.zip ?? '58203',
    },
  };
}

/* ------------------------------ the request ------------------------------ */

describe('buildQuery', () => {
  it('sends the address as STRUCTURED fields, not one concatenated string', () => {
    const q = buildQuery(address);
    expect(q.get('street')).toBe('1804 Vitest Fixture Street');
    expect(q.get('city')).toBe('Grand Forks');
    expect(q.get('state')).toBe('ND');
    expect(q.get('zip')).toBe('58203');
    // Concatenating them just to make the provider re-split them is where
    // "1804 North Washington Street" becomes a match on "Washington".
    expect(q.get('address')).toBeNull();
  });

  it('pins the current public address-range benchmark', () => {
    expect(buildQuery(address).get('benchmark')).toBe('Public_AR_Current');
  });

  it('asks for JSON', () => {
    expect(buildQuery(address).get('format')).toBe('json');
  });

  it('carries no API key, because the service needs none', () => {
    const q = buildQuery(address).toString().toLowerCase();
    expect(q).not.toContain('key');
    expect(q).not.toContain('token');
  });
});

/* ---------------------------- the confidence cutoff ---------------------- */

describe('the cutoff', () => {
  it('accepts a match whose components agree with what was typed', () => {
    const out = outcomeFor([match({})], address);
    expect(out.ok).toBe(true);
    expect(out.ok && out.precision).toBe('street');
    expect(out.ok && out.lat).toBeCloseTo(47.936987, 5);
    expect(out.ok && out.lng).toBeCloseTo(-97.057369, 5);
  });

  it('never claims rooftop precision, because the provider cannot give it', () => {
    // TIGER interpolates along a street segment. `street` is the honest tier.
    const out = outcomeFor([match({})], address);
    expect(out.ok && out.precision).not.toBe('rooftop');
  });

  it('records the signal it actually had, not a borrowed grade', () => {
    const out = outcomeFor([match({})], address);
    expect(out.ok && out.confidence).toBe('census:in-range');
    expect(out.ok && out.confidence).not.toMatch(/^(exact|high|medium|low)$/);
  });

  it('reports no results as its own reason, not as low confidence', () => {
    const out = outcomeFor([], address);
    expect(!out.ok && out.reason).toBe('no-results');
  });

  /**
   * Census IGNORES components that disagree rather than reporting them, which
   * is the whole reason agreement is checked here. Measured against the live
   * service: state=TX with a Grand Forks street still returned the ND match.
   */
  it('refuses a match in a different state', () => {
    const out = outcomeFor([match({ state: 'ND' })], { ...address, state: 'TX' });
    expect(out.ok).toBe(false);
    expect(!out.ok && out.reason).toBe('low-confidence');
    expect(!out.ok && out.unmatched).toContain('the state');
  });

  /** Measured: "200 Center Street, Chicago IL" returns WEST CHICAGO. */
  it('refuses a match in a different city when the ZIP cannot vouch for it', () => {
    const out = outcomeFor(
      [match({ city: 'WEST CHICAGO', state: 'IL', zip: '60185' })],
      { addressLine: '200 Center Street', city: 'Chicago', state: 'IL', zip: null },
    );
    expect(out.ok).toBe(false);
    expect(!out.ok && out.unmatched).toContain('the city');
  });

  /**
   * City OR ZIP, not both. Measured: "5500 E 56th Ave, Denver CO 80216"
   * legitimately matches ZIP 80022 — the typed ZIP was simply wrong, and the
   * match is good.
   */
  it('accepts a corrected ZIP when the city still agrees', () => {
    const out = outcomeFor(
      [
        match({
          city: 'DENVER',
          state: 'CO',
          zip: '80022',
          // The same street, in Census's spelling — this test is about the
          // ZIP, and a fixture that also changed the street would now be
          // refused for the other reason (§12.55).
          matchedAddress: '5500 E 56TH AVE, DENVER, CO, 80022',
        }),
      ],
      { addressLine: '5500 East 56th Avenue', city: 'Denver', state: 'CO', zip: '80216' },
    );
    expect(out.ok).toBe(true);
    // Recorded, because the input and the answer disagreed about something.
    expect(out.ok && out.confidence).toBe('census:zip-differs');
  });

  it('accepts a differently-spelled city when the ZIP agrees', () => {
    const out = outcomeFor(
      [
        match({
          city: 'SAINT PAUL',
          state: 'MN',
          zip: '55101',
          matchedAddress: '100 MAIN ST, SAINT PAUL, MN, 55101',
        }),
      ],
      { addressLine: '100 Main Street', city: 'St. Paul', state: 'MN', zip: '55101' },
    );
    expect(out.ok).toBe(true);
  });
});

/* ----------------------------- the runner-up veto ------------------------ */

/**
 * The veto SURVIVED the provider swap, simplified. Census returns no
 * confidence, so the old "equally confident runner-up" precondition became
 * vacuous and the rule is now distance alone — kept rather than deleted
 * because it still fires on real responses.
 */
describe('the runner-up veto', () => {
  it('refuses two matches in different places', () => {
    const out = outcomeFor(
      [
        match({ matchedAddress: 'VITEST FIXTURE ST, GRAND FORKS, ND' }),
        match({
          lat: 44.9778,
          lng: -93.265,
          matchedAddress: 'VITEST FIXTURE ST, MINNEAPOLIS, MN',
        }),
      ],
      address,
    );
    expect(out.ok).toBe(false);
    expect(!out.ok && out.reason).toBe('ambiguous');
    expect(!out.ok && out.detail).toContain('MINNEAPOLIS');
  });

  /** Measured: "1 Broadway, New York" returns two, 0.1 mi apart. One street. */
  it('allows the same street returned as two ZIP segments', () => {
    const out = outcomeFor(
      [match({}), match({ lat: 47.938, lng: -97.0575, zip: '58201' })],
      address,
    );
    expect(out.ok).toBe(true);
  });
});

/* -------------------------------- transport ------------------------------ */

describe('geocodeExact (one call, no fallback)', () => {
  const ok = (matches: CensusMatch[]) =>
    vi.fn(
      async () =>
        new Response(JSON.stringify({ result: { addressMatches: matches } }), { status: 200 }),
    );

  it('never calls the provider for an empty address', async () => {
    const fetchImpl = ok([]);
    const out = await geocodeExact(
      { addressLine: null, city: null, state: null, zip: null },
      { fetchImpl },
    );
    expect(!out.ok && out.reason).toBe('empty-address');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  /**
   * Measured: city-only input is HTTP 400 from Census, not a coarse match.
   * Spending a call to be told so is a call wasted, so it short-circuits.
   */
  it('refuses city-only input without spending a call', async () => {
    const fetchImpl = ok([]);
    const out = await geocodeExact(cityOnly, { fetchImpl });
    expect(!out.ok && out.reason).toBe('no-street');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns a timeout as a timeout, not as a crash', async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error('The operation was aborted due to timeout');
      error.name = 'TimeoutError';
      throw error;
    });
    const out = await geocodeExact(address, { fetchImpl });
    expect(!out.ok && out.reason).toBe('timeout');
  });

  it('turns a provider 500 into a miss, never an exception', async () => {
    const fetchImpl = vi.fn(async () => new Response('upstream boom', { status: 500 }));
    await expect(geocodeExact(address, { fetchImpl })).resolves.toMatchObject({
      ok: false,
      reason: 'provider-error',
    });
  });

  it('turns the service\u2019s own 400 into a miss', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('{"errors":["Street address cannot be empty"],"status":"400"}', {
          status: 400,
        }),
    );
    const out = await geocodeExact(address, { fetchImpl });
    expect(!out.ok && out.reason).toBe('provider-error');
  });

  it('treats an unreadable body as a provider error', async () => {
    const fetchImpl = vi.fn(async () => new Response('not json', { status: 200 }));
    const out = await geocodeExact(address, { fetchImpl });
    expect(!out.ok && out.reason).toBe('provider-error');
  });

  it('reads x as longitude and y as latitude', async () => {
    const out = await geocodeExact(address, {
      fetchImpl: ok([match({ lat: 47.9, lng: -97.05 })]),
    });
    expect(out.ok && out.lat).toBeCloseTo(47.9, 5);
    expect(out.ok && out.lng).toBeCloseTo(-97.05, 5);
  });
});

/* --------------------------------- caching ------------------------------- */

withDb('the cache', () => {
  const hit = (lat = 47.936987) =>
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ result: { addressMatches: [match({ lat })] } }),
          { status: 200 },
        ),
    );

  it('spends one call for the same address entered twice', async () => {
    const calls = await rolledBack(async (tx) => {
      const fetchImpl = hit();
      await geocodeAddress(tx as never, address, { fetchImpl });
      await geocodeAddress(tx as never, address, { fetchImpl });
      return fetchImpl.mock.calls.length;
    });
    expect(calls).toBe(1);
  });

  it('treats a differently-typed version of the same address as one call', async () => {
    const calls = await rolledBack(async (tx) => {
      const fetchImpl = hit();
      await geocodeAddress(tx as never, address, { fetchImpl });
      await geocodeAddress(
        tx as never,
        { ...address, city: 'grand forks', zip: '58203-1234' },
        { fetchImpl },
      );
      return fetchImpl.mock.calls.length;
    });
    expect(calls).toBe(1);
  });

  /**
   * A genuine miss needs an address with NO usable ZIP. Since §12.30 a ZIP
   * that the gazetteer carries always produces a `zip` hit, so the only way
   * left to miss entirely is to have nothing to fall back to.
   *
   * The first attempt costs 5 calls — one exact, four street probes — and the
   * second costs nothing, which is the property being asserted.
   */
  const unresolvable: AddressParts = {
    addressLine: '1804 Vitest Fixture Street',
    city: 'Nowhere',
    state: 'ND',
    zip: null,
  };

  it('caches a miss, so a typo does not buy a call on every save', async () => {
    const result = await rolledBack(async (tx) => {
      const fetchImpl = vi.fn(
        async () =>
          new Response(JSON.stringify({ result: { addressMatches: [] } }), { status: 200 }),
      );
      await geocodeAddress(tx as never, unresolvable, { fetchImpl });
      const second = await geocodeAddress(tx as never, unresolvable, { fetchImpl });
      const [row] = await tx
        .select()
        .from(geocodeCache)
        .where(eq(geocodeCache.normalizedAddress, normalizeAddress(unresolvable)));
      return { calls: fetchImpl.mock.calls.length, second, row };
    });
    // 1 exact + 4 probes on the first attempt, nothing at all on the second.
    expect(result.calls).toBe(5);
    expect(result.second.ok).toBe(false);
    expect(result.row?.lat).toBeNull();
    expect(result.row?.missReason).toBe('no-results');
  });

  it('expires a miss sooner than a hit', async () => {
    const out = await rolledBack(async (tx) => {
      const fetchImpl = vi.fn(
        async () =>
          new Response(JSON.stringify({ result: { addressMatches: [] } }), { status: 200 }),
      );
      const start = new Date('2026-09-01T12:00:00Z');
      await geocodeAddress(tx as never, unresolvable, { fetchImpl, now: start });

      const withinMissTtl = new Date(start.getTime() + (CACHE_TTL_DAYS.miss - 1) * 86_400_000);
      await geocodeAddress(tx as never, unresolvable, { fetchImpl, now: withinMissTtl });
      const afterMissTtl = new Date(start.getTime() + (CACHE_TTL_DAYS.miss + 1) * 86_400_000);
      await geocodeAddress(tx as never, unresolvable, { fetchImpl, now: afterMissTtl });
      return fetchImpl.mock.calls.length;
    });
    // One attempt on the way in, none inside the TTL, one after it lapsed.
    expect(out).toBe(10);
  });

  it('re-fetches a hit once it passes the 30-day storage TTL', async () => {
    const out = await rolledBack(async (tx) => {
      const fetchImpl = hit();
      const start = new Date('2026-09-01T12:00:00Z');
      await geocodeAddress(tx as never, address, { fetchImpl, now: start });

      const fresh = new Date(start.getTime() + (CACHE_TTL_DAYS.hit - 1) * 86_400_000);
      await geocodeAddress(tx as never, address, { fetchImpl, now: fresh });
      const stale = new Date(start.getTime() + (CACHE_TTL_DAYS.hit + 1) * 86_400_000);
      await geocodeAddress(tx as never, address, { fetchImpl, now: stale });
      return fetchImpl.mock.calls.length;
    });
    expect(out).toBe(2);
  });

  /**
   * A transient failure is a property of the SERVICE, not of the address.
   *
   * This replaces a test about a licence refusal, which was a Mapbox concern
   * and cannot happen here — Census imposes no storage restriction. The
   * principle survives and matters MORE with a free government service that
   * can be briefly unavailable: caching "Census was down at 14:02" for a week
   * would keep a perfectly good address unlocatable long after it came back.
   */
  it('never caches a transient provider failure', async () => {
    // Wrapped in an object: `rolledBack` cannot tell a body that returns
    // undefined from one that threw, and "no row" is exactly undefined here.
    const { row } = await rolledBack(async (tx) => {
      const fetchImpl = vi.fn(async () => new Response('gateway timeout', { status: 504 }));
      const out = await geocodeAddress(tx as never, address, { fetchImpl });
      expect(!out.ok && out.reason).toBe('provider-error');
      const found = await tx
        .select()
        .from(geocodeCache)
        .where(eq(geocodeCache.normalizedAddress, normalizeAddress(address)));
      return { row: found[0] };
    });
    expect(row).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------
 * §12.30 — the fallback chain
 * ---------------------------------------------------------------------- */

describe('the fallback chain', () => {
  const ELWOOD: AddressParts = {
    addressLine: '26416 S Walton Dr',
    city: 'Elwood',
    state: 'IL',
    zip: '60421',
  };

  /** Census has neither the address nor any number on that street. */
  const nothingEver = () =>
    vi.fn(
      async () =>
        new Response(JSON.stringify({ result: { addressMatches: [] } }), { status: 200 }),
    );

  /**
   * Census has the street but not the typed number: the probe numbers match,
   * the real one does not. This is the Laraway Road / Fulton Industrial case.
   */
  const onlyProbeNumbers = () =>
    vi.fn(async (url: string | URL | Request) => {
      const street = new URL(String(url)).searchParams.get('street') ?? '';
      const probed = /^(200|500|1000|4000)\s/.test(street);
      const body = probed
        ? {
            result: {
              addressMatches: [
                {
                  matchedAddress: `${street.split(' ')[0]} S WALTON DR, ELWOOD, IL, 60421`,
                  // Nudged per probe so "nearest block" is observable.
                  coordinates: { x: -88.2 + Number(street.split(' ')[0]) / 100000, y: 41.4 },
                  addressComponents: { city: 'ELWOOD', state: 'IL', zip: '60421' },
                },
              ],
            },
          }
        : { result: { addressMatches: [] } };
      return new Response(JSON.stringify(body), { status: 200 });
    });

  it('falls all the way to the ZIP centroid when the street does not exist', async () => {
    const fetchImpl = nothingEver();
    const out = await geocodeOnce(ELWOOD, { fetchImpl });

    expect(out.ok).toBe(true);
    expect(out.ok && out.precision).toBe('zip');
    // Elwood IL, from the vendored 2023 gazetteer.
    expect(out.ok && out.lat).toBeCloseTo(41.41, 1);
    expect(out.ok && out.accuracyMiles).toBeGreaterThan(3);
    expect(out.ok && out.confidence).toContain('zcta-centroid');
    // 1 exact + 4 probes. The probes only ever run after a miss.
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it('prefers the nearest block when the street DOES exist', async () => {
    const fetchImpl = onlyProbeNumbers();
    const out = await geocodeOnce(ELWOOD, { fetchImpl });

    expect(out.ok && out.precision).toBe('block');
    // 26416 typed; 4000 is the nearest of {200,500,1000,4000}.
    expect(out.ok && out.confidence).toBe('census:block-4000');
    expect(out.ok && out.matchedAddress).toContain('not in Census');
  });

  it('spends exactly one call when the address geocodes normally', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ result: { addressMatches: [match({})] } }), {
          status: 200,
        }),
    );
    const out = await geocodeOnce(address, { fetchImpl });
    expect(out.ok && out.precision).toBe('street');
    // The common case must not pay for the rare one.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  /**
   * A refused match is not a missing one. The dispatcher typed a wrong state
   * or city and needs to see that — a centroid quietly standing in would hide
   * the very error §12.24's cutoff exists to surface.
   */
  it('does NOT fall back when the match was refused rather than absent', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            result: { addressMatches: [match({ city: 'WEST CHICAGO', zip: '60185' })] },
          }),
          { status: 200 },
        ),
    );
    const out = await geocodeOnce(
      { addressLine: '200 Center Street', city: 'Chicago', state: 'IL', zip: null },
      { fetchImpl },
    );
    expect(out.ok).toBe(false);
    expect(!out.ok && out.reason).toBe('low-confidence');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('falls back to the ZIP even with no street typed, if a ZIP was', async () => {
    const fetchImpl = nothingEver();
    const out = await geocodeOnce(
      { addressLine: null, city: 'Elwood', state: 'IL', zip: '60421' },
      { fetchImpl },
    );
    expect(out.ok && out.precision).toBe('zip');
    // No street means no exact attempt and no probes: zero calls.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('still misses when there is no street AND no usable ZIP', async () => {
    const fetchImpl = nothingEver();
    const out = await geocodeOnce(
      { addressLine: null, city: 'Elwood', state: 'IL', zip: null },
      { fetchImpl },
    );
    expect(out.ok).toBe(false);
  });
});

/* -------------------------------------------------------------------------
 * §12.76 — a refusal on the street alone continues down the chain
 * ---------------------------------------------------------------------- */

describe('a street-only refusal', () => {
  /**
   * Truck 138, measured against the live service: every other block of 20th
   * Ave SE is in TIGER under its own name, but 2300 comes back on a segment
   * named 20TH ST SE — same town, same ZIP, a different street type.
   */
  const MINOT: AddressParts = {
    addressLine: '2300 20th Ave SE',
    city: 'Minot',
    state: 'ND',
    zip: '58701',
  };

  const minotMatch = (matchedAddress: string, lng: number): CensusMatch =>
    match({
      matchedAddress,
      lat: 48.211,
      lng,
      city: 'MINOT',
      state: 'ND',
      zip: '58701',
    });

  /**
   * Shaped on the live answers. 1000 is the trap: Census answers it with
   * 20TH AVE **SW**, and it is nearer 2300 than 4000 is — so a probe that
   * skipped the street guard would win and put the stop across town.
   */
  const minotCensus = (probesLand = true) =>
    vi.fn(async (url: string | URL | Request) => {
      const street = new URL(String(url)).searchParams.get('street') ?? '';
      const number = street.split(' ')[0];
      const matches: CensusMatch[] =
        number === '2300'
          ? [minotMatch('2300 20TH ST SE, MINOT, ND, 58701', -101.26359)]
          : !probesLand
            ? []
            : number === '1000'
              ? [minotMatch('1000 20TH AVE SW, MINOT, ND, 58701', -101.31162)]
              : [minotMatch(`${number} 20TH AVE SE, MINOT, ND, 58701`, -101.3 + Number(number) / 30000)];
      return new Response(JSON.stringify({ result: { addressMatches: matches } }), { status: 200 });
    });

  it('is marked as street-only when state, city and ZIP all agree', () => {
    const out = outcomeFor([minotMatch('2300 20TH ST SE, MINOT, ND, 58701', -101.26)], MINOT);
    expect(!out.ok && out.reason).toBe('low-confidence');
    expect(!out.ok && out.streetRefusal).toEqual({
      matchedAddress: '2300 20TH ST SE, MINOT, ND, 58701',
      unmatched: ['the street type (AVE vs ST)'],
    });
  });

  it('is NOT street-only when the place disagrees as well', () => {
    const wrongState = outcomeFor(
      [match({ state: 'MN', matchedAddress: '1804 OTHER ST, GRAND FORKS, MN, 58203' })],
      address,
    );
    expect(!wrongState.ok && wrongState.unmatched).toContain('the state');
    expect(!wrongState.ok && wrongState.streetRefusal).toBeNull();

    const wrongCity = outcomeFor(
      [match({ city: 'WEST CHICAGO', zip: '60185', matchedAddress: '200 CENTRE AVE, WEST CHICAGO, IL, 60185' })],
      { addressLine: '200 Center Street', city: 'Chicago', state: 'IL', zip: null },
    );
    expect(!wrongCity.ok && wrongCity.unmatched).toContain('the city');
    expect(!wrongCity.ok && wrongCity.streetRefusal).toBeNull();
  });

  it('falls to the nearest block on the TYPED street, and says why', async () => {
    const fetchImpl = minotCensus();
    const out = await geocodeOnce(MINOT, { fetchImpl });

    expect(out.ok && out.precision).toBe('block');
    // 4000, not 1000: the 1000 probe matched 20TH AVE SW and the guard
    // refused it, exactly as it refused the address itself.
    expect(out.ok && out.confidence).toBe('census:block-4000');
    expect(out.ok && out.matchedAddress).toContain('20TH AVE SE');
    expect(out.ok && out.streetRefusal?.matchedAddress).toBe('2300 20TH ST SE, MINOT, ND, 58701');
    // 1 exact + 4 probes.
    expect(fetchImpl).toHaveBeenCalledTimes(5);

    const warning = out.ok ? fallbackWarning(out) : null;
    expect(warning).toMatch(/only matched loosely/);
    expect(warning).toContain('nearest block');
    expect(warning).toContain('the street type (AVE vs ST)');
    expect(warning).toContain('2300 20TH ST SE');
  });

  it('falls on to the ZIP centre when no block on the typed street exists', async () => {
    const out = await geocodeOnce(MINOT, { fetchImpl: minotCensus(false) });
    expect(out.ok && out.precision).toBe('zip');
    expect(out.ok && out.streetRefusal?.unmatched).toEqual(['the street type (AVE vs ST)']);
    expect(out.ok ? fallbackWarning(out) : null).toMatch(/only matched loosely.*ZIP code's centre \(±8\.7 mi\)/);
  });

  it('gives an ordinary hit no warning at all', () => {
    const out = outcomeFor([match({})], address);
    expect(out.ok ? fallbackWarning(out) : 'miss').toBeNull();
  });

  /**
   * The Moorhead ND/MN typo. Moorhead is in Minnesota; Census ignores the
   * typed ND and answers with the MN address. That refusal must stop the
   * chain in ONE call — no probes, no centroid — however the street compares.
   */
  describe('the Moorhead rule is unchanged', () => {
    const MOORHEAD_ND: AddressParts = {
      addressLine: '2500 N 11th St',
      city: 'Moorhead',
      state: 'ND',
      zip: '56560',
    };
    const answers = (matchedAddress: string) =>
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              result: {
                addressMatches: [
                  match({ matchedAddress, city: 'MOORHEAD', state: 'MN', zip: '56560', lat: 46.9, lng: -96.77 }),
                ],
              },
            }),
            { status: 200 },
          ),
      );

    it('refuses a wrong state immediately, with no fallback', async () => {
      const fetchImpl = answers('2500 11TH ST N, MOORHEAD, MN, 56560');
      const out = await geocodeOnce(MOORHEAD_ND, { fetchImpl });
      expect(out.ok).toBe(false);
      expect(!out.ok && out.reason).toBe('low-confidence');
      expect(!out.ok && out.unmatched).toContain('the state');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('still refuses immediately when the street ALSO differs', async () => {
      const fetchImpl = answers('2500 11TH AVE N, MOORHEAD, MN, 56560');
      const out = await geocodeOnce(MOORHEAD_ND, { fetchImpl });
      expect(out.ok).toBe(false);
      expect(!out.ok && out.unmatched).toEqual(
        expect.arrayContaining(['the state', expect.stringMatching(/street type/)]),
      );
      expect(!out.ok && out.streetRefusal).toBeNull();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * The second stop at the same address is served from the cache, and must
   * warn exactly as the first did — or next week's load to the same customer
   * gets a coarse point in silence.
   */
  withDb('through the cache', () => {
    const FIXTURE: AddressParts = {
      addressLine: '2300 Vitest Fixture Ave SE',
      city: 'Minot',
      state: 'ND',
      zip: '58701',
    };
    const fixtureCensus = () =>
      vi.fn(async (url: string | URL | Request) => {
        const number = (new URL(String(url)).searchParams.get('street') ?? '').split(' ')[0];
        const matched =
          number === '2300'
            ? minotMatch('2300 VITEST FIXTURE ST SE, MINOT, ND, 58701', -101.26)
            : minotMatch(`${number} VITEST FIXTURE AVE SE, MINOT, ND, 58701`, -101.25);
        return new Response(JSON.stringify({ result: { addressMatches: [matched] } }), {
          status: 200,
        });
      });

    it('keeps the refusal, so a cached fallback still warns', async () => {
      const result = await rolledBack(async (tx) => {
        const fetchImpl = fixtureCensus();
        const first = await geocodeAddress(tx as never, FIXTURE, { fetchImpl });
        const second = await geocodeAddress(tx as never, FIXTURE, { fetchImpl });
        const [row] = await tx
          .select()
          .from(geocodeCache)
          .where(eq(geocodeCache.normalizedAddress, normalizeAddress(FIXTURE)));
        return { first, second, row, calls: fetchImpl.mock.calls.length };
      });

      expect(result.calls).toBe(5);
      expect(result.row?.precision).toBe('block');
      expect(result.row?.refusedMatch).toBe('2300 VITEST FIXTURE ST SE, MINOT, ND, 58701');
      expect(result.second).toEqual(result.first);
      expect(result.second.ok ? fallbackWarning(result.second) : null).toMatch(
        /only matched loosely.*street type \(AVE vs ST\)/,
      );
    });

    it('is refused by the database on a miss row', async () => {
      const error: unknown = await rolledBack(async (tx) => {
        await tx.insert(geocodeCache).values({
          normalizedAddress: 'VITEST|REFUSAL|ON|MISS',
          missReason: 'low-confidence',
          refusedMatch: '1 SOMEWHERE ST',
          provider: 'vitest',
        });
        return 'inserted';
      }).catch((e: unknown) => e);
      // Drizzle wraps the Postgres error; the constraint name is on the cause.
      expect(String((error as { cause?: unknown }).cause)).toContain('geocode_cache_refusal_on_hit');
    });
  });
});
