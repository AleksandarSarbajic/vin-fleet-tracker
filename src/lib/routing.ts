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

/**
 * Who measures the routes, as one string (§12.59).
 *
 * Written into `stop_routes.provider` and every `route_samples` row, and
 * compared against the cache by `needsRecompute`. It lives HERE, in the
 * policy module, rather than only on the provider class, because two places
 * need to agree about it — the worker that writes rows and the query that
 * decides whether an existing row still describes the world — and a name
 * duplicated in two files is a name that will differ in one of them.
 *
 * The value carries the PROFILE, not just the vendor. `here-routing-v8-car`
 * and `here-routing-v8-truck` are different measurements of the same lane
 * (+44 mi on Chicago->Phoenix, measured), so a row that recorded only "here"
 * could not be told apart after a profile change.
 */
export const ROUTE_PROVIDER = 'here-routing-v8-truck';

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
  /** Which provider and profile measured it (§12.59). */
  provider: string;
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
  /** §12.59: measured by a provider or profile we no longer use. */
  | 'provider-changed'
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
  now: {
    truckLat: number;
    truckLng: number;
    stopLat: number;
    stopLng: number;
    /**
     * The provider in force RIGHT NOW. Part of the facts rather than an
     * optional argument on purpose: both callers are then made to supply it
     * by the compiler, and a rule that depends on the caller remembering is
     * not a rule.
     */
    provider: string;
  },
  at: Date,
  config: RoutingConfig = ROUTING_DEFAULTS,
): RecomputeReason {
  if (!cached) return 'no-route';

  /**
   * §12.59. A car route and a truck route are different numbers for the same
   * lane — +44 mi on Chicago->Phoenix when this was measured — and a
   * `lane_ratio` derived from one is not a road factor for the other.
   *
   * Checked FIRST, before the geometry: a row from the previous provider is
   * wrong no matter where the truck has got to, and letting `truck-moved`
   * report it would hide a provider swap inside ordinary traffic.
   *
   * This is the standing guarantee. Migration 0017 deleted the 24 Mapbox
   * rows that existed at the swap, so nothing relies on this today — it is
   * here so the NEXT swap, or a row that somehow survives one, cannot feed a
   * car ratio to a truck.
   */
  if (cached.provider !== now.provider) return 'provider-changed';

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
    /**
     * ADVANCED by what the truck has covered since the route was measured
     * (§12.40).
     *
     * This returned `cached.routedMiles` unchanged, and `project()` adds it
     * to `position.recorded_at`. The anchor moves with every fix; the
     * distance did not. So the ETA advanced 1:1 with the wall clock —
     * measured on truck 116: 5.6 minutes of clock, 5.6 minutes of ETA, while
     * the truck covered 6.5 miles and the projected distance never changed.
     *
     * The straight-line distance IS current — it is recomputed from the
     * newest fix every time. So the shrinkage since the route was measured is
     * `straightAtRoute - straightNow`, scaled by this lane's own measured
     * ratio, which is the best available estimate of the road miles consumed.
     *
     * Clamped at zero: a truck that has moved AWAY has not travelled negative
     * road miles, and the route is about to be recomputed anyway.
     */
    const closedStraight = cached.straightAtRouteMiles - straightNow;
    const closedRouted = closedStraight * cached.laneRatio;
    const miles = Math.max(0, cached.routedMiles - Math.max(0, closedRouted));
    return {
      miles,
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

/**
 * How the month is going, and when it runs out at this rate (§12.60).
 *
 * ## Why this exists at all
 *
 * The budget had exactly one runtime signal: an error line when the ceiling
 * was already hit. By then the board has silently degraded to lane estimates
 * and the only remedies are to raise the ceiling or wait for the month to
 * roll over — so the first thing ops heard about it was also the last thing
 * they could act on.
 *
 * §12.59 wrote down a specific risk: HERE's free tier is 5,000 a month,
 * §12.31's calibration projects ~15,480, and if utilisation ever rises to
 * what that simulation assumed the ceiling is reached **around day six**.
 * That sentence was in the spec and in a commit message, which is not where
 * anyone looks at 3am. It belongs in the log line, next to the numbers that
 * would make it true.
 *
 * Pure, and therefore testable without a clock or a database — the same rule
 * the rest of this module follows.
 */
export const BUDGET_WATCH_FRACTION = 0.7;
export const BUDGET_CRITICAL_FRACTION = 0.9;

export type BudgetBand = 'ok' | 'watch' | 'critical' | 'exhausted';

export interface BudgetStatus {
  spent: number;
  ceiling: number;
  /** 0–1+, and it can exceed 1: a cycle in flight when the ceiling fell. */
  fraction: number;
  band: BudgetBand;
  /** Days of this UTC month elapsed so far, including the part-day. */
  daysElapsed: number;
  daysInMonth: number;
  /** Calls per day so far this month. */
  burnPerDay: number;
  /** Calls by month end if the rate holds. */
  projectedMonthEnd: number;
  /**
   * The day of the month the ceiling is reached at this rate, or null when
   * the rate does not reach it. This is the §12.59 number, computed rather
   * than remembered — a forecast is only useful if it updates.
   */
  exhaustedOnDay: number | null;
}

/** Days in the UTC month containing `at`. */
function daysInUtcMonth(at: Date): number {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)).getUTCDate();
}

export function budgetStatus(spent: number, ceiling: number, at: Date): BudgetStatus {
  const daysInMonth = daysInUtcMonth(at);
  /**
   * Elapsed INCLUDING the part-day, so the first hours of the month do not
   * divide by something near zero and report a burn rate of thousands. The
   * floor of one hour is what stops that.
   */
  const msIntoMonth =
    at.getTime() - Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1);
  const daysElapsed = Math.max(msIntoMonth / 86_400_000, 1 / 24);
  const burnPerDay = spent / daysElapsed;
  const projectedMonthEnd = burnPerDay * daysInMonth;

  /**
   * Day-of-month the ceiling lands on. Rounded UP: "reached on day 6" should
   * mean the ceiling is hit at some point during day 6, not that day 5.2 is a
   * date anybody can act on.
   */
  const daysToCeiling = burnPerDay > 0 ? ceiling / burnPerDay : Infinity;
  const exhaustedOnDay =
    Number.isFinite(daysToCeiling) && daysToCeiling <= daysInMonth
      ? Math.max(1, Math.ceil(daysToCeiling))
      : null;

  const fraction = ceiling > 0 ? spent / ceiling : 1;
  const band: BudgetBand =
    fraction >= 1
      ? 'exhausted'
      : fraction >= BUDGET_CRITICAL_FRACTION
        ? 'critical'
        : fraction >= BUDGET_WATCH_FRACTION
          ? 'watch'
          : 'ok';

  return {
    spent,
    ceiling,
    fraction,
    band,
    daysElapsed,
    daysInMonth,
    burnPerDay,
    projectedMonthEnd,
    exhaustedOnDay,
  };
}
