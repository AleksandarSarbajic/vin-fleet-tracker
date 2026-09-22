import { describe, expect, it, vi } from 'vitest';
import { HereRouting } from './provider';
import { ROUTE_PROVIDER } from '@/lib/routing';

/**
 * §12.59. Shaped from REAL responses, captured against the live API with our
 * own key before any of this was written — truck 135's actual lane, Chicago
 * to Phoenix:
 *
 *   transportMode=truck   HTTP 200   length 2876905 m   duration 93705 s
 *   transportMode=car     HTTP 200   length 2805987 m   duration 88904 s
 *   Honolulu -> Chicago   HTTP 200   {"notices":[{"code":"noRouteFound"…}],
 *                                     "routes":[]}
 *   apiKey=nope           HTTP 401   {"error":"Unauthorized"…}
 *
 * The third of those is the one worth keeping a test for: **an unroutable
 * pair is a 200.** A provider check written from the Mapbox habit of reading
 * `response.ok` would call it a success and then index into an empty array.
 */

const LANE = {
  from: { lat: 41.701957, lng: -87.934337 },
  to: { lat: 33.43676264419, lng: -112.161534601882 },
};

/** A section as HERE really returns one, with the fields we read. */
const body = (
  over: {
    length?: number;
    duration?: number;
    mode?: string | null;
    /** Metres of snap to fake, per end. `null` omits `originalLocation`. */
    snaps?: (number | null)[];
    routes?: unknown[];
    notices?: { code: string }[];
  } = {},
) => {
  /** Degrees of latitude for a given number of metres — 1 deg ≈ 111,320 m. */
  const shift = (m: number) => m / 111_320;
  const place = (lat: number, lng: number, snap: number | null) => ({
    type: 'place',
    location: { lat, lng },
    ...(snap === null ? {} : { originalLocation: { lat: lat + shift(snap), lng } }),
  });
  const [snapFrom, snapTo] = over.snaps ?? [2.3, 6.5];
  return JSON.stringify({
    routes: over.routes ?? [
      {
        id: 'a03fe916',
        sections: [
          {
            id: 'f8be0445',
            type: 'vehicle',
            departure: { place: place(LANE.from.lat, LANE.from.lng, snapFrom ?? null) },
            arrival: { place: place(LANE.to.lat, LANE.to.lng, snapTo ?? null) },
            summary: {
              length: over.length ?? 2_876_905,
              duration: over.duration ?? 93_705,
              baseDuration: 92_760,
            },
            ...(over.mode === null ? {} : { transport: { mode: over.mode ?? 'truck' } }),
          },
        ],
      },
    ],
    ...(over.notices ? { notices: over.notices } : {}),
  });
};

const ok = (over = {}) =>
  vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    void url;
    void _init;
    return new Response(body(over), { status: 200 });
  });

const urlOf = (fetchImpl: ReturnType<typeof ok>) => String(fetchImpl.mock.calls[0]![0]);

describe('HereRouting', () => {
  it('asks for the truck profile by name', async () => {
    const fetchImpl = ok();
    await new HereRouting('k', fetchImpl).route(LANE);
    const url = new URL(urlOf(fetchImpl));
    /**
     * `transportMode=truck`, confirmed against HERE's transport-modes
     * reference rather than guessed. This is the entire point of the swap:
     * §12.31 opened the provider seam because Mapbox Directions has no
     * heavy-goods profile at all.
     */
    expect(url.searchParams.get('transportMode')).toBe('truck');
    expect(url.origin + url.pathname).toBe('https://router.hereapi.com/v8/routes');
  });

  it('sends the coordinates lat,lng — the opposite order to the provider it replaced', async () => {
    const fetchImpl = ok();
    await new HereRouting('k', fetchImpl).route(LANE);
    const url = new URL(urlOf(fetchImpl));
    // Mapbox took lng,lat in the path. HERE takes lat,lng in a query
    // parameter. Silently swapping them routes to the wrong hemisphere and
    // still returns 200, so this is asserted rather than assumed.
    expect(url.searchParams.get('origin')).toBe('41.701957,-87.934337');
    expect(url.searchParams.get('destination')).toBe('33.43676264419,-112.161534601882');
  });

  it('asks only for the summary, never geometry', async () => {
    const fetchImpl = ok();
    await new HereRouting('k', fetchImpl).route(LANE);
    // A polyline is kilobytes a call to draw a line we already draw from the
    // truck's own positions.
    expect(new URL(urlOf(fetchImpl)).searchParams.get('return')).toBe('summary');
  });

  it('converts metres to miles and keeps the duration in seconds', async () => {
    const out = await new HereRouting('k', ok()).route(LANE);
    // 2,876,905 m -> 1787.6 mi. The real answer for the real lane.
    expect(out).toMatchObject({ ok: true, durationSeconds: 93_705 });
    expect(out.ok && out.miles).toBeCloseTo(1787.6, 1);
  });

  it('computes the snap distance HERE does not hand over', async () => {
    // Mapbox gave `waypoints[].distance` outright; HERE gives the two points
    // and leaves the arithmetic here. Same concept, one haversine later.
    const out = await new HereRouting('k', ok({ snaps: [2.3, 6.5] })).route(LANE);
    expect(out.ok && out.snapFromMeters).toBeCloseTo(2.3, 0);
    expect(out.ok && out.snapToMeters).toBeCloseTo(6.5, 0);
  });

  it('reads an absent originalLocation as a snap of zero, not as unknown', async () => {
    // HERE omits `originalLocation` when it did not move the point. That is a
    // measurement of zero; treating it as null would lose the one case where
    // the coordinate was already exactly on a road.
    const out = await new HereRouting('k', ok({ snaps: [null, null] })).route(LANE);
    expect(out.ok && out.snapFromMeters).toBe(0);
    expect(out.ok && out.snapToMeters).toBe(0);
  });

  it('refuses a route whose waypoint was dragged past our worst stored error', async () => {
    const out = await new HereRouting('k', ok({ snaps: [12, 4_500] })).route(LANE);
    expect(out).toMatchObject({ ok: false, reason: 'snap-too-far' });
  });

  it('accepts a ZIP-centroid snap, which is coarse but real', async () => {
    // 379–402 m is the measured ZIP cluster (§12.31). Refusing it would take
    // the ETA off every ZIP-precision stop.
    const out = await new HereRouting('k', ok({ snaps: [4, 402] })).route(LANE);
    expect(out.ok).toBe(true);
  });

  /**
   * The failure that a 200 hides, and the reason this test exists at all.
   */
  it('treats an empty routes array as no-route, although HTTP said 200', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            notices: [{ title: "Couldn't find a route.", code: 'noRouteFound' }],
            routes: [],
          }),
          { status: 200 },
        ),
    );
    const out = await new HereRouting('k', fetchImpl).route(LANE);
    // And it carries HERE's own word for it, rather than inventing one.
    expect(out).toMatchObject({ ok: false, reason: 'no-route', detail: 'noRouteFound' });
  });

  /**
   * The silent-downgrade guard. Car miles are not obviously wrong, only
   * short — so if HERE ever answered as `car` for a truck request, nothing
   * downstream would notice and the board would quietly return to the defect
   * this whole swap exists to fix.
   */
  it('refuses an answer that came back as a car', async () => {
    const out = await new HereRouting('k', ok({ mode: 'car' })).route(LANE);
    expect(out).toMatchObject({ ok: false, reason: 'provider-error' });
    expect(out.ok === false && out.detail).toContain('not truck');
  });

  it('accepts a response that names no mode at all', async () => {
    // Absence is not evidence of a downgrade; only a stated `car` is.
    const out = await new HereRouting('k', ok({ mode: null })).route(LANE);
    expect(out.ok).toBe(true);
  });

  it('reports a rejected key as a provider error rather than throwing', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: 'Unauthorized', error_description: 'apiKey invalid.' }),
          { status: 401 },
        ),
    );
    const out = await new HereRouting('k', fetchImpl).route(LANE);
    // NEVER error, always degrade: the sweep falls back to the lane estimate
    // and the board keeps working with a worse number.
    expect(out).toMatchObject({ ok: false, reason: 'provider-error' });
    expect(out.ok === false && out.detail).toContain('401');
  });

  it('says so without calling anything when there is no key', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const out = await new HereRouting(undefined, fetchImpl).route(LANE);
    expect(out).toMatchObject({ ok: false, reason: 'not-configured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports a timeout as a timeout, and does not retry', async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error('The operation was aborted due to timeout');
      error.name = 'TimeoutError';
      throw error;
    });
    const out = await new HereRouting('k', fetchImpl).route(LANE);
    expect(out).toMatchObject({ ok: false, reason: 'timeout' });
    // One call. A retry loop against a 5,000/month allowance is the failure
    // the budget exists to prevent.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('survives a body that is not the shape it expects', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>502</html>', { status: 200 }));
    const out = await new HereRouting('k', fetchImpl).route(LANE);
    expect(out).toMatchObject({ ok: false, reason: 'provider-error' });
  });

  it('identifies itself by provider AND profile', async () => {
    // `here-routing-v8-truck`, not `here`: a row that recorded only the
    // vendor could not be told from a car measurement after a profile change.
    expect(new HereRouting('k').name).toBe(ROUTE_PROVIDER);
    expect(ROUTE_PROVIDER).toContain('truck');
  });
});
