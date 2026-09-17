import { afterAll, describe, expect, it } from 'vitest';
import { eq, isNull, and } from 'drizzle-orm';
import { createPooledDb } from '@/db/connection';
import { assignments, drivers, trucks } from '@/db/schema';
import { AssignmentConflictError, loadAssignmentBoard, saveAssignments } from './assignments';
import type { Tx } from './audit';

/**
 * Against the real database, inside a transaction that ALWAYS rolls back.
 * Nothing here survives the test — this is the customer's project, and a
 * test that leaves an assignment behind is a test that puts a driver on a
 * truck nobody assigned.
 */

const url = process.env.DATABASE_URL;
const withDb = url ? describe : describe.skip;

let handle: ReturnType<typeof createPooledDb> | null = null;
const connect = () => (handle ??= createPooledDb(url!));
afterAll(async () => {
  await handle?.client.end({ timeout: 5 });
});

/** Runs `body` in a transaction and rolls it back, whatever happens. */
async function rolledBack<T>(body: (tx: Tx) => Promise<T>): Promise<T> {
  const { db } = connect();
  let out: T;
  try {
    await db.transaction(async (tx) => {
      out = await body(tx);
      tx.rollback();
    });
  } catch (error) {
    if (out! === undefined) throw error;
  }
  return out!;
}

withDb('the assignment board', () => {
  it('lists active trucks and active drivers, both sides whole', async () => {
    const { db } = connect();
    const board = await loadAssignmentBoard(db);
    expect(board.trucks.length).toBeGreaterThan(0);
    expect(board.drivers.length).toBeGreaterThan(0);
    // The gap is the point of the screen: a driver with no truck must appear.
    expect(board.drivers.some((d) => d.truckId === null)).toBe(true);
  });

  it('returns `since` as an ISO string, never a Date', async () => {
    const { db } = connect();
    const board = await loadAssignmentBoard(db);
    for (const t of board.trucks) {
      if (t.since !== null) expect(typeof t.since).toBe('string');
    }
  });
});

withDb('saving the board', () => {
  const twoTrucks = async (tx: Tx) => {
    const rows = await tx
      .select({ id: trucks.id, number: trucks.truckNumber })
      .from(trucks)
      .where(eq(trucks.active, true))
      .limit(2);
    return rows;
  };
  const twoDrivers = async (tx: Tx) =>
    tx.select({ id: drivers.id, name: drivers.name }).from(drivers).limit(2);

  it('assigns, and the open row is readable in the same transaction', async () => {
    const result = await rolledBack(async (tx) => {
      const [truck] = await twoTrucks(tx);
      const [driver] = await twoDrivers(tx);
      const saved = await saveAssignments(tx, {
        actorUserId: null,
        changes: [{ truckId: truck!.id, driverId: driver!.id }],
      });
      const open = await tx
        .select({ driverId: assignments.driverId })
        .from(assignments)
        .where(and(eq(assignments.truckId, truck!.id), isNull(assignments.endedAt)));
      return { saved, openDriver: open[0]?.driverId, driverId: driver!.id };
    });
    expect(result.saved.assigned).toBe(1);
    expect(result.openDriver).toBe(result.driverId);
  });

  it('refuses one driver on two trucks, naming both', async () => {
    const conflicts = await rolledBack(async (tx) => {
      const ts = await twoTrucks(tx);
      const [driver] = await twoDrivers(tx);
      try {
        await saveAssignments(tx, {
          actorUserId: null,
          changes: ts.map((t) => ({ truckId: t.id, driverId: driver!.id })),
        });
        return null;
      } catch (error) {
        if (!(error instanceof AssignmentConflictError)) throw error;
        return error.conflicts;
      }
    });
    expect(conflicts).not.toBeNull();
    expect(conflicts![0]!.reason).toBe('DRIVER_ON_TWO_TRUCKS');
    // Both trucks named, not just the second one to be validated.
    expect(conflicts![0]!.truckIds).toHaveLength(2);
  });

  it('catches a driver still open on a truck this save did not touch', async () => {
    // The subtle one: validating only the edited rows would miss it and leave
    // the unique index to fail the insert with nothing useful to show.
    const conflicts = await rolledBack(async (tx) => {
      const ts = await twoTrucks(tx);
      const [driver] = await twoDrivers(tx);
      await saveAssignments(tx, {
        actorUserId: null,
        changes: [{ truckId: ts[0]!.id, driverId: driver!.id }],
      });
      try {
        await saveAssignments(tx, {
          actorUserId: null,
          changes: [{ truckId: ts[1]!.id, driverId: driver!.id }],
        });
        return null;
      } catch (error) {
        if (!(error instanceof AssignmentConflictError)) throw error;
        return error.conflicts;
      }
    });
    expect(conflicts?.[0]?.reason).toBe('DRIVER_ON_TWO_TRUCKS');
  });

  it('writes nothing at all when any row conflicts', async () => {
    const after = await rolledBack(async (tx) => {
      const ts = await twoTrucks(tx);
      const ds = await twoDrivers(tx);
      const before = await tx.select({ id: assignments.id }).from(assignments);
      try {
        await saveAssignments(tx, {
          actorUserId: null,
          changes: [
            // Row 1 is perfectly valid …
            { truckId: ts[0]!.id, driverId: ds[0]!.id },
            // … and row 2 takes the same driver. Neither may land.
            { truckId: ts[1]!.id, driverId: ds[0]!.id },
          ],
        });
      } catch {
        /* expected */
      }
      const now = await tx.select({ id: assignments.id }).from(assignments);
      return { before: before.length, now: now.length };
    });
    expect(after.now).toBe(after.before);
  });

  it('names every conflict in one response, not the first', async () => {
    const conflicts = await rolledBack(async (tx) => {
      const ts = await twoTrucks(tx);
      const [driver] = await twoDrivers(tx);
      try {
        await saveAssignments(tx, {
          actorUserId: null,
          changes: [
            { truckId: ts[0]!.id, driverId: driver!.id },
            { truckId: ts[1]!.id, driverId: driver!.id },
            { truckId: '00000000-0000-4000-8000-000000000000', driverId: null },
          ],
        });
        return [];
      } catch (error) {
        if (!(error instanceof AssignmentConflictError)) throw error;
        return error.conflicts;
      }
    });
    expect(conflicts.map((c) => c.reason).sort()).toEqual([
      'DRIVER_ON_TWO_TRUCKS',
      'UNKNOWN_TRUCK',
    ]);
  });

  it('clearing a truck ends the open row rather than deleting history', async () => {
    const result = await rolledBack(async (tx) => {
      const [truck] = await twoTrucks(tx);
      const [driver] = await twoDrivers(tx);
      await saveAssignments(tx, {
        actorUserId: null,
        changes: [{ truckId: truck!.id, driverId: driver!.id }],
      });
      const cleared = await saveAssignments(tx, {
        actorUserId: null,
        changes: [{ truckId: truck!.id, driverId: null }],
      });
      const rows = await tx
        .select({ id: assignments.id, endedAt: assignments.endedAt })
        .from(assignments)
        .where(eq(assignments.truckId, truck!.id));
      return { cleared, rows };
    });
    expect(result.cleared.cleared).toBe(1);
    // The row is still there, closed. History, never a column on trucks.
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.every((r) => r.endedAt !== null)).toBe(true);
  });

  it('counts an unchanged row as unchanged and writes no audit for it', async () => {
    const result = await rolledBack(async (tx) => {
      const [truck] = await twoTrucks(tx);
      const [driver] = await twoDrivers(tx);
      await saveAssignments(tx, {
        actorUserId: null,
        changes: [{ truckId: truck!.id, driverId: driver!.id }],
      });
      return saveAssignments(tx, {
        actorUserId: null,
        changes: [{ truckId: truck!.id, driverId: driver!.id }],
      });
    });
    expect(result).toMatchObject({ assigned: 0, cleared: 0, unchanged: 1 });
  });
});
