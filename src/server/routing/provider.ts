import { z } from 'zod';
import { haversineMiles } from '@/lib/status';
import {
  ROUTE_PROVIDER,
  ROUTING_DEFAULTS,
  metresToMiles,
  type RoutingConfig,
} from '@/lib/routing';

/**
 * The routing seam (§12.31), now behind HERE Routing v8 (§12.59).
 *
 * §12.31 built this interface as containment for a known defect: Mapbox
 * Directions has NO heavy-goods profile, so every route was a CAR route —
 * fine for deciding LATE, not fine for anyone reconciling against a rate
 * confirmation, because brokers pay truck miles and a car route reads short.
 * The seam did its job: this swap is one file, plus a name and a budget.
 *
 * The policy in lib/routing.ts, the cache, the lane ratio, the budget and the
 * status engine all take miles and seconds and do not care who measured them.
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
 * HERE Routing v8, `transportMode=truck`.
 *
 * ## The parameter, confirmed rather than guessed
 *
 * `transportMode` is one of the three mandatory parameters of every v8
 * request, and `truck` is its heavy-goods value. Confirmed against HERE's
 * own transport-modes reference AND against the live API, which echoes
 * `"transport":{"mode":"truck"}` in the section it returns — so the response
 * itself proves which profile answered, and the parser checks it.
 *
 * `return=summary` only. We want distance and duration, not geometry: the
 * line on the map is drawn from the truck's own positions, and a polyline
 * here would be kilobytes a call to render something we already have.
 *
 * ## Truck dimensions are deliberately NOT sent
 *
 * HERE accepts `vehicle[grossWeight]`, `vehicle[height]` and the rest, and
 * they change the answer — a bridge-restricted route can be materially
 * longer. We do not send them because we do not KNOW them: there is no
 * per-truck equipment record in this product, the trailer field was cut
 * (§12.53), and inventing a default weight would produce a number that looks
 * specific and describes a truck nobody owns. The profile alone already
 * applies the general HGV network restrictions, which is the gap §12.31
 * opened this seam for. Real dimensions are a later ruling, and the day they
 * exist this is where they go.
 */
const HereRoutes = z.object({
  /**
   * Present and EMPTY on an unroutable pair, with HTTP 200 — measured:
   *
   *     {"notices":[{"code":"noRouteFound","severity":"critical"}],"routes":[]}
   *
   * So `response.ok` does not mean a route exists, and the length of this
   * array is the only thing that does.
   */
  routes: z
    .array(
      z.object({
        sections: z
          .array(
            z.object({
              summary: z.object({
                /** Metres. */
                length: z.number(),
                /** Seconds, including live traffic. */
                duration: z.number(),
                /** Seconds without traffic. Not used; see `route`. */
                baseDuration: z.number().optional(),
              }),
              departure: z.object({ place: HerePlace() }).optional(),
              arrival: z.object({ place: HerePlace() }).optional(),
              transport: z.object({ mode: z.string() }).optional(),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
  notices: z
    .array(z.object({ code: z.string(), title: z.string().optional() }))
    .default([]),
});

/**
 * Where HERE put the waypoint, and where we asked for it.
 *
 * This is the snap distance, which Mapbox handed over as `waypoints[].distance`
 * and HERE does not: it gives both points and leaves the arithmetic to the
 * caller. Same concept, one haversine later — and `originalLocation` is only
 * present when HERE actually moved the point, so an absent one is a snap of
 * zero rather than an unknown.
 */
function HerePlace() {
  const point = z.object({ lat: z.number(), lng: z.number() });
  return z.object({ location: point, originalLocation: point.optional() });
}

const ENDPOINT = 'https://router.hereapi.com/v8/routes';

/** Four seconds, and NO retry — see the note in `route`. */
const TIMEOUT_MS = 4_000;

const METRES_PER_MILE = 1609.344;

/** Metres between the point we asked for and the point HERE routed from. */
function snapMeters(
  place:
    | {
        location: { lat: number; lng: number };
        originalLocation?: { lat: number; lng: number } | undefined;
      }
    | undefined,
): number | null {
  if (!place) return null;
  // No `originalLocation` means HERE did not move it.
  if (!place.originalLocation) return 0;
  return haversineMiles(place.originalLocation, place.location) * METRES_PER_MILE;
}

export class HereRouting implements EtaProvider {
  readonly name = ROUTE_PROVIDER;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly config: RoutingConfig = ROUTING_DEFAULTS,
  ) {}

  async route(request: RouteRequest): Promise<RouteOutcome> {
    if (!this.apiKey) return fail('not-configured');

    const query = new URLSearchParams({
      transportMode: 'truck',
      origin: `${request.from.lat},${request.from.lng}`,
      destination: `${request.to.lat},${request.to.lng}`,
      return: 'summary',
      apiKey: this.apiKey,
    });

    let response: Response;
    try {
      response = await this.fetchImpl(`${ENDPOINT}?${query.toString()}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'application/json' },
      });
    } catch (error: unknown) {
      /**
       * No retry, on purpose. The next poll is 30 seconds away, and a retry
       * loop against a metered API is the failure the budget exists to
       * prevent — more so on HERE's free tier, which is 5,000 transactions a
       * month against Mapbox's 100,000. A missed route costs one cycle of
       * accuracy; a retry storm costs the month.
       */
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      return fail(timedOut ? 'timeout' : 'provider-error', messageOf(error));
    }

    if (!response.ok) {
      /**
       * 401 is `{"error":"Unauthorized","error_description":"apiKey invalid…"}`
       * — measured. It reads as `provider-error` like any other failure, and
       * the sweep degrades to the lane estimate rather than throwing, which
       * is the whole contract of this interface: NEVER error, always degrade.
       */
      const body = await response.text().catch(() => '');
      return fail('provider-error', `HTTP ${response.status}: ${body.slice(0, 200)}`);
    }

    const parsed = HereRoutes.safeParse(await response.json().catch(() => null));
    if (!parsed.success) return fail('provider-error', 'unreadable response');

    const section = parsed.data.routes[0]?.sections[0];
    if (!section) {
      // The notice carries HERE's own words for it, e.g. `noRouteFound`.
      const code = parsed.data.notices[0]?.code ?? 'no routes returned';
      return fail('no-route', code);
    }

    /**
     * The response says which profile answered, so this is not an assertion
     * about our own query string — it is the provider's own account of what
     * it did. A silent fall back to car miles is precisely the defect §12.31
     * opened this seam to end, and it would be invisible: car miles are not
     * obviously wrong, just short.
     */
    const mode = section.transport?.mode;
    if (mode !== undefined && mode !== 'truck') {
      return fail('provider-error', `answered as ${mode}, not truck`);
    }

    const snapFrom = snapMeters(section.departure?.place);
    const snapTo = snapMeters(section.arrival?.place);

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
      miles: metresToMiles(section.summary.length),
      /**
       * `duration`, not `baseDuration`. It includes live traffic, and
       * `cappedSpeed` only ever uses it to slow the ETA down — a route that
       * says 35 mph through a city is telling us something, and one that
       * says 68 is capped at the configured average anyway (§12.31).
       */
      durationSeconds: section.summary.duration,
      snapFromMeters: snapFrom,
      snapToMeters: snapTo,
    };
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
