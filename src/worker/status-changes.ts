import { inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { etaStatusChanges } from '@/db/schema';
import { destinationKey } from '@/lib/eta-marks';
import { STATUSES, STATUS_DEFAULTS } from '@/lib/status';
import type { Db, Tx } from '@/server/audit';
import { LATEST_POSITION_SQL, applyStatus, parseFleetRows } from '@/server/fleet-query';
import { LOG_TIMEOUT_MS, describe, type WarnLogger } from './eta-marks';

/** The worker passes its database; the tests pass a transaction they roll back. */
type Conn = Db | Tx;

/**
 * The status change log (§12.126), run once per poll right after the ETA log.
 *
 * The ETA log (§12.112) writes only at distance marks, and the board
 * recomputes its status on every read, so a truck could turn AT_RISK and then
 * LATE between two marks and nothing kept it. This keeps it: for every board
 * row with a next stop, a row when the stop is first seen and a row whenever
 * the status shown or the engine's own answer changes.
 *
 * **It decides nothing.** The rows come from the board's own code — the fleet
 * query, its parser and `applyStatus` — with the worker's dispatch zone. No
 * status, ETA, freshness or next-stop rule is repeated here, so what is
 * logged is what a dispatcher reading the board at `now` was shown.
 *
 * **It must never cost the poll anything** (§12.112's rules, unchanged). One
 * transaction under the ETA log's statement timeout, one read of the
 * sequences and one insert, and a wrapper (`runStatusLog`) that catches
 * anything and logs a warning. A failure loses this poll's rows and nothing
 * else.
 */

/**
 * Rows a sequence may hold before only a FIRST is written: the first row in a
 * status, or a computed status, it has not logged before. A stop flapping
 * between two statuses all day stops growing at 100 rows, and the row that
 * says it finally went LATE is still written.
 */
export const STATUS_LOG_CAP = 100;

const Sequence = z.object({
  stop_id: z.string().uuid(),
  truck_id: z.string().uuid(),
  dest_key: z.string().nullable(),
  rows: z.number().int(),
  status: z.enum(STATUSES),
  computed: z.enum(STATUSES),
  statuses: z.array(z.enum(STATUSES)),
  computeds: z.array(z.enum(STATUSES)),
});

/** A sequence past the cap whose change was not written. Truck number and stop id only. */
export interface CappedSequence {
  truckNumber: number | null;
  stopId: string;
}

export interface StatusLogResult {
  /** Board rows with a next stop. */
  considered: number;
  /** Rows written for a sequence seen for the first time. */
  firstSeen: number;
  /** Rows written for a change, those past the cap included. */
  changes: number;
  /** Changes NOT written because their sequence is at the cap, named. */
  capped: CappedSequence[];
  /** Of `changes`, written past the cap because they were a first in their status. */
  pastCapWritten: number;
}

/**
 * The sequence key: stop, truck and destination. A null destination (no
 * coordinates) is a value here, as in the GROUP BY that reads the history —
 * two polls of the same unlocated stop are one sequence.
 */
const sequenceKey = (stopId: string, truckId: string, destKey: string | null) =>
  JSON.stringify([stopId, truckId, destKey]);

const instant = (iso: string | null) => (iso === null ? null : new Date(iso));

export async function logStatusChanges(
  db: Conn,
  dispatchTz: string,
  now: Date = new Date(),
): Promise<StatusLogResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`set local statement_timeout = ${LOG_TIMEOUT_MS}`));

    // The board, as the console builds it (server/fleet.ts): the same query,
    // the same parse, the same engine call, at `now`.
    const board = applyStatus(
      parseFleetRows(await tx.execute(LATEST_POSITION_SQL)),
      { ...STATUS_DEFAULTS, dispatchTz },
      now,
    );
    const shown = board.flatMap((row) => {
      const stop = row.nextStop;
      if (stop === null) return [];
      const destKey =
        stop.lat !== null && stop.lng !== null ? destinationKey(stop.lat, stop.lng) : null;
      return [{ row, stop, destKey }];
    });
    const result: StatusLogResult = {
      considered: shown.length,
      firstSeen: 0,
      changes: 0,
      capped: [],
      pastCapWritten: 0,
    };
    if (shown.length === 0) return result;

    /**
     * Each sequence these stops have: its length, its newest row, and every
     * status it has logged. One statement. `logged_at` is shared by rows of
     * one transaction, so the identity breaks the tie.
     */
    const history = z.array(Sequence).parse(
      await tx.execute(sql`
        select stop_id::text as stop_id, truck_id::text as truck_id, dest_key,
               count(*)::int as rows,
               (array_agg(status order by logged_at desc, id desc))[1] as status,
               (array_agg(computed order by logged_at desc, id desc))[1] as computed,
               array_agg(distinct status) as statuses,
               array_agg(distinct computed) as computeds
        from eta_status_changes
        where ${inArray(etaStatusChanges.stopId, shown.map((s) => s.stop.stopId))}
        group by stop_id, truck_id, dest_key`),
    );
    const newest = new Map(history.map((h) => [sequenceKey(h.stop_id, h.truck_id, h.dest_key), h]));

    const values: (typeof etaStatusChanges.$inferInsert)[] = [];
    for (const { row, stop, destKey } of shown) {
      const before = newest.get(sequenceKey(stop.stopId, row.id, destKey));
      if (before === undefined) {
        result.firstSeen += 1;
      } else {
        if (before.status === row.status && before.computed === row.computed) continue;
        if (before.rows >= STATUS_LOG_CAP) {
          const first =
            !before.statuses.includes(row.status) || !before.computeds.includes(row.computed);
          if (!first) {
            result.capped.push({ truckNumber: row.truckNumber, stopId: stop.stopId });
            continue;
          }
          result.pastCapWritten += 1;
        }
        result.changes += 1;
      }
      // Truck number and stop id; never a driver, a load number or an address.
      values.push({
        stopId: stop.stopId,
        truckId: row.id,
        truckNumber: row.truckNumber,
        destKey,
        status: row.status,
        computed: row.computed,
        // `applyStatus` returns the live override only (expiry on read).
        overrideLive: row.override !== null,
        prevStatus: before?.status ?? null,
        prevComputed: before?.computed ?? null,
        fixRecordedAt: instant(row.recordedAt),
        fixLat: row.lat,
        fixLng: row.lng,
        etaUtc: instant(row.etaUtc),
        milesRemaining: row.milesRemaining,
        deadlineUtc: instant(row.deadlineUtc),
        precision: row.etaPrecision,
        // The basis describes an ETA; beside none, the board shows none.
        distanceBasis: row.etaUtc === null ? null : row.distanceBasis,
        apptType: stop.apptType,
      });
    }

    if (values.length > 0) await tx.insert(etaStatusChanges).values(values);
    return result;
  });
}

/**
 * The call site's wrapper: never throws. A failed log is a warning and a lost
 * poll's worth of rows, not an error — the positions, arrivals, routes and
 * ETA marks of the same poll are already written in their own transactions.
 */
export async function runStatusLog(
  db: Conn,
  logger: WarnLogger,
  dispatchTz: string,
  now?: Date,
): Promise<StatusLogResult> {
  try {
    return await logStatusChanges(db, dispatchTz, now);
  } catch (error: unknown) {
    logger.warn('status change log failed', { error: describe(error) });
    return { considered: 0, firstSeen: 0, changes: 0, capped: [], pastCapWritten: 0 };
  }
}
