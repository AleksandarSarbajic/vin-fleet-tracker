import { z } from 'zod';
import { ROUTING_DEFAULTS, metresToMiles, type RoutingConfig } from '@/lib/routing';

/**
 * The routing seam (§12.31).
 *
 * Mapbox Directions has NO heavy-goods profile, so every route here is a CAR
 * route. Measured against Valhalla's truck routing on our own lanes that is
 * +3.0 mi mean and +15.6 mi worst — fine for deciding LATE, and NOT fine for
 * anyone reconciling against a rate confirmation, because brokers pay truck
 * miles and a car route reads short.
 *
 * This interface is the containment for that. Swapping to an HGV provider
 * means one new file implementing `EtaProvider` and nothing else changing:
 * the policy in lib/routing.ts, the cache, the budget and the engine all take
 * miles and seconds and do not care who measured them.
 */

export interface RouteRequest {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
}

export interface RouteSuccess {
  ok: true;
  miles: number;
  durationSeconds: number;
  /** How far each end was MOVED to reach a road. Metres. */
  snapFromMeters: number | null;
  snapToMeters: number | null;
}

export type RouteFailure = {
  ok: false;
  reason: 'not-configured' | 'no-route' | 'snap-too-far' | 'provider-error' | 'timeout';
  detail: string | null;
};

export type RouteOutcome = RouteSuccess | RouteFailure;

export interface EtaProvider {
  readonly name: string;
  route(request: RouteRequest): Promise<RouteOutcome>;
}

const fail = (reason: RouteFailure['reason'], detail: string | null = null): RouteFailure => ({
  ok: false,
  reason,
  detail,
});

/**
 * Mapbox Directions, driving profile.
 *
 * `overview=false` deliberately: we want distance and duration, not geometry.
 * The line on a map is drawn from the truck's own positions; a polyline here
 * would be kilobytes per call to render something we already have.
 */
const MapboxRoute = z.object({
  code: z.string(),
  routes: z
    .array(z.object({ distance: z.number(), duration: z.number() }))
    .default([]),
  waypoints: z
    .array(z.object({ distance: z.number().optional() }))
    .default([]),
});

const ENDPOINT = 'https://api.mapbox.com/directions/v5/mapbox/driving';

/** Four seconds, and NO retry — see the note in `route`. */
const TIMEOUT_MS = 4_000;

export class MapboxDirections implements EtaProvider {
  readonly name = 'mapbox-directions-driving';

  constructor(
    private readonly token: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly config: RoutingConfig = ROUTING_DEFAULTS,
  ) {}

  async route(request: RouteRequest): Promise<RouteOutcome> {
    if (!this.token) return fail('not-configured');

    const coords =
      `${request.from.lng},${request.from.lat};${request.to.lng},${request.to.lat}`;
    const query = new URLSearchParams({
      overview: 'false',
      access_token: this.token,
    });

    let response: Response;
    try {
      response = await this.fetchImpl(`${ENDPOINT}/${coords}?${query.toString()}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'application/json' },
      });
    } catch (error: unknown) {
      /**
       * No retry, on purpose. The next poll is 30 seconds away, and a retry
       * loop against a metered API with no hard spend cap is the failure this
       * whole budget exists to prevent. A missed route costs one cycle of
       * accuracy; a retry storm costs money.
       */
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      return fail(timedOut ? 'timeout' : 'provider-error', messageOf(error));
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return fail('provider-error', `HTTP ${response.status}: ${body.slice(0, 200)}`);
    }

    const parsed = MapboxRoute.safeParse(await response.json().catch(() => null));
    if (!parsed.success) return fail('provider-error', 'unreadable response');
    if (parsed.data.code !== 'Ok') return fail('no-route', parsed.data.code);

    const route = parsed.data.routes[0];
    if (!route) return fail('no-route', 'no routes returned');

    const snapFrom = parsed.data.waypoints[0]?.distance ?? null;
    const snapTo = parsed.data.waypoints[1]?.distance ?? null;

    // A waypoint dragged further than our worst stored coordinate error is
    // measuring from somewhere we never stored.
    const worstSnap = Math.max(snapFrom ?? 0, snapTo ?? 0);
    if (worstSnap > this.config.snapRefuseMeters) {
      return fail(
        'snap-too-far',
        `nearest road is ${Math.round(worstSnap)} m away; the route would not describe this stop`,
      );
    }

    return {
      ok: true,
      miles: metresToMiles(route.distance),
      durationSeconds: route.duration,
      snapFromMeters: snapFrom,
      snapToMeters: snapTo,
    };
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
