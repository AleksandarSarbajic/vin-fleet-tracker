import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { routeSamples, routingBudget, stopRoutes } from '@/db/schema';
import { haversineMiles } from '@/lib/status';
import {
  ROUTING_DEFAULTS,
  budgetMonth,
  needsRecompute,
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

export interface RoutingSweep {
  routed: number;
  skipped: number;
  failed: number;
  /** True when the monthly ceiling stopped us. The board degrades, quietly. */
  budgetExhausted: boolean;
  reasons: Record<string, number>;
}

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
    routed: 0,
    skipped: 0,
    failed: 0,
    budgetExhausted: false,
    reasons: {},
  };

  const month = budgetMonth(now);
  const [budget] = await db
    .select({ calls: routingBudget.calls })
    .from(routingBudget)
    .where(eq(routingBudget.month, month))
    .limit(1);
  let spent = budget?.calls ?? 0;
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

  for (const c of candidates) {
    if (sweep.routed >= MAX_PER_CYCLE) break;
    if (spent >= options.ceiling) {
      sweep.budgetExhausted = true;
      break;
    }

    const [cachedRow] = await db
      .select()
      .from(stopRoutes)
      .where(eq(stopRoutes.stopId, c.stop_id))
      .limit(1);

    const cached: CachedRoute | null = cachedRow
      ? {
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
      },
      now,
      config,
    );
    if (reason === null) {
      sweep.skipped += 1;
      continue;
    }

    const straight = haversineMiles(
      { lat: c.truck_lat, lng: c.truck_lng },
      { lat: c.stop_lat, lng: c.stop_lng },
    );
    // Nothing to route, and a zero denominator for the lane ratio.
    if (straight < 0.5) {
      sweep.skipped += 1;
      continue;
    }

    spent += 1;
    await countCall(db, month);

    const outcome = await provider.route({
      from: { lat: c.truck_lat, lng: c.truck_lng },
      to: { lat: c.stop_lat, lng: c.stop_lng },
    });

    if (!outcome.ok) {
      sweep.failed += 1;
      sweep.reasons[outcome.reason] = (sweep.reasons[outcome.reason] ?? 0) + 1;
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
        stopId: c.stop_id,
        destCity: c.dest_city,
        destState: c.dest_state,
        destZip: c.dest_zip,
        destPrecision: c.dest_precision,
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

    sweep.routed += 1;
    sweep.reasons[reason] = (sweep.reasons[reason] ?? 0) + 1;
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
