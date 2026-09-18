import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { assignments, drivers, trucks } from '@/db/schema';
import {
  type AssignmentChange,
  type AssignmentConflict,
  type AssignmentSaveResult,
} from '@/lib/assignments';
import { newBatchId, writeAudit, type AuditEntry, type Db, type Tx, type Writer } from './audit';
import type { DriverSource } from '@/lib/driver';

export type { Db, Tx, Writer };

/* ------------------------------ reading --------------------------------- */

export interface BoardTruck {
  id: string;
  truckNumber: number | null;
  samsaraName: string;
  driverId: string | null;
  driverName: string | null;
  /** §12.37: provenance travels with the name, everywhere it renders. */
  driverSource: DriverSource | null;
  driverSamsaraId: string | null;
  /** ISO 8601 UTC. When the current assignment started. */
  since: string | null;
}

export interface BoardDriver {
  id: string;
  name: string;
  active: boolean;
  /**
   * §12.35. Where the row came from, so the board can say which drivers have
   * an ELD behind them — it decides whether "no position" reads as expected
   * or as broken.
   */
  source: DriverSource;
  samsaraDriverId: string | null;
  phone: string | null;
  /** The truck this driver is currently on, if any. */
  truckId: string | null;
  truckLabel: string | null;
}

export interface AssignmentBoard {
  trucks: BoardTruck[];
  drivers: BoardDriver[];
}

/** A truck's label everywhere it is named: the number, or the raw name. */
export function truckLabel(t: { truckNumber: number | null; samsaraName: string }): string {
  return t.truckNumber === null ? t.samsaraName : String(t.truckNumber);
}

/**
 * Everything the bulk screen needs, in two queries.
 *
 * Both sides are returned whole — unassigned trucks AND unassigned drivers —
 * because the gap is the point of the screen. A list of trucks alone hides
 * the driver nobody has been given a truck.
 */
/**
 * Reads only, so it takes a transaction as happily as a connection — which is
 * what lets a test build its own board and read it back without committing.
 */
export async function loadAssignmentBoard(db: Db | Tx): Promise<AssignmentBoard> {
  const [truckRows, driverRows] = await Promise.all([
    db
      .select({
        id: trucks.id,
        truckNumber: trucks.truckNumber,
        samsaraName: trucks.samsaraName,
        driverId: drivers.id,
        driverName: drivers.name,
        driverSource: drivers.source,
        driverSamsaraId: drivers.samsaraDriverId,
        since: assignments.startedAt,
      })
      .from(trucks)
      .leftJoin(
        assignments,
        and(eq(assignments.truckId, trucks.id), isNull(assignments.endedAt)),
      )
      .leftJoin(drivers, eq(drivers.id, assignments.driverId))
      .where(eq(trucks.active, true))
      .orderBy(asc(trucks.truckNumber)),
    db
      .select({
        id: drivers.id,
        name: drivers.name,
        active: drivers.active,
        // §12.35: a dispatcher must be able to tell a driver with an ELD
        // behind them from one without, because it decides whether "no
        // position" means expected or broken.
        source: drivers.source,
        samsaraDriverId: drivers.samsaraDriverId,
        phone: drivers.phone,
        truckId: trucks.id,
        truckNumber: trucks.truckNumber,
        samsaraName: trucks.samsaraName,
      })
      .from(drivers)
      .leftJoin(
        assignments,
        and(eq(assignments.driverId, drivers.id), isNull(assignments.endedAt)),
      )
      .leftJoin(trucks, eq(trucks.id, assignments.truckId))
      // A retired driver is off the board but keeps their history (§12.35).
      .where(and(eq(drivers.active, true), isNull(drivers.retiredAt)))
      .orderBy(asc(drivers.name)),
  ]);

  return {
    // A typed select applies the column decoders, so `since` is a Date here —
    // unlike a raw sql result. Converted once, at the edge.
    trucks: truckRows.map((t) => ({
      id: t.id,
      truckNumber: t.truckNumber,
      samsaraName: t.samsaraName,
      driverId: t.driverId,
      driverName: t.driverName,
      driverSource: t.driverSource,
      driverSamsaraId: t.driverSamsaraId,
      since: t.since ? t.since.toISOString() : null,
    })),
    drivers: driverRows.map((d) => ({
      id: d.id,
      name: d.name,
      active: d.active,
      source: d.source,
      samsaraDriverId: d.samsaraDriverId,
      phone: d.phone,
      truckId: d.truckId,
      truckLabel:
        d.truckId === null
          ? null
          : truckLabel({ truckNumber: d.truckNumber, samsaraName: d.samsaraName ?? '' }),
    })),
  };
}

/* ------------------------------ writing --------------------------------- */

export class AssignmentConflictError extends Error {
  constructor(readonly conflicts: AssignmentConflict[]) {
    super(`${conflicts.length} conflict(s): ${conflicts.map((c) => c.message).join(' ')}`);
    this.name = 'AssignmentConflictError';
  }
}

/**
 * A raw `sql` result is whatever the driver decoded — parsed, never asserted.
 * `as unknown as Row[]` on a raw query is what let a Date masquerade as a
 * string in the fleet query and take down the first real render.
 */
const OpenRows = z.array(
  z.object({
    id: z.string().uuid(),
    truck_id: z.string().uuid(),
    driver_id: z.string().uuid(),
  }),
);

/**
 * Saves the whole board in one transaction.
 *
 * Nothing is written until every row has been checked. If row 14 of 23
 * conflicts, the save rolls back and the response names EVERY conflict —
 * a partial commit with a vague error is the failure mode this screen exists
 * to avoid, and the two partial unique indexes would have produced exactly
 * that, one row at a time.
 */
export async function saveAssignments(
  db: Db | Tx,
  /** `actorUserId` is null only for a system action — never for a dispatcher. */
  input: { actorUserId: string | null; changes: AssignmentChange[] },
): Promise<AssignmentSaveResult> {
  return db.transaction(async (tx) => {
    /**
     * Lock every open assignment for the duration. Without this, two
     * dispatchers saving the board at the same moment both pass validation
     * and the second one dies on a unique index instead of on a conflict
     * list — which is the same partial-failure experience, just later.
     */
    const open = OpenRows.parse(
      await tx.execute(sql`
        select a.id::text as id, a.truck_id::text as truck_id, a.driver_id::text as driver_id
        from assignments a
        where a.ended_at is null
        for update
      `),
    ).map((r) => ({ id: r.id, truckId: r.truck_id, driverId: r.driver_id }));

    const openByTruck = new Map(open.map((r) => [r.truckId, r]));

    const truckRows = await tx
      .select({
        id: trucks.id,
        truckNumber: trucks.truckNumber,
        samsaraName: trucks.samsaraName,
        active: trucks.active,
      })
      .from(trucks);
    const truckById = new Map(truckRows.map((t) => [t.id, t]));

    const driverRows = await tx
      .select({ id: drivers.id, name: drivers.name, active: drivers.active })
      .from(drivers);
    const driverById = new Map(driverRows.map((d) => [d.id, d]));

    const conflicts: AssignmentConflict[] = [];
    const label = (id: string) => {
      const t = truckById.get(id);
      return t ? `truck ${truckLabel(t)}` : `truck ${id}`;
    };

    // Last write wins if the same truck appears twice in one payload; the UI
    // cannot produce that, but the server does not assume the UI.
    const requested = new Map(input.changes.map((c) => [c.truckId, c.driverId]));

    for (const [truckId, driverId] of requested) {
      const truck = truckById.get(truckId);
      if (!truck) {
        conflicts.push({
          reason: 'UNKNOWN_TRUCK',
          truckIds: [truckId],
          message: `No truck with id ${truckId}.`,
        });
        continue;
      }
      if (!truck.active) {
        conflicts.push({
          reason: 'INACTIVE_TRUCK',
          truckIds: [truckId],
          message: `${label(truckId)} is inactive and cannot hold a driver.`,
        });
      }
      if (driverId === null) continue;

      const driver = driverById.get(driverId);
      if (!driver) {
        conflicts.push({
          reason: 'UNKNOWN_DRIVER',
          truckIds: [truckId],
          message: `${label(truckId)}: no driver with id ${driverId}.`,
        });
      } else if (!driver.active) {
        conflicts.push({
          reason: 'INACTIVE_DRIVER',
          truckIds: [truckId],
          message: `${label(truckId)}: ${driver.name} is inactive.`,
        });
      }
    }

    /**
     * The final state of the WHOLE fleet, not just the edited rows: trucks
     * left alone keep their driver. That is what catches the subtle one —
     * putting a driver on truck B while truck A, untouched by this save,
     * still holds them. Checking only the payload would miss it and leave the
     * unique index to fail the insert with no useful message.
     */
    const finalDriverByTruck = new Map<string, string>();
    for (const row of open) finalDriverByTruck.set(row.truckId, row.driverId);
    for (const [truckId, driverId] of requested) {
      if (driverId === null) finalDriverByTruck.delete(truckId);
      else finalDriverByTruck.set(truckId, driverId);
    }

    const trucksByDriver = new Map<string, string[]>();
    for (const [truckId, driverId] of finalDriverByTruck) {
      trucksByDriver.set(driverId, [...(trucksByDriver.get(driverId) ?? []), truckId]);
    }
    for (const [driverId, truckIds] of trucksByDriver) {
      if (truckIds.length < 2) continue;
      const name = driverById.get(driverId)?.name ?? driverId;
      conflicts.push({
        reason: 'DRIVER_ON_TWO_TRUCKS',
        truckIds: [...truckIds].sort(),
        message: `${truckIds.map(label).join(' and ')} both take ${name}.`,
      });
    }

    if (conflicts.length > 0) throw new AssignmentConflictError(conflicts);

    /* ---------------------------- apply ------------------------------- */

    const batchId = newBatchId();
    const audit: AuditEntry[] = [];
    let assigned = 0;
    let cleared = 0;
    let unchanged = 0;

    for (const [truckId, driverId] of requested) {
      const current = openByTruck.get(truckId);
      if ((current?.driverId ?? null) === driverId) {
        unchanged += 1;
        continue;
      }

      if (current) {
        await tx
          .update(assignments)
          .set({ endedAt: sql`now()` })
          .where(eq(assignments.id, current.id));
      }
      if (driverId !== null) {
        await tx
          .insert(assignments)
          .values({ truckId, driverId, createdBy: input.actorUserId });
        assigned += 1;
      } else {
        cleared += 1;
      }

      /**
       * Keyed by TRUCK, not by assignment row. The question asked of this log
       * is always "who put this driver on this truck" — which is an index hit
       * on (entity, entity_id) — never "what happened in batch 7". The batch
       * id rides along for the rarer second question.
       */
      audit.push({
        actorUserId: input.actorUserId,
        entity: 'truck',
        entityId: truckId,
        before: {
          driverId: current?.driverId ?? null,
          driverName: current ? (driverById.get(current.driverId)?.name ?? null) : null,
        },
        after: {
          driverId,
          driverName: driverId ? (driverById.get(driverId)?.name ?? null) : null,
          batch: batchId,
          source: 'bulk-assignment',
        },
      });
    }

    await writeAudit(tx, audit);
    return { assigned, cleared, unchanged, batchId };
  });
}
