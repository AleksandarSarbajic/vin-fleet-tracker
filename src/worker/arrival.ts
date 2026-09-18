import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { positions as positionsTable, stops } from '@/db/schema';
import {
  ARRIVAL_DEFAULTS,
  detectArrival,
  detectDeparture,
  explainNearest,
  type ArrivalConfig,
  type Fix,
  type NearestCandidate,
} from '@/lib/arrival';
import { writeAudit, type Db } from '@/server/audit';

/**
 * Arrival and departure detection, run once per poll (§12.27).
 *
 * The decision lives in lib/arrival.ts and is pure; this file is the two
 * queries around it and the write. Splitting them is what let the radius be
 * chosen against truck 143's real track rather than against a fixture.
 *
 * ## The window, and what it costs after an outage
 *
 * Only positions from the last 30 minutes are considered. In steady state
 * that is irrelevant: the worker polls every 30 s, so an arrival is confirmed
 * about two minutes after it happens and the run's first fix is the true
 * arrival instant.
 *
 * After an outage longer than the window it is NOT irrelevant. A truck that
 * parked three hours ago will be recorded as arriving at the window's edge,
 * because the worker cannot see further back than it looks. That is a bounded,
 * stated inaccuracy rather than a hidden one — and it is the reason the window
 * is 30 minutes and not 5.
 */

const WINDOW_MINUTES = 30;

/** §12.13's next stop, with the geocode the detection needs. */
const CandidateRow = z.object({
  stop_id: z.string().uuid(),
  truck_id: z.string().uuid(),
  truck_number: z.number().int().nullable(),
  lat: z.number(),
  lng: z.number(),
  precision: z.enum(['street', 'block', 'zip']).nullable(),
  arrived_at: z.string().nullable(),
  departed_at: z.string().nullable(),
});

export interface ArrivalSweep {
  arrived: number;
  departed: number;
  considered: number;
  /**
   * The closest any watched truck got, and what stopped it counting (§12.36).
   *
   * Without this, `arrived: 0` is the same line whether the fleet is 600
   * miles out or one poll short of confirming. That ambiguity is why nobody
   * noticed this had never fired.
   */
  nearest: NearestCandidate | null;
}

export interface SweepLogger {
  info: (message: string, fields?: Record<string, unknown>) => void;
}

export async function sweepArrivals(
  db: Db,
  logger: SweepLogger,
  config: ArrivalConfig = ARRIVAL_DEFAULTS,
): Promise<ArrivalSweep> {
  /**
   * The next stop per truck, exactly as §12.13 defines it: the earliest
   * undeparted stop across every OPEN load. Restricted to stops that have
   * coordinates, because nothing can be detected without them — which is why
   * this could not have been built before the geocoder (§12.24).
   */
  const candidateResult = await db.execute(sql`
    select
      ns.stop_id, t.id::text as truck_id, t.truck_number,
      ns.lat, ns.lng, ns.precision, ns.arrived_at, ns.departed_at
    from trucks t
    join lateral (
      select s.id::text as stop_id, s.lat, s.lng,
             s.geocode_precision::text as precision,
             to_char(s.arrived_at  at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as arrived_at,
             to_char(s.departed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as departed_at
      from loads l
      join stops s on s.load_id = l.id
      where l.truck_id = t.id
        and l.status not in ('DELIVERED', 'TONU', 'CANCELLED')
        and s.departed_at is null
        and s.lat is not null and s.lng is not null
        -- §12.30: only a street-level coordinate can be arrived at. Filtered
        -- HERE as well as in the pure rule, so the sweep does not fetch
        -- positions for stops it could never conclude anything about.
        and s.geocode_precision = 'street'
      order by s.appointment_start_utc asc nulls last, s.sequence asc
      limit 1
    ) ns on true
    where t.active`);

  const candidates = z.array(CandidateRow).parse(candidateResult);
  if (candidates.length === 0) {
    return { arrived: 0, departed: 0, considered: 0, nearest: null };
  }

  const truckIds = candidates.map((c) => c.truck_id);
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);

  /**
   * The TYPED builder, not db.execute: the ids are parameterised rather than
   * pasted into the string, and the column decoders hand back real Dates so
   * nothing here has to guess what a timestamptz looks like.
   */
  const positions = await db
    .select({
      truckId: positionsTable.truckId,
      lat: positionsTable.lat,
      lng: positionsTable.lng,
      speedMph: positionsTable.speedMph,
      recordedAt: positionsTable.recordedAt,
    })
    .from(positionsTable)
    .where(and(inArray(positionsTable.truckId, truckIds), gte(positionsTable.recordedAt, since)))
    .orderBy(desc(positionsTable.recordedAt));

  const byTruck = new Map<string, Fix[]>();
  for (const row of positions) {
    const list = byTruck.get(row.truckId) ?? [];
    list.push({
      lat: row.lat,
      lng: row.lng,
      speedMph: row.speedMph,
      recordedAtUtc: row.recordedAt.toISOString(),
    });
    byTruck.set(row.truckId, list);
  }

  let arrived = 0;
  let departed = 0;
  let nearest: NearestCandidate | null = null;

  for (const candidate of candidates) {
    const fixes = byTruck.get(candidate.truck_id) ?? [];
    if (fixes.length === 0) continue;

    const stopGeo = {
      lat: candidate.lat,
      lng: candidate.lng,
      precision: candidate.precision,
      arrivedAt: candidate.arrived_at,
      departedAt: candidate.departed_at,
    };

    const explained = explainNearest(stopGeo, fixes, config);
    if (explained && (nearest === null || explained.miles < nearest.miles)) {
      nearest = {
        stopId: candidate.stop_id,
        truckNumber: candidate.truck_number,
        miles: explained.miles,
        speedMph: explained.speedMph,
        blockedBy: explained.blockedBy,
      };
    }

    const arrivedAt = detectArrival(stopGeo, fixes, config);
    if (arrivedAt !== null) {
      await write(db, candidate, { arrivedAt }, config);
      arrived += 1;
      logger.info('arrival detected', {
        truck: candidate.truck_number,
        stopId: candidate.stop_id,
        arrivedAt,
      });
      continue;
    }

    const departedAt = detectDeparture(stopGeo, fixes, config);
    if (departedAt !== null) {
      await write(db, candidate, { departedAt }, config);
      departed += 1;
      logger.info('departure detected', {
        truck: candidate.truck_number,
        stopId: candidate.stop_id,
        departedAt,
      });
    }
  }

  /**
   * Logged every sweep, not only when something happens. A near miss has to
   * be visible for the same reason an arrival does.
   */
  if (nearest) {
    logger.info('arrival sweep', {
      considered: candidates.length,
      arrived,
      departed,
      nearestTruck: nearest.truckNumber,
      nearestMiles: Number(nearest.miles.toFixed(3)),
      nearestSpeedMph: nearest.speedMph,
      nearestBlockedBy: nearest.blockedBy,
      radiusMiles: config.radiusMiles,
    });
  }

  return { arrived, departed, considered: candidates.length, nearest };
}

/**
 * One transaction per stop: the column and the audit row that explains it.
 *
 * A dispatcher seeing a stop flip to ARRIVED with nobody's name on it needs
 * to be able to find out why, and `audit_log` is the only place that answers
 * it. `actorUserId` is null because no human did this — the actor is named in
 * the payload, which is the same shape the edit modal uses for `source`.
 */
async function write(
  db: Db,
  candidate: z.infer<typeof CandidateRow>,
  change: { arrivedAt: string } | { departedAt: string },
  config: ArrivalConfig,
): Promise<void> {
  const isArrival = 'arrivedAt' in change;
  await db.transaction(async (tx) => {
    await tx
      .update(stops)
      .set(
        isArrival
          ? { arrivedAt: sql`${change.arrivedAt}::timestamptz` }
          : { departedAt: sql`${change.departedAt}::timestamptz` },
      )
      .where(eq(stops.id, candidate.stop_id));

    await writeAudit(tx, {
      actorUserId: null,
      entity: 'stop',
      entityId: candidate.stop_id,
      before: isArrival
        ? { arrivedAt: null }
        : { arrivedAt: candidate.arrived_at, departedAt: null },
      after: {
        ...change,
        source: 'worker',
        /** What convinced it, so the threshold is arguable after the fact. */
        detection: {
          rule: isArrival ? 'arrival' : 'departure',
          radiusMiles: config.radiusMiles,
          confirmSeconds: config.confirmSeconds,
          stopLat: candidate.lat,
          stopLng: candidate.lng,
        },
      },
    });
  });
}
