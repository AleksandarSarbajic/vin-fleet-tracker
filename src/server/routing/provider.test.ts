import { describe, expect, it, vi } from 'vitest';
import { MapboxDirections } from './provider';

/**
 * §12.31. Shaped from a real response: the first live call to
 * /directions/v5/mapbox/driving returned code Ok, 680.3 mi, 10.39 h and
 * waypoint snap distances of 401.0 m and 379.1 m.
 */

const LANE = { from: { lat: 46.8672, lng: -96.9422 }, to: { lat: 41.4142, lng: -88.0835 } };

const body = (over: {
  code?: string;
  distance?: number;
  duration?: number;
  snaps?: (number | undefined)[];
} = {}) =>
  JSON.stringify({
    code: over.code ?? 'Ok',
    routes: over.code === 'NoRoute' ? [] : [
      { distance: over.distance ?? 1_094_416.8, duration: over.duration ?? 37_400 },
    ],
    waypoints: (over.snaps ?? [401.0, 379.1]).map((d) => (d === undefined ? {} : { distance: d })),
  });

const ok = (over = {}) =>
  vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    void url;
    void _init;
    return new Response(body(over), { status: 200 });
  });

describe('MapboxDirections', () => {
  it('converts metres to miles and keeps the duration in seconds', async () => {
    const out = await new MapboxDirections('sk.test', ok()).route(LANE);
    expect(out.ok).toBe(true);
    expect(out.ok && out.miles).toBeCloseTo(680.0, 1);
    expect(out.ok && out.durationSeconds).toBe(37_400);
  });

  it('reads the snap distance off both waypoints', async () => {
    const out = await new MapboxDirections('sk.test', ok()).route(LANE);
    expect(out.ok && out.snapFromMeters).toBeCloseTo(401.0, 1);
    expect(out.ok && out.snapToMeters).toBeCloseTo(379.1, 1);
  });

  it('asks for no geometry — we want a number, not a polyline', async () => {
    const fetchImpl = ok();
    await new MapboxDirections('sk.test', fetchImpl).route(LANE);
    const url = String(fetchImpl.mock.calls[0]![0]);
    expect(url).toContain('overview=false');
  });

  it('puts longitude before latitude, the way the API expects', async () => {
    const fetchImpl = ok();
    await new MapboxDirections('sk.test', fetchImpl).route(LANE);
    // Backwards here would route from the Indian Ocean, silently.
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('-96.9422,46.8672;-88.0835,41.4142');
  });

  /**
   * A waypoint dragged further than our worst STORED coordinate error
   * (`block`, 0.78 mi = 1255 m) is measuring somewhere we never stored.
   */
  it('refuses a route whose waypoint snapped miles away', async () => {
    const out = await new MapboxDirections('sk.test', ok({ snaps: [12, 4_500] })).route(LANE);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.reason).toBe('snap-too-far');
    expect(!out.ok && out.detail).toContain('4500');
  });

  it('accepts a ZIP-centroid-sized snap, which is the normal case for one', async () => {
    const out = await new MapboxDirections('sk.test', ok({ snaps: [4, 402] })).route(LANE);
    expect(out.ok).toBe(true);
  });

  it('degrades when no token is configured, rather than throwing', async () => {
    const fetchImpl = ok();
    const out = await new MapboxDirections(undefined, fetchImpl).route(LANE);
    expect(!out.ok && out.reason).toBe('not-configured');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports a non-Ok code as no-route', async () => {
    const out = await new MapboxDirections('sk.test', ok({ code: 'NoRoute' })).route(LANE);
    expect(!out.ok && out.reason).toBe('no-route');
  });

  it('turns an HTTP error into a failure, never an exception', async () => {
    const fetchImpl = vi.fn(async () => new Response('rate limited', { status: 429 }));
    await expect(new MapboxDirections('sk.test', fetchImpl).route(LANE)).resolves.toMatchObject({
      ok: false,
      reason: 'provider-error',
    });
  });

  /** No retry: the next poll is 30s away and the API is metered. */
  it('does not retry a timeout', async () => {
    const fetchImpl = vi.fn(async () => {
      const e = new Error('aborted');
      e.name = 'TimeoutError';
      throw e;
    });
    const out = await new MapboxDirections('sk.test', fetchImpl).route(LANE);
    expect(!out.ok && out.reason).toBe('timeout');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('treats an unreadable body as a provider error', async () => {
    const fetchImpl = vi.fn(async () => new Response('not json', { status: 200 }));
    const out = await new MapboxDirections('sk.test', fetchImpl).route(LANE);
    expect(!out.ok && out.reason).toBe('provider-error');
  });
});
