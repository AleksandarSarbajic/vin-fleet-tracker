import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { etaMarks } from '@/db/schema';
import {
  destinationKey,
  marksCrossed,
  replayAt,
  routeFreshAt,
  stoppedMinutes,
  type TrackFix,
} from '@/lib/eta-marks';
import type { CachedRoute } from '@/lib/routing';
import { STATUS_DEFAULTS, haversineMiles } from '@/lib/status';
import type { Db, Tx } from '@/server/audit';

/** The worker passes its database; the tests pass a transaction they roll back. */
type Conn = Db | Tx;
import { NEXT_STOP_ORDER } from '@/server/next-stop';

/**
 * The ETA prediction log (§12.112), run once per poll after the routing sweep.
 *
 * It records what the board would show for each truck's next stop — the same
 * position, the same cached route, the same `projectDistance` — once when the
 * stop is first seen and once per distance crossed. It makes no routing call
 * and changes no ETA.
 *
 * **It must never cost the poll anything.** Every statement runs under a short
 * `statement_timeout`, the whole step is one transaction, and the caller
 * (`runEtaLog`) catches anything it throws and logs a warning. A failure here
 * loses one poll's rows; it cannot lose positions, an arrival or a route.
 */

/** Long enough for a few dozen rows; short enough that a stuck lock cannot stall a poll. */
const LOG_TIMEOUT_MS = 3_000;
/** The settle step runs hourly and reads positions; give it more, but bound it. */
const SETTLE_TIMEOUT_MS = 10_000;
/** Destinations settled per run. Arrivals are a handful an hour. */
const SETTLE_BATCH = 10;

const epochMs = (column: string) => sql.raw(`(extract(epoch from ${column}) * 1000)::float8`);

const Candidate = z.object({
  stop_id: z.string().uuid(),
  truck_id: z.string().uuid(),
  truck_number: z.number().int().nullable(),
  truck_lat: z.number(),
  truck_lng: z.number(),
  fix_speed_mph: z.number().nullable(),
  fix_ms: z.number(),
  stop_lat: z.number(),
  stop_lng: z.number(),
  precision: z.enum(['street', 'block', 'zip']).nullable(),
  accuracy_miles: z.number().nullable(),
  deadline_ms: z.number().nullable(),
  routed_miles: z.number().nullable(),
  routed_duration_s: z.number().nullable(),
  base_duration_s: z.number().nullable(),
  from_lat: z.number().nullable(),
  from_lng: z.number().nullable(),
  straight_at_route_miles: z.number().nullable(),
  lane_ratio: z.number().nullable(),
  snap_from_m: z.number().nullable(),
  snap_to_m: z.number().nullable(),
  provider: z.string().nullable(),
  route_ms: z.number().nullable(),
});
type Candidate = z.infer<typeof Candidate>;

function cachedRoute(c: Candidate): CachedRoute | null {
  if (
    c.routed_miles === null ||
    c.routed_duration_s === null ||
    c.straight_at_route_miles === null ||
    c.lane_ratio === null ||
    c.provider === null ||
    c.route_ms === null
  ) {
    return null;
  }
  return {
    provider: c.provider,
    routedMiles: c.routed_miles,
    routedDurationS: c.routed_duration_s,
    fromLat: c.from_lat ?? NaN,
    fromLng: c.from_lng ?? NaN,
    straightAtRouteMiles: c.straight_at_route_miles,
    laneRatio: c.lane_ratio,
    stopLat: c.stop_lat,
    stopLng: c.stop_lng,
    snapFromM: c.snap_from_m,
    snapToM: c.snap_to_m,
    computedAtUtc: new Date(c.route_ms).toISOString(),
  };
}

export interface EtaLogResult {
  considered: number;
  firstSeen: number;
  marks: number;
}

/**
 * One poll's rows: a first-seen row for any stop not seen before, and a row
 * per distance crossed for the first time. Inserted in one statement with
 * `on conflict do nothing`, so the unique indexes — not this code — have the
 * last word on "only once".
 */
export async function logEtaMarks(db: Conn, now: Date = new Date()): Promise<EtaLogResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`set local statement_timeout = ${LOG_TIMEOUT_MS}`));

    /** Every active truck's next stop with coordinates, as the routing sweep selects it. */
    const rows = await tx.execute(sql`
      select
        ns.stop_id, t.id::text as truck_id, t.truck_number,
        p.lat as truck_lat, p.lng as truck_lng, p.speed_mph as fix_speed_mph,
        ${epochMs('p.recorded_at')} as fix_ms,
        ns.stop_lat, ns.stop_lng, ns.precision, ns.accuracy_miles,
        ${epochMs('ns.deadline')} as deadline_ms,
        sr.routed_miles, sr.routed_duration_s, sr.base_duration_s, sr.from_lat, sr.from_lng,
        sr.straight_at_route_miles, sr.lane_ratio, sr.snap_from_m, sr.snap_to_m, sr.provider,
        ${epochMs('sr.computed_at')} as route_ms
      from trucks t
      join lateral (
        select lat, lng, speed_mph, recorded_at from positions
        where truck_id = t.id order by recorded_at desc limit 1
      ) p on true
      join lateral (
        select s.id::text as stop_id, s.lat as stop_lat, s.lng as stop_lng,
               s.geocode_precision::text as precision,
               s.geocode_accuracy_miles as accuracy_miles,
               -- The engine's deadline: the end of the window, else its start.
               coalesce(s.appointment_end_utc, s.appointment_start_utc) as deadline
        from loads l
        join stops s on s.load_id = l.id
        where l.truck_id = t.id
          and l.status not in ('DELIVERED', 'TONU', 'CANCELLED')
          and s.departed_at is null
          and s.arrived_at is null
          and s.lat is not null and s.lng is not null
        ${NEXT_STOP_ORDER}
        limit 1
      ) ns on true
      -- The board's own join: a route measured to another point is not this stop's.
      left join stop_routes sr
        on sr.stop_id = ns.stop_id::uuid and sr.stop_lat = ns.stop_lat and sr.stop_lng = ns.stop_lng
      where t.active`);
    const candidates = z.array(Candidate).parse(rows);

    /**
     * What is already logged for these stops, matched to each one's CURRENT
     * point by `destinationKey` — never by comparing floats in SQL — so a
     * re-geocoded stop starts a new trip and a float that merely changed
     * spelling does not.
     */
    const existing =
      candidates.length === 0
        ? []
        : await tx
            .select({
              stopId: etaMarks.stopId,
              destKey: etaMarks.destKey,
              markMiles: etaMarks.markMiles,
              straightMiles: etaMarks.straightMiles,
            })
            .from(etaMarks)
            .where(inArray(etaMarks.stopId, candidates.map((c) => c.stop_id)));

    const values: (typeof etaMarks.$inferInsert)[] = [];
    let firstSeenRows = 0;
    let marks = 0;
    for (const c of candidates) {
      const truck = { lat: c.truck_lat, lng: c.truck_lng };
      const stop = { lat: c.stop_lat, lng: c.stop_lng };
      const straight = haversineMiles(truck, stop);
      const destKey = destinationKey(c.stop_lat, c.stop_lng);
      const trip = existing.filter((e) => e.stopId === c.stop_id && e.destKey === destKey);
      const firstSeen = trip.find((e) => e.markMiles === null);

      let toLog: (number | null)[];
      if (!firstSeen) {
        toLog = [null];
      } else {
        const logged = new Set(trip.flatMap((e) => (e.markMiles === null ? [] : [e.markMiles])));
        toLog = marksCrossed(firstSeen.straightMiles, straight, logged);
      }
      if (toLog.length === 0) continue;

      const route = cachedRoute(c);
      const fresh = routeFreshAt(route, truck, stop, now);
      const replay = replayAt({
        anchorMs: c.fix_ms,
        straight,
        route,
        fresh,
        config: STATUS_DEFAULTS,
      });

      for (const mark of toLog) {
        if (mark === null) firstSeenRows += 1;
        else marks += 1;
        values.push({
          stopId: c.stop_id,
          truckId: c.truck_id,
          truckNumber: c.truck_number,
          markMiles: mark,
          destLat: c.stop_lat,
          destLng: c.stop_lng,
          destKey,
          destPrecision: c.precision,
          destAccuracyMiles: c.accuracy_miles,
          deadlineUtc: c.deadline_ms === null ? null : new Date(c.deadline_ms),
          fixRecordedAt: new Date(c.fix_ms),
          fixLat: c.truck_lat,
          fixLng: c.truck_lng,
          fixSpeedMph: c.fix_speed_mph,
          straightMiles: straight,
          basis: replay.shown.basis,
          projectedMiles: replay.shown.miles,
          speedMph: replay.shown.speedMph,
          etaUtc: new Date(replay.shown.etaMs),
          routeRoutedMiles: route?.routedMiles ?? null,
          routeDurationS: route?.routedDurationS ?? null,
          routeBaseDurationS: route ? c.base_duration_s : null,
          routeStraightMiles: route?.straightAtRouteMiles ?? null,
          routeLaneRatio: route?.laneRatio ?? null,
          routeComputedAt: route ? new Date(route.computedAtUtc) : null,
          avgSpeedMph: STATUS_DEFAULTS.avgSpeedMph,
          roadFactor: STATUS_DEFAULTS.roadFactor,
        });
      }
    }

    if (values.length > 0) await tx.insert(etaMarks).values(values).onConflictDoNothing();
    return { considered: candidates.length, firstSeen: firstSeenRows, marks };
  });
}

/** What a warning may say about a failure: the database's own message, short. */
function describe(error: unknown): string {
  // Drizzle wraps a failed query in an error whose message carries the SQL and
  // its parameters. The cause is the database's sentence, and says enough.
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.slice(0, 200);
}

export interface WarnLogger {
  warn: (message: string, fields?: Record<string, unknown>) => void;
}

/**
 * The call site's wrapper: never throws. A failed log is a warning and a lost
 * poll's worth of rows, not an error — the board, the arrivals and the routes
 * are untouched by it.
 */
export async function runEtaLog(db: Conn, logger: WarnLogger, now?: Date): Promise<EtaLogResult> {
  try {
    return await logEtaMarks(db, now);
  } catch (error: unknown) {
    logger.warn('eta mark log failed', { error: describe(error) });
    return { considered: 0, firstSeen: 0, marks: 0 };
  }
}

/* --------------------------------- settle -------------------------------- */

const Group = z.object({
  stop_id: z.string().uuid(),
  dest_key: z.string(),
  truck_id: z.string().uuid(),
  from_ms: z.number(),
  stop_lat: z.number().nullable(),
  stop_lng: z.number().nullable(),
  arrived_ms: z.number().nullable(),
  arrived_source: z.enum(['detected', 'dispatcher']).nullable(),
  departed: z.boolean(),
  load_closed: z.boolean(),
});

const Fix = z.object({
  at_ms: z.number(),
  lat: z.number(),
  lng: z.number(),
  speed_mph: z.number().nullable(),
});

export interface SettleResult {
  arrived: number;
  destinationChanged: number;
  closedWithoutArrival: number;
}

/**
 * Fills in what happened, hourly, BEFORE positions are pruned (§12.112).
 *
 *   `arrived`                 the stop's arrival, and the minutes the truck
 *                             spent stopped between each prediction and it —
 *                             read from positions now, while they still exist.
 *   `destination-changed`     the stop now points somewhere else. Its old
 *                             predictions are about a trip that never got an
 *                             arrival here, and must not borrow the new one.
 *   `closed-without-arrival`  the load closed (or the stop departed) with no
 *                             arrival — a ZIP stop, usually. Nothing to score.
 *
 * Anything else is still in progress and is left for the next run.
 */
export async function settleEtaMarks(db: Conn, now: Date = new Date()): Promise<SettleResult> {
  const result: SettleResult = { arrived: 0, destinationChanged: 0, closedWithoutArrival: 0 };
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`set local statement_timeout = ${SETTLE_TIMEOUT_MS}`));
    const groups = z.array(Group).parse(
      await tx.execute(sql`
        select m.stop_id::text as stop_id, m.dest_key, m.truck_id::text as truck_id,
               min(${epochMs('m.fix_recorded_at')}) as from_ms,
               s.lat as stop_lat, s.lng as stop_lng,
               ${epochMs('s.arrived_at')} as arrived_ms, s.arrived_source::text as arrived_source,
               (s.departed_at is not null) as departed,
               (l.status in ('DELIVERED', 'TONU', 'CANCELLED')) as load_closed
        from eta_marks m
        join stops s on s.id = m.stop_id
        join loads l on l.id = s.load_id
        where m.settled_at is null
        group by m.stop_id, m.dest_key, m.truck_id, s.lat, s.lng, s.arrived_at,
                 s.arrived_source, s.departed_at, l.status
        order by min(m.fix_recorded_at)
        limit ${SETTLE_BATCH}`),
    );

    for (const g of groups) {
      const sameGroup = and(
        eq(etaMarks.stopId, g.stop_id),
        eq(etaMarks.destKey, g.dest_key),
        eq(etaMarks.truckId, g.truck_id),
        isNull(etaMarks.settledAt),
      );

      // The same key the log wrote, from the same function: an old point
      // never borrows the new point's arrival.
      const current =
        g.stop_lat === null || g.stop_lng === null ? null : destinationKey(g.stop_lat, g.stop_lng);
      if (current !== g.dest_key) {
        await tx
          .update(etaMarks)
          .set({ settledAt: now, settleOutcome: 'destination-changed' })
          .where(sameGroup);
        result.destinationChanged += 1;
        continue;
      }

      if (g.arrived_ms !== null) {
        const fixes: TrackFix[] = z
          .array(Fix)
          .parse(
            await tx.execute(sql`
              select ${epochMs('recorded_at')} as at_ms, lat, lng, speed_mph from positions
              where truck_id = ${g.truck_id}::uuid
                and recorded_at between to_timestamp(${g.from_ms / 1000})
                                    and to_timestamp(${g.arrived_ms / 1000})
              order by recorded_at`),
          )
          .map((f) => ({ atMs: f.at_ms, lat: f.lat, lng: f.lng, speedMph: f.speed_mph }));
        const rows = await tx
          .select({ id: etaMarks.id, fixRecordedAt: etaMarks.fixRecordedAt })
          .from(etaMarks)
          .where(sameGroup);
        for (const row of rows) {
          const stopped = stoppedMinutes(fixes, row.fixRecordedAt.getTime(), g.arrived_ms);
          await tx
            .update(etaMarks)
            .set({
              settledAt: now,
              settleOutcome: 'arrived',
              arrivedAt: new Date(g.arrived_ms),
              arrivedSource: g.arrived_source,
              stoppedMinutes: stopped.covered ? stopped.minutes : null,
            })
            .where(eq(etaMarks.id, row.id));
        }
        result.arrived += 1;
        continue;
      }

      if (g.departed || g.load_closed) {
        await tx
          .update(etaMarks)
          .set({ settledAt: now, settleOutcome: 'closed-without-arrival' })
          .where(sameGroup);
        result.closedWithoutArrival += 1;
      }
    }
  });
  return result;
}

/** The hourly wrapper: never throws, so the prune after it always runs. */
export async function runEtaSettle(
  db: Conn,
  logger: WarnLogger & { info: (message: string, fields?: Record<string, unknown>) => void },
  now?: Date,
): Promise<SettleResult | null> {
  try {
    const result = await settleEtaMarks(db, now);
    if (result.arrived + result.destinationChanged + result.closedWithoutArrival > 0) {
      logger.info('eta marks settled', { ...result });
    }
    return result;
  } catch (error: unknown) {
    logger.warn('eta mark settle failed', { error: describe(error) });
    return null;
  }
}
