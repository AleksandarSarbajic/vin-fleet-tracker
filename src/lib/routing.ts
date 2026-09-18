import { haversineMiles } from './status';

/**
 * Routing policy. Pure — no I/O, no provider, no database (§12.31).
 *
 * Everything here decides WHETHER to spend a routing call and what to believe
 * about the answer. It is separated from the provider for the same reason the
 * status engine is separated from the query: these are the rules that cost
 * money and drive LATE, and they have to be testable without a network.
 */

/* ------------------------------- thresholds ------------------------------ */

export const ROUTING_DEFAULTS = {
  /**
   * Recompute when the straight-line distance has changed by more than
   * `max(floorMiles, fraction × straight-at-last-route)`.
   *
   * Proportional, because a 15% error 600 miles out is irrelevant and a 15%
   * error 20 miles out is not — the rule tightens by itself as the truck
   * closes. Simulated against our real lane lengths:
   *
   *     max( 2 mi,  5%)   74 routes/lane   ~1,843 calls/day
   *     max( 5 mi,  8%)   41 routes/lane   ~1,006 calls/day
   *     max(10 mi, 15%)   21 routes/lane   ~  516 calls/day   <- chosen
   *     max(25 mi, 25%)   11 routes/lane   ~  268 calls/day
   *
   * For scale, 23 trucks polling every 30 s is 66,240 polls a day. Routing
   * per poll would be 66,240 calls; this is three orders of magnitude less.
   */
  floorMiles: 10,
  fraction: 0.15,
  /** Roads change, and a truck parked for a day should not hold a stale route. */
  maxAgeHours: 12,

  /**
   * Snap thresholds, in metres — how far the provider MOVED a waypoint to
   * reach a road.
   *
   * Measured across our own stops: street-precision coordinates snap 1–8 m
   * (median 7), ZIP centroids snap 379–402 m. Two clusters, two orders of
   * magnitude apart, so there is real daylight to put a threshold in.
   *
   * `snapNoteMeters` at 100 m is twelve times the worst real street stop, so
   * it cannot flag a good one, and well under the ZIP cluster, so it always
   * flags those.
   *
   * `snapRefuseMeters` at 2 km is just beyond our worst STORED coordinate
   * error — `block` precision measured up to 0.78 mi ≈ 1.26 km. If the
   * nearest road is further away than our worst deliberate approximation,
   * the route is describing somewhere else and should not be dressed up as
   * this stop's distance.
   */
  snapNoteMeters: 100,
  snapRefuseMeters: 2_000,
} as const;

export type RoutingConfig = typeof ROUTING_DEFAULTS;

const METRES_PER_MILE = 1609.344;
export const metresToMiles = (m: number): number => m / METRES_PER_MILE;

/* ------------------------------ the decision ----------------------------- */

export interface CachedRoute {
  routedMiles: number;
  routedDurationS: number;
  fromLat: number;
  fromLng: number;
  straightAtRouteMiles: number;
  laneRatio: number;
  stopLat: number;
  stopLng: number;
  snapFromM: number | null;
  snapToM: number | null;
  computedAtUtc: string;
}

export type RecomputeReason =
  | 'no-route'
  | 'stop-moved'
  | 'truck-moved'
  | 'route-stale'
  | null;

/**
 * Why this lane needs routing again, or null to leave it alone.
 *
 * Returning a REASON rather than a boolean so the worker log says what it is
 * spending money on. "23 routes this poll" is not debuggable; "23 routes,
 * all truck-moved" is.
 */
export function needsRecompute(
  cached: CachedRoute | null,
  now: { truckLat: number; truckLng: number; stopLat: number; stopLng: number },
  at: Date,
  config: RoutingConfig = ROUTING_DEFAULTS,
): RecomputeReason {
  if (!cached) return 'no-route';

  // A re-geocode moves the destination. The old route measured elsewhere.
  if (cached.stopLat !== now.stopLat || cached.stopLng !== now.stopLng) return 'stop-moved';

  const ageHours = (at.getTime() - new Date(cached.computedAtUtc).getTime()) / 3_600_000;
  if (!Number.isFinite(ageHours) || ageHours >= config.maxAgeHours) return 'route-stale';

  const straightNow = haversineMiles(
    { lat: now.truckLat, lng: now.truckLng },
    { lat: now.stopLat, lng: now.stopLng },
  );
  const moved = Math.abs(straightNow - cached.straightAtRouteMiles);
  const threshold = Math.max(
    config.floorMiles,
    config.fraction * cached.straightAtRouteMiles,
  );
  return moved > threshold ? 'truck-moved' : null;
}

/* -------------------------------- the basis ------------------------------ */

/**
 * Which kind of distance the row is showing. Surfaced beside coordinate
 * precision, because a dispatcher reconciling against a rate confirmation
 * needs to tell a routed figure from a straight-line guess (§12.31).
 */
export type DistanceBasis = 'routed' | 'lane-estimate' | 'straight-line';

export interface Projection {
  miles: number;
  /** Miles per hour to travel them. Never faster than the configured average. */
  speedMph: number;
  basis: DistanceBasis;
  /** The measured road factor used, when one was available. */
  laneRatio: number | null;
}

/**
 * Miles and speed for a lane, from the best thing available.
 *
 * The chain, in order of how much it knows:
 *
 *   `routed`        a fresh route for this truck's position.
 *   `lane-estimate` a route from earlier on the SAME lane. Its `laneRatio` is
 *                   a measured road factor for this corridor, so the
 *                   straight-line estimate it feeds is far better than a
 *                   global constant — the spread across our lanes was 1.070
 *                   to 1.460, and the brief's 1.25 was wrong by up to 162
 *                   minutes on truck 143.
 *   `straight-line` no route ever. The brief's constant, and now known to be
 *                   the weakest link rather than the design.
 */
export function projectDistance(
  straightNow: number,
  cached: CachedRoute | null,
  fallbackRoadFactor: number,
  avgSpeedMph: number,
  fresh: boolean,
): Projection {
  if (cached && fresh) {
    return {
      miles: cached.routedMiles,
      speedMph: cappedSpeed(cached, avgSpeedMph),
      basis: 'routed',
      laneRatio: cached.laneRatio,
    };
  }
  if (cached) {
    return {
      miles: straightNow * cached.laneRatio,
      speedMph: cappedSpeed(cached, avgSpeedMph),
      basis: 'lane-estimate',
      laneRatio: cached.laneRatio,
    };
  }
  return {
    miles: straightNow * fallbackRoadFactor,
    speedMph: avgSpeedMph,
    basis: 'straight-line',
    laneRatio: null,
  };
}

/**
 * The provider's own implied speed, capped at the configured average.
 *
 * Using the duration is better than distance ÷ 52 because the route knows
 * road classes — an interstate lane and a lane of county roads are not the
 * same hour. But it is a CAR duration: on the first live call it implied 65.5
 * mph, which no loaded truck sustains. Capping keeps the useful half (a route
 * that says 35 mph through a city is telling us something) and discards the
 * optimistic half.
 *
 * NO break time is added. Hours of Service is on the brief's never-build
 * list, so this is a DRIVING-time estimate and the row says so — a long lane
 * will read optimistic against a driver who stops, and inventing a break
 * model would be worse than being clear about it.
 */
function cappedSpeed(cached: CachedRoute, avgSpeedMph: number): number {
  const hours = cached.routedDurationS / 3600;
  if (!(hours > 0)) return avgSpeedMph;
  const implied = cached.routedMiles / hours;
  return Math.min(implied, avgSpeedMph);
}

/* -------------------------------- the budget ----------------------------- */

/** `YYYY-MM` in UTC — the month a provider bills in. */
export function budgetMonth(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}
