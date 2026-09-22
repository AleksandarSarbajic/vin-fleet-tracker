import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { routeSamples, routingBudget, stopRoutes } from '@/db/schema';
import { haversineMiles } from '@/lib/status';
import {
  ROUTING_DEFAULTS,
  budgetMonth,
  budgetStatus,
  needsRecompute,
  type BudgetStatus,
  type CachedRoute,
  type RoutingConfig,
} from '@/lib/routing';
import type { Db } from '@/server/audit';
import type { EtaProvider } from '@/server/routing/provider';

/**
 * The routing sweep, run once per poll beside the arrival sweep (§12.31).
 *
 * In the WORKER, never in a render or a request. Routing in the request path
 * would mean the first dispatcher to open the console pays for 23 routes, and
 * every refresh after that pays again.
 */

const CandidateRow = z.object({
  stop_id: z.string().uuid(),
  truck_number: z.number().int().nullable(),
  truck_lat: z.number(),
  truck_lng: z.number(),
  stop_lat: z.number(),
  stop_lng: z.number(),
  dest_city: z.string().nullable(),
  dest_state: z.string().nullable(),
  dest_zip: z.string().nullable(),
  dest_precision: z.enum(['street', 'block', 'zip']).nullable(),
});

/**
 * What happened to one candidate lane. **Every candidate gets exactly one**
 * (§12.54).
 *
 * The sweep used to record a reason only for a lane it ROUTED or one the
 * provider refused. Both skip branches did `skipped += 1; continue`, so a
 * poll line read `routesSkipped: 20, routeReasons: {}` whether twenty lanes
 * were correctly left alone or one of them was being dropped by the wrong
 * rule. Truck 132's lane was skipped by the 0.5-mile floor for eight minutes
 * and answering "why" took four database queries, because the log could not
 * distinguish it from the nineteen lanes that were simply current.
 *
 * Same lesson as §12.36's `arrived: 0`, which `explainNearest` exists to fix:
 * **a count with no reason cannot report its own failure.**
 */
export type RouteOutcome =
  /** Routed. `routedBecause` says which `needsRecompute` reason paid for it. */
  | 'routed'
  /** Skipped: the cached route still describes this lane. The normal state. */
  | 'route-current'
  /**
   * Skipped: under `MIN_ROUTABLE_MILES`. Nothing worth routing, and a zero
   * denominator for the lane ratio — but ALSO the branch that hides a lane
   * whose destination just moved to somewhere the truck is already parked.
   */
  | 'too-close'
  /** The provider refused. `failures` carries its reason. */
  | 'failed'
  /** Never considered: this poll had already spent `MAX_PER_CYCLE`. */
  | 'cycle-cap'
  /** Never considered: the monthly ceiling. The board degrades, quietly. */
  | 'budget-exhausted';

/** A lane whose outcome was worth naming — see `blocked` below. */
export interface BlockedLane {
  truck: number | null;
  stopId: string;
  outcome: RouteOutcome;
  straightMiles: number;
}

export interface RoutingSweep {
  /** Candidates the query returned. Without it, every other count is a ratio
   *  with no denominator. */
  considered: number;
  routed: number;
  skipped: number;
  failed: number;
  /** True when the monthly ceiling stopped us. The board degrades, quietly. */
  budgetExhausted: boolean;
  /**
   * §12.60. Where the month stands AFTER this sweep's spending, so the caller
   * can warn on the way up instead of only at the wall. Always present: a
   * field that appears only in trouble is a field nobody has a baseline for.
   */
  budget: BudgetStatus;
  /** Every candidate, by outcome. These sum to `considered`. */
  outcomes: Record<RouteOutcome, number>;
  /** Why the routed ones were routed — the money, by cause. */
  routedBecause: Record<string, number>;
  /** Provider refusals, by their own reason. */
  failures: Record<string, number>;
  /**
   * The lanes worth naming: everything whose outcome was not `routed` or
   * `route-current`.
   *
   * `route-current` is the resting state of a healthy board and naming twenty
   * of them every thirty seconds would bury the one that matters — which is
   * how the old log failed. Anything else is either costing money or silently
   * not happening, and both deserve a truck number.
   */
  blocked: BlockedLane[];
}

/**
 * Under half a mile there is no route worth fetching and no usable lane ratio.
 *
 * Named because §12.54 made it visible: this is the floor that dropped truck
 * 132's lane every poll after its stop was re-pointed to an address the truck
 * was already parked beside.
 */
export const MIN_ROUTABLE_MILES = 0.5;

/** At most this many named lanes per poll, so one bad day cannot flood the log. */
const MAX_BLOCKED_LOGGED = 6;

export interface SweepLogger {
  info: (message: string, fields?: Record<string, unknown>) => void;
  warn?: (message: string, fields?: Record<string, unknown>) => void;
}

/**
 * How many routes one poll may spend, whatever the rule says.
 *
 * A second guard behind the budget: if something makes every lane look like
 * it needs recomputing — a clock jump, a bad migration, a bug in the
 * threshold — this bounds the damage to 8 calls per 30 seconds instead of one
 * per truck, and the next poll picks up where this one stopped.
 */
const MAX_PER_CYCLE = 8;

export async function sweepRouting(
  db: Db,
  provider: EtaProvider,
  logger: SweepLogger,
  options: { ceiling: number; now?: Date; config?: RoutingConfig } = { ceiling: 25_000 },
): Promise<RoutingSweep> {
  const config = options.config ?? ROUTING_DEFAULTS;
  const now = options.now ?? new Date();
  const sweep: RoutingSweep = {
    considered: 0,
    routed: 0,
    skipped: 0,
    failed: 0,
    budgetExhausted: false,
    // Replaced once the counter has been read; a zero ceiling would band as
    // `exhausted`, which is the right way round for a field not yet known.
    budget: budgetStatus(0, options.ceiling, now),
    outcomes: {} as Record<RouteOutcome, number>,
    routedBecause: {},
    failures: {},
    blocked: [],
  };

  /**
   * The ONE place an outcome is recorded, so a branch cannot leave without
   * one. Every `continue` in the loop below goes through here.
   */
  const record = (
    outcome: RouteOutcome,
    lane: { truck: number | null; stopId: string; straightMiles: number },
  ): void => {
    sweep.outcomes[outcome] = (sweep.outcomes[outcome] ?? 0) + 1;
    if (outcome === 'routed') sweep.routed += 1;
    else if (outcome === 'failed') sweep.failed += 1;
    else sweep.skipped += 1;
    if (outcome === 'routed' || outcome === 'route-current') return;
    if (sweep.blocked.length >= MAX_BLOCKED_LOGGED) return;
    sweep.blocked.push({
      truck: lane.truck,
      stopId: lane.stopId,
      outcome,
      straightMiles: Number(lane.straightMiles.toFixed(3)),
    });
  };

  const month = budgetMonth(now);
  const [budget] = await db
    .select({ calls: routingBudget.calls })
    .from(routingBudget)
    .where(eq(routingBudget.month, month))
    .limit(1);
  let spent = budget?.calls ?? 0;
  sweep.budget = budgetStatus(spent, options.ceiling, now);
  if (spent >= options.ceiling) {
    sweep.budgetExhausted = true;
    return sweep;
  }

  /** Every truck's next stop that has coordinates, with its cached route. */
  const result = await db.execute(sql`
    select
      ns.stop_id, t.truck_number,
      p.lat as truck_lat, p.lng as truck_lng,
      ns.stop_lat, ns.stop_lng,
      ns.dest_city, ns.dest_state, ns.dest_zip, ns.dest_precision
    from trucks t
    join lateral (
      select lat, lng from positions
      where truck_id = t.id order by recorded_at desc limit 1
    ) p on true
    join lateral (
      select s.id::text as stop_id, s.lat as stop_lat, s.lng as stop_lng,
             s.city as dest_city, s.state as dest_state, s.zip as dest_zip,
             s.geocode_precision::text as dest_precision
      from loads l
      join stops s on s.load_id = l.id
      where l.truck_id = t.id
        and l.status not in ('DELIVERED', 'TONU', 'CANCELLED')
        and s.departed_at is null
        and s.arrived_at is null
        and s.lat is not null and s.lng is not null
      order by s.appointment_start_utc asc nulls last, s.sequence asc
      limit 1
    ) ns on true
    where t.active`);

  const candidates = z.array(CandidateRow).parse(result);

  sweep.considered = candidates.length;

  for (const c of candidates) {
    /**
     * The straight line is computed FIRST now, not after the recompute
     * decision, so that a lane cut off by the cycle cap or the budget can
     * still be named with a distance. A blocked lane with no number attached
     * is most of the way back to the count that could not explain itself.
     */
    const straight = haversineMiles(
      { lat: c.truck_lat, lng: c.truck_lng },
      { lat: c.stop_lat, lng: c.stop_lng },
    );
    const lane = {
      truck: c.truck_number,
      stopId: c.stop_id,
      straightMiles: straight,
    };

    if (sweep.routed >= MAX_PER_CYCLE) {
      // Not `break`: the remaining candidates are still candidates, and a
      // silent truncation is how a permanently starved lane stays invisible.
      record('cycle-cap', lane);
      continue;
    }
    if (spent >= options.ceiling) {
      sweep.budgetExhausted = true;
      record('budget-exhausted', lane);
      continue;
    }

    const [cachedRow] = await db
      .select()
      .from(stopRoutes)
      .where(eq(stopRoutes.stopId, c.stop_id))
      .limit(1);

    const cached: CachedRoute | null = cachedRow
      ? {
          provider: cachedRow.provider,
          routedMiles: cachedRow.routedMiles,
          routedDurationS: cachedRow.routedDurationS,
          fromLat: cachedRow.fromLat,
          fromLng: cachedRow.fromLng,
          straightAtRouteMiles: cachedRow.straightAtRouteMiles,
          laneRatio: cachedRow.laneRatio,
          stopLat: cachedRow.stopLat,
          stopLng: cachedRow.stopLng,
          snapFromM: cachedRow.snapFromM,
          snapToM: cachedRow.snapToM,
          computedAtUtc: cachedRow.computedAt.toISOString(),
        }
      : null;

    const reason = needsRecompute(
      cached,
      {
        truckLat: c.truck_lat,
        truckLng: c.truck_lng,
        stopLat: c.stop_lat,
        stopLng: c.stop_lng,
        // §12.59. The sweep's own identity, so a row from the previous
        // provider is recomputed rather than believed.
        provider: provider.name,
      },
      now,
      config,
    );
    if (reason === null) {
      record('route-current', lane);
      continue;
    }

    /**
     * Nothing to route, and a zero denominator for the lane ratio.
     *
     * Recorded rather than dropped: this is the branch that hid truck 132.
     * `needsRecompute` had already said `stop-moved` — the destination had
     * been re-pointed 1,100 miles — and this floor then dropped it because the
     * truck happened to be parked 0.313 mi from the NEW address. The lane was
     * both urgently stale and permanently unroutable, and the log said
     * nothing either way.
     */
    if (straight < MIN_ROUTABLE_MILES) {
      record('too-close', lane);
      continue;
    }

    spent += 1;
    await countCall(db, month);

    const outcome = await provider.route({
      from: { lat: c.truck_lat, lng: c.truck_lng },
      to: { lat: c.stop_lat, lng: c.stop_lng },
    });

    if (!outcome.ok) {
      record('failed', lane);
      sweep.failures[outcome.reason] = (sweep.failures[outcome.reason] ?? 0) + 1;
      logger.info('route failed', {
        truck: c.truck_number,
        reason: outcome.reason,
        detail: outcome.detail,
      });
      continue;
    }

    const laneRatio = outcome.miles / straight;
    const impliedMph =
      outcome.durationSeconds > 0 ? outcome.miles / (outcome.durationSeconds / 3600) : null;

    // The cache row and its sample in ONE transaction, so the history can
    // never disagree with the cache it came from.
    await db.transaction(async (tx) => {
      const row = {
        stopId: c.stop_id,
        routedMiles: outcome.miles,
        routedDurationS: outcome.durationSeconds,
        fromLat: c.truck_lat,
        fromLng: c.truck_lng,
        straightAtRouteMiles: straight,
        laneRatio,
        stopLat: c.stop_lat,
        stopLng: c.stop_lng,
        snapFromM: outcome.snapFromMeters,
        snapToM: outcome.snapToMeters,
        provider: provider.name,
        computedAt: sql`now()`,
      };
      await tx
        .insert(stopRoutes)
        .values(row)
        .onConflictDoUpdate({ target: stopRoutes.stopId, set: row });

      await tx.insert(routeSamples).values({
        // Provenance, not a join key — see the schema comment (§12.54).
        stopId: c.stop_id,
        destCity: c.dest_city,
        destState: c.dest_state,
        destZip: c.dest_zip,
        destPrecision: c.dest_precision,
        // The point actually routed to, so the row stays a complete
        // observation after the stop is re-pointed somewhere else.
        destLat: c.stop_lat,
        destLng: c.stop_lng,
        straightMiles: straight,
        routedMiles: outcome.miles,
        laneRatio,
        routedDurationS: outcome.durationSeconds,
        impliedMph,
        snapFromM: outcome.snapFromMeters,
        snapToM: outcome.snapToMeters,
        provider: provider.name,
      });
    });

    record('routed', lane);
    sweep.routedBecause[reason] = (sweep.routedBecause[reason] ?? 0) + 1;
    logger.info('routed', {
      truck: c.truck_number,
      reason,
      straightMiles: Number(straight.toFixed(1)),
      routedMiles: Number(outcome.miles.toFixed(1)),
      laneRatio: Number(laneRatio.toFixed(3)),
      impliedMph: impliedMph ? Number(impliedMph.toFixed(1)) : null,
      snapToM: outcome.snapToMeters ? Math.round(outcome.snapToMeters) : null,
    });
  }

  // §12.60. After the spending, not before: the caller warns on what the
  // month now stands at, including what this sweep just added.
  sweep.budget = budgetStatus(spent, options.ceiling, now);
  return sweep;
}

/**
 * Counted BEFORE the call, not after.
 *
 * A call that times out still cost quota. Counting on success would let a
 * failing provider burn the whole month while the counter said zero.
 */
async function countCall(db: Db, month: string): Promise<void> {
  await db
    .insert(routingBudget)
    .values({ month, calls: 1 })
    .onConflictDoUpdate({
      target: routingBudget.month,
      set: { calls: sql`${routingBudget.calls} + 1`, updatedAt: sql`now()` },
    });
}
