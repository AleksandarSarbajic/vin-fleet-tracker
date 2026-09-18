import { expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { assignments } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import { assign, makeDriver, makeTruck } from '@/test/fleet';
import { AssignmentConflictError, loadAssignmentBoard, saveAssignments } from './assignments';
import type { Tx } from './audit';

/**
 * Against the real database, inside a transaction that ALWAYS rolls back.
 * Nothing here survives the test — this is the customer's project, and a
 * test that leaves an assignment behind is a test that puts a driver on a
 * truck nobody assigned.
 */

const withDb = describeDb;

withDb('the assignment board', () => {
  it('lists active trucks and active drivers, both sides whole', async () => {
    const board = await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      const driven = await makeDriver(tx);
      await assign(tx, truck.id, driven.id);
      // The gap is the point of the screen, so the fixture creates one.
      await makeDriver(tx);
      return loadAssignmentBoard(tx);
    });
    expect(board.trucks.length).toBe(1);
    expect(board.drivers.length).toBe(2);
    expect(board.drivers.some((d) => d.truckId === null)).toBe(true);
  });

  it('returns `since` as an ISO string, never a Date', async () => {
    const since = await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      await assign(tx, truck.id, (await makeDriver(tx)).id);
      const board = await loadAssignmentBoard(tx);
      return board.trucks.map((t) => t.since);
    });
    expect(since.length).toBeGreaterThan(0);
    for (const value of since) {
      expect(typeof value).toBe('string');
    }
  });
});

withDb('saving the board', () => {
  /**
   * Two trucks and two drivers, created here.
   *
   * This used to be forty lines: take the two highest-numbered active trucks,
   * end whatever open assignments they had, and take the opposite end of the
   * fleet from stop-edit.test.ts so the two suites did not lock the same rows.
   * All of it was scaffolding for sharing a database with production — the
   * moment a dispatcher actually used /assignments, five of these failed with
   * "truck 136 and truck 147 both take Roman De Los Santos", the conflict rule
   * working exactly as designed on a driver the fixture had no business
   * claiming. An empty database needs none of it (§12.32).
   */
  const twoTrucks = async (tx: Tx) => [await makeTruck(tx), await makeTruck(tx)];
  const twoDrivers = async (tx: Tx) => [await makeDriver(tx), await makeDriver(tx)];

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
    // Both zero, and said so: `now === before` alone would also hold if a
    // future fixture pre-created assignments and the save partially landed.
    expect(after.before).toBe(0);
    expect(after.now).toBe(0);
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
