import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createPooledDb } from '@/db/connection';
import { geocodeCache } from '@/db/schema';
import { normalizeAddress, type AddressParts } from '@/lib/address';
import {
  CACHE_TTL_DAYS,
  buildQuery,
  geocodeAddress,
  geocodeOnce,
  outcomeFor,
  type MapboxFeature,
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

const TOKEN = 'sk.test-token';

const address: AddressParts = {
  addressLine: '1804 North Washington Street',
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

/** A Mapbox v6 feature, shaped exactly as the API returns one. */
function feature(over: {
  lat?: number;
  lng?: number;
  confidence?: 'exact' | 'high' | 'medium' | 'low';
  address_number?: string;
  street?: string;
  full_address?: string;
}): MapboxFeature {
  return {
    properties: {
      full_address: over.full_address ?? '1804 N Washington St, Grand Forks, ND 58203',
      coordinates: { latitude: over.lat ?? 47.9253, longitude: over.lng ?? -97.0329 },
      match_code: {
        confidence: over.confidence ?? 'exact',
        ...(over.address_number !== undefined ? { address_number: over.address_number } : {}),
        ...(over.street !== undefined ? { street: over.street } : {}),
      },
    },
  };
}

const matched = { address_number: 'matched', street: 'matched' } as const;

/* ------------------------------ the request ------------------------------ */

describe('buildQuery', () => {
  it('sends the address as STRUCTURED fields, not one concatenated string', () => {
    const q = buildQuery(address, TOKEN);
    expect(q.get('address_line1')).toBe('1804 North Washington Street');
    expect(q.get('place')).toBe('Grand Forks');
    expect(q.get('region')).toBe('ND');
    expect(q.get('postcode')).toBe('58203');
    // Concatenating them just to make the provider re-split them is where
    // "1804 North Washington Street" becomes a match on "Washington".
    expect(q.get('q')).toBeNull();
  });

  it('restricts to US results', () => {
    expect(buildQuery(address, TOKEN).get('country')).toBe('us');
  });

  it('asks for the kind of place that was actually typed', () => {
    expect(buildQuery(address, TOKEN).get('types')).toBe('address');
    // Asking for `address` with no street returns an arbitrary street in that
    // city, which would arrive looking like a rooftop match.
    expect(buildQuery(cityOnly, TOKEN).get('types')).toBe('place,locality');
  });

  it('asks for the terms that permit storing the result', () => {
    expect(buildQuery(address, TOKEN).get('permanent')).toBe('true');
  });

  it('asks for enough results to see a runner-up', () => {
    expect(Number(buildQuery(address, TOKEN).get('limit'))).toBeGreaterThan(1);
  });
});

/* ---------------------------- the confidence cutoff ---------------------- */

describe('the confidence cutoff', () => {
  it('accepts an exact rooftop match when a street was typed', () => {
    const out = outcomeFor([feature({ confidence: 'exact', ...matched })], true);
    expect(out.ok && out.precision).toBe('rooftop');
    expect(out.ok && out.lat).toBeCloseTo(47.9253, 4);
  });

  it('accepts `high` as well as `exact`', () => {
    expect(outcomeFor([feature({ confidence: 'high', ...matched })], true).ok).toBe(true);
  });

  it.each(['medium', 'low'] as const)('refuses `%s`', (confidence) => {
    const out = outcomeFor([feature({ confidence, ...matched })], true);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.reason).toBe('low-confidence');
  });

  /**
   * The failure this cutoff exists for: Mapbox is confident, but confident
   * about the CITY, because it could not match the street. Returning its
   * centroid as the warehouse is a confident wrong number, which is worse
   * than no number at all.
   */
  it('refuses a confident match that did not match the street', () => {
    const out = outcomeFor(
      [feature({ confidence: 'exact', address_number: 'unmatched', street: 'matched' })],
      true,
    );
    expect(out.ok).toBe(false);
    expect(!out.ok && out.reason).toBe('low-confidence');
    expect(!out.ok && out.unmatched).toContain('the street number');
  });

  it('accepts a city centroid when only a city was typed', () => {
    const out = outcomeFor([feature({ confidence: 'exact' })], false);
    expect(out.ok && out.precision).toBe('city');
  });

  it('names what it could not match, for the warning', () => {
    const out = outcomeFor(
      [feature({ confidence: 'low', address_number: 'unmatched', street: 'unmatched' })],
      true,
    );
    expect(!out.ok && out.unmatched).toEqual(['the street number', 'the street']);
  });

  it('reports no results as its own reason, not as low confidence', () => {
    const out = outcomeFor([], true);
    expect(!out.ok && out.reason).toBe('no-results');
  });
});

/* ----------------------------- the runner-up veto ------------------------ */

describe('the runner-up veto', () => {
  it('refuses two equally confident matches in different places', () => {
    const out = outcomeFor(
      [
        feature({ confidence: 'exact', ...matched, full_address: 'Washington St, Grand Forks ND' }),
        feature({
          confidence: 'exact',
          ...matched,
          lat: 44.9778,
          lng: -93.265,
          full_address: 'Washington St, Minneapolis MN',
        }),
      ],
      true,
    );
    expect(out.ok).toBe(false);
    expect(!out.ok && out.reason).toBe('ambiguous');
    expect(!out.ok && out.detail).toContain('Minneapolis');
  });

  it('allows the same place ranked twice', () => {
    const out = outcomeFor(
      [
        feature({ confidence: 'exact', ...matched }),
        // ~0.1 mi away: one warehouse, two entrances.
        feature({ confidence: 'exact', ...matched, lat: 47.9267, lng: -97.0329 }),
      ],
      true,
    );
    expect(out.ok).toBe(true);
  });

  it('ignores a WEAKER runner-up — a tie is the risk, not a second guess', () => {
    const out = outcomeFor(
      [
        feature({ confidence: 'exact', ...matched }),
        feature({ confidence: 'low', lat: 44.9778, lng: -93.265 }),
      ],
      true,
    );
    expect(out.ok).toBe(true);
  });
});

/* -------------------------------- transport ------------------------------ */

describe('geocodeOnce', () => {
  const ok = (features: MapboxFeature[]) =>
    vi.fn(async () => new Response(JSON.stringify({ features }), { status: 200 }));

  it('degrades to a miss when no token is configured', async () => {
    const out = await geocodeOnce(address, { token: undefined, fetchImpl: ok([]) });
    expect(!out.ok && out.reason).toBe('not-configured');
  });

  it('never calls the provider for an empty address', async () => {
    const fetchImpl = ok([]);
    const out = await geocodeOnce(
      { addressLine: null, city: null, state: null, zip: null },
      { token: TOKEN, fetchImpl },
    );
    expect(!out.ok && out.reason).toBe('empty-address');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns a timeout as a timeout, not as a crash', async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error('The operation was aborted due to timeout');
      error.name = 'TimeoutError';
      throw error;
    });
    const out = await geocodeOnce(address, { token: TOKEN, fetchImpl });
    expect(!out.ok && out.reason).toBe('timeout');
  });

  it('turns a provider 500 into a miss, never an exception', async () => {
    const fetchImpl = vi.fn(async () => new Response('upstream boom', { status: 500 }));
    await expect(geocodeOnce(address, { token: TOKEN, fetchImpl })).resolves.toMatchObject({
      ok: false,
      reason: 'provider-error',
    });
  });

  /**
   * The licence path. The only correct response to "you may not store this"
   * is not to store it — the coordinates are discarded even though the
   * provider found them.
   */
  it('discards a result the account may not store', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchImpl = vi.fn(
      async () =>
        new Response('{"message":"Permanent geocoding is not enabled for this account"}', {
          status: 403,
        }),
    );
    const out = await geocodeOnce(address, { token: TOKEN, fetchImpl });
    expect(!out.ok && out.reason).toBe('permanent-refused');
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('treats an unreadable body as a provider error', async () => {
    const fetchImpl = vi.fn(async () => new Response('not json', { status: 200 }));
    const out = await geocodeOnce(address, { token: TOKEN, fetchImpl });
    expect(!out.ok && out.reason).toBe('provider-error');
  });
});

/* --------------------------------- caching ------------------------------- */

withDb('the cache', () => {
  const hit = (lat = 47.9253) =>
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ features: [feature({ lat, confidence: 'exact', ...matched })] }),
          { status: 200 },
        ),
    );

  it('spends one call for the same address entered twice', async () => {
    const calls = await rolledBack(async (tx) => {
      const fetchImpl = hit();
      await geocodeAddress(tx as never, address, { token: TOKEN, fetchImpl });
      await geocodeAddress(tx as never, address, { token: TOKEN, fetchImpl });
      return fetchImpl.mock.calls.length;
    });
    expect(calls).toBe(1);
  });

  it('treats a differently-typed version of the same address as one call', async () => {
    const calls = await rolledBack(async (tx) => {
      const fetchImpl = hit();
      await geocodeAddress(tx as never, address, { token: TOKEN, fetchImpl });
      await geocodeAddress(
        tx as never,
        { ...address, city: 'grand forks', zip: '58203-1234' },
        { token: TOKEN, fetchImpl },
      );
      return fetchImpl.mock.calls.length;
    });
    expect(calls).toBe(1);
  });

  it('caches a miss, so a typo does not buy a call on every save', async () => {
    const result = await rolledBack(async (tx) => {
      const fetchImpl = vi.fn(
        async () => new Response(JSON.stringify({ features: [] }), { status: 200 }),
      );
      await geocodeAddress(tx as never, address, { token: TOKEN, fetchImpl });
      const second = await geocodeAddress(tx as never, address, { token: TOKEN, fetchImpl });
      const [row] = await tx
        .select()
        .from(geocodeCache)
        .where(eq(geocodeCache.normalizedAddress, normalizeAddress(address)));
      return { calls: fetchImpl.mock.calls.length, second, row };
    });
    expect(result.calls).toBe(1);
    expect(result.second.ok).toBe(false);
    expect(result.row?.lat).toBeNull();
    expect(result.row?.missReason).toBe('no-results');
  });

  it('expires a miss sooner than a hit', async () => {
    const out = await rolledBack(async (tx) => {
      const fetchImpl = vi.fn(
        async () => new Response(JSON.stringify({ features: [] }), { status: 200 }),
      );
      const start = new Date('2026-09-01T12:00:00Z');
      await geocodeAddress(tx as never, address, { token: TOKEN, fetchImpl, now: start });

      const withinMissTtl = new Date(start.getTime() + (CACHE_TTL_DAYS.miss - 1) * 86_400_000);
      await geocodeAddress(tx as never, address, { token: TOKEN, fetchImpl, now: withinMissTtl });
      const afterMissTtl = new Date(start.getTime() + (CACHE_TTL_DAYS.miss + 1) * 86_400_000);
      await geocodeAddress(tx as never, address, { token: TOKEN, fetchImpl, now: afterMissTtl });
      return fetchImpl.mock.calls.length;
    });
    // One on the way in, none inside the TTL, one after it lapsed.
    expect(out).toBe(2);
  });

  it('re-fetches a hit once it passes the 30-day storage TTL', async () => {
    const out = await rolledBack(async (tx) => {
      const fetchImpl = hit();
      const start = new Date('2026-09-01T12:00:00Z');
      await geocodeAddress(tx as never, address, { token: TOKEN, fetchImpl, now: start });

      const fresh = new Date(start.getTime() + (CACHE_TTL_DAYS.hit - 1) * 86_400_000);
      await geocodeAddress(tx as never, address, { token: TOKEN, fetchImpl, now: fresh });
      const stale = new Date(start.getTime() + (CACHE_TTL_DAYS.hit + 1) * 86_400_000);
      await geocodeAddress(tx as never, address, { token: TOKEN, fetchImpl, now: stale });
      return fetchImpl.mock.calls.length;
    });
    expect(out).toBe(2);
  });

  /**
   * A licence refusal is a configuration fault, not a fact about the address.
   * Caching it would keep the board broken for a week after the account is
   * fixed.
   */
  it('never caches a permanent-storage refusal', async () => {
    // Wrapped in an object: `rolledBack` cannot tell a body that returns
    // undefined from one that threw, and "no row" is exactly undefined here.
    const { row } = await rolledBack(async (tx) => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const fetchImpl = vi.fn(
        async () => new Response('{"message":"permanent geocoding not enabled"}', { status: 403 }),
      );
      await geocodeAddress(tx as never, address, { token: TOKEN, fetchImpl });
      error.mockRestore();
      const found = await tx
        .select()
        .from(geocodeCache)
        .where(eq(geocodeCache.normalizedAddress, normalizeAddress(address)));
      return { row: found[0] };
    });
    expect(row).toBeUndefined();
  });
});
