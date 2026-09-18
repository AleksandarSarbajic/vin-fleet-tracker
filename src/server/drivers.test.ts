import { expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { assignments, driverMergeCandidates, drivers } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import { assign, makeDriver, makeFullFleetRow, makeTruck } from '@/test/fleet';
import { LATEST_POSITION_SQL, parseFleetRows } from './fleet-query';
import { upsertDrivers } from '@/worker/ingest';
import {
  DriverError,
  createDriver,
  detectMergeCandidates,
  dismissMergeCandidate,
  linkDriver,
  openMergeCandidates,
  retireDriver,
} from './drivers';
import type { Db, Tx } from './audit';

/**
 * Drivers a dispatcher creates, and the merge (§12.35).
 */

const as = (tx: Tx) => tx as unknown as Db;

const samsaraRow = (id: string, name: string, status = 'active') =>
  ({ id, name, driverActivationStatus: status }) as never;

describeDb('the roster sync never touches a driver it did not create', () => {
  /**
   * THE hazard. The sync rewrites `drivers` from Samsara every poll, and a
   * hand-entered driver being wiped on the next one would make the whole
   * feature worthless. It survives today because the sync has no DELETE —
   * which was an accident of its shape, not a stated rule. These state it.
   */
  it('leaves an app-created driver alone when Samsara does not return them', async () => {
    const seen = await rolledBack(async (tx) => {
      const { driverId } = await createDriver(as(tx), {
        actorUserId: null,
        driver: { name: 'Hand Entered', phone: '555-0100' },
      });
      await upsertDrivers(as(tx), [samsaraRow('sam-1', 'Somebody Else')]);
      const [row] = await tx.select().from(drivers).where(eq(drivers.id, driverId));
      return row;
    });

    expect(seen).toBeDefined();
    expect(seen?.name).toBe('Hand Entered');
    expect(seen?.phone).toBe('555-0100');
    expect(seen?.source).toBe('app');
    expect(seen?.samsaraDriverId).toBeNull();
  });

  it('does not delete drivers at all — absence from the response means nothing', async () => {
    const count = await rolledBack(async (tx) => {
      await upsertDrivers(as(tx), [samsaraRow('sam-1', 'A'), samsaraRow('sam-2', 'B')]);
      // The next poll returns only one of them.
      await upsertDrivers(as(tx), [samsaraRow('sam-1', 'A')]);
      return (await tx.select().from(drivers)).length;
    });
    expect(count).toBe(2);
  });

  /**
   * The partial unique index is the trap. `ON CONFLICT (samsara_driver_id)`
   * does not match a partial index without the same predicate, and the error
   * lands on the worker on every poll.
   */
  it('still upserts by samsara id with app-created rows present', async () => {
    const seen = await rolledBack(async (tx) => {
      await createDriver(as(tx), { actorUserId: null, driver: { name: 'App One' } });
      await createDriver(as(tx), { actorUserId: null, driver: { name: 'App Two' } });
      await upsertDrivers(as(tx), [samsaraRow('sam-1', 'Original')]);
      await upsertDrivers(as(tx), [samsaraRow('sam-1', 'Renamed')]);
      const rows = await tx.select({ name: drivers.name }).from(drivers).orderBy(drivers.name);
      return rows.map((r) => r.name);
    });
    // Two app rows with NULL ids coexist, and the samsara row updated in place.
    expect(seen).toEqual(['App One', 'App Two', 'Renamed']);
  });

  it('refuses to overwrite an app row even once it has a samsara id', async () => {
    const seen = await rolledBack(async (tx) => {
      const { driverId } = await createDriver(as(tx), {
        actorUserId: null,
        driver: { name: 'Merged Person', phone: '555-0199' },
      });
      // Simulate the post-merge state: our row, carrying Samsara's id.
      await tx
        .update(drivers)
        .set({ samsaraDriverId: 'sam-9' })
        .where(eq(drivers.id, driverId));
      await upsertDrivers(as(tx), [samsaraRow('sam-9', 'Samsara Overwrote Me', 'inactive')]);
      const [row] = await tx.select().from(drivers).where(eq(drivers.id, driverId));
      return row;
    });
    // setWhere source = 'samsara' is what protects it. Without that line the
    // name and the active flag would both have been rewritten.
    expect(seen?.name).toBe('Merged Person');
    expect(seen?.active).toBe(true);
  });
});

describeDb('creating a driver', () => {
  it('needs only a name', async () => {
    const row = await rolledBack(async (tx) => {
      const { driverId } = await createDriver(as(tx), {
        actorUserId: null,
        driver: { name: '  Ada Lovelace  ' },
      });
      const [found] = await tx.select().from(drivers).where(eq(drivers.id, driverId));
      return found;
    });
    expect(row?.name).toBe('Ada Lovelace');
    expect(row?.phone).toBeNull();
    expect(row?.source).toBe('app');
    expect(row?.retiredAt).toBeNull();
  });

  it('refuses a duplicate name, because that is a human adding someone twice', async () => {
    await expect(
      rolledBack(async (tx) => {
        await createDriver(as(tx), { actorUserId: null, driver: { name: 'Jo Martinez' } });
        await createDriver(as(tx), { actorUserId: null, driver: { name: 'jo  martinez' } });
      }),
    ).rejects.toBeInstanceOf(DriverError);
  });

  it('points at Samsara when the clash is with a synced driver', async () => {
    const message = await rolledBack(async (tx) => {
      await upsertDrivers(as(tx), [samsaraRow('sam-1', 'Real Driver')]);
      try {
        await createDriver(as(tx), { actorUserId: null, driver: { name: 'Real Driver' } });
        return null;
      } catch (error) {
        return error instanceof DriverError ? error.message : null;
      }
    });
    expect(message).toMatch(/Samsara already has/);
  });
});

describeDb('merge candidates are detected, never acted on', () => {
  it('records a name match and leaves both rows untouched', async () => {
    const seen = await rolledBack(async (tx) => {
      const { driverId } = await createDriver(as(tx), {
        actorUserId: null,
        driver: { name: 'J Martinez' },
      });
      await upsertDrivers(as(tx), [samsaraRow('sam-1', 'J.  Martinez')]);
      const found = await detectMergeCandidates(as(tx));
      const open = await openMergeCandidates(tx);
      const [app] = await tx.select().from(drivers).where(eq(drivers.id, driverId));
      return { found, open, app };
    });

    expect(seen.found).toBe(1);
    expect(seen.open).toHaveLength(1);
    expect(seen.open[0]?.appDriverName).toBe('J Martinez');
    expect(seen.open[0]?.samsaraDriverName).toBe('J.  Martinez');
    // Nothing merged. The rows are exactly as they were.
    expect(seen.app?.samsaraDriverId).toBeNull();
    expect(seen.app?.source).toBe('app');
  });

  it('does not re-offer a dismissed candidate on the next poll', async () => {
    const open = await rolledBack(async (tx) => {
      await createDriver(as(tx), { actorUserId: null, driver: { name: 'Twice Named' } });
      await upsertDrivers(as(tx), [samsaraRow('sam-1', 'Twice Named')]);
      await detectMergeCandidates(as(tx));
      const [candidate] = await tx.select().from(driverMergeCandidates);
      await dismissMergeCandidate(as(tx), { actorUserId: null, candidateId: candidate!.id });
      // The worker polls again.
      await detectMergeCandidates(as(tx));
      return openMergeCandidates(tx);
    });
    expect(open).toEqual([]);
  });

  it('ignores a retired app driver', async () => {
    const found = await rolledBack(async (tx) => {
      const { driverId } = await createDriver(as(tx), {
        actorUserId: null,
        driver: { name: 'Gone Already' },
      });
      await retireDriver(as(tx), { actorUserId: null, driverId, retired: true });
      await upsertDrivers(as(tx), [samsaraRow('sam-1', 'Gone Already')]);
      return detectMergeCandidates(as(tx));
    });
    expect(found).toBe(0);
  });
});

describeDb('linking', () => {
  it('moves the assignment history and removes the app row', async () => {
    const seen = await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      const { driverId: appId } = await createDriver(as(tx), {
        actorUserId: null,
        driver: { name: 'New Hire', phone: '555-0123' },
      });
      // History accrues against the row we created.
      const a = await assign(tx, truck.id, appId);
      await tx.update(assignments).set({ endedAt: sql`now()` }).where(eq(assignments.id, a.id));

      await upsertDrivers(as(tx), [samsaraRow('sam-77', 'New Hire')]);
      const [sam] = await tx
        .select({ id: drivers.id })
        .from(drivers)
        .where(eq(drivers.samsaraDriverId, 'sam-77'));

      const result = await linkDriver(as(tx), {
        actorUserId: null,
        appDriverId: appId,
        samsaraDriverId: sam!.id,
      });

      const remaining = await tx.select().from(drivers);
      const [moved] = await tx
        .select({ driverId: assignments.driverId })
        .from(assignments)
        .where(eq(assignments.id, a.id));
      const [merged] = await tx.select().from(drivers).where(eq(drivers.id, sam!.id));
      return { result, remaining, moved, merged, appId, samId: sam!.id };
    });

    expect(seen.result.movedAssignments).toBe(1);
    // The history points at the surviving row — not orphaned, not deleted.
    expect(seen.moved?.driverId).toBe(seen.samId);
    expect(seen.remaining).toHaveLength(1);
    expect(seen.remaining[0]?.id).toBe(seen.samId);
    // The phone was ours and Samsara has none for this org, so it carries over.
    expect(seen.merged?.phone).toBe('555-0123');
  });

  it('writes an audit entry naming BOTH ids — the only way back from a wrong link', async () => {
    const entry = await rolledBack(async (tx) => {
      const { driverId: appId } = await createDriver(as(tx), {
        actorUserId: null,
        driver: { name: 'Both Ids' },
      });
      await upsertDrivers(as(tx), [samsaraRow('sam-5', 'Both Ids')]);
      const [sam] = await tx
        .select({ id: drivers.id })
        .from(drivers)
        .where(eq(drivers.samsaraDriverId, 'sam-5'));
      await linkDriver(as(tx), {
        actorUserId: null,
        appDriverId: appId,
        samsaraDriverId: sam!.id,
      });
      const rows = (await tx.execute(sql`
        select before, after from audit_log
        where entity = 'driver' and after ? 'mergedInto'
      `)) as unknown as { before: Record<string, unknown>; after: Record<string, unknown> }[];
      return { row: rows[0], appId, samId: sam!.id };
    });

    // After the merge the rows are indistinguishable by design, so this entry
    // is the only record that two of them were ever one person.
    expect(entry.row?.before?.appDriverId).toBe(entry.appId);
    expect(entry.row?.before?.samsaraDriverId).toBe(entry.samId);
    expect(entry.row?.before?.samsaraDriverExternalId).toBe('sam-5');
    expect(entry.row?.after?.removed).toBe(entry.appId);
    expect(entry.row?.after?.mergedInto).toBe(entry.samId);
  });

  it('refuses when both drivers are on trucks — the merge itself would break the invariant', async () => {
    await expect(
      rolledBack(async (tx) => {
        const truckA = await makeTruck(tx);
        const truckB = await makeTruck(tx);
        const { driverId: appId } = await createDriver(as(tx), {
          actorUserId: null,
          driver: { name: 'Busy Person' },
        });
        await upsertDrivers(as(tx), [samsaraRow('sam-8', 'Busy Person')]);
        const [sam] = await tx
          .select({ id: drivers.id })
          .from(drivers)
          .where(eq(drivers.samsaraDriverId, 'sam-8'));
        await assign(tx, truckA.id, appId);
        await assign(tx, truckB.id, sam!.id);
        await linkDriver(as(tx), {
          actorUserId: null,
          appDriverId: appId,
          samsaraDriverId: sam!.id,
        });
      }),
    ).rejects.toThrow(/Both drivers are currently on trucks/);
  });

  it('refuses to link a Samsara-backed row into another', async () => {
    await expect(
      rolledBack(async (tx) => {
        await upsertDrivers(as(tx), [samsaraRow('sam-1', 'A'), samsaraRow('sam-2', 'B')]);
        const rows = await tx.select({ id: drivers.id }).from(drivers).orderBy(drivers.name);
        await linkDriver(as(tx), {
          actorUserId: null,
          appDriverId: rows[0]!.id,
          samsaraDriverId: rows[1]!.id,
        });
      }),
    ).rejects.toThrow(/Only a driver added here can be linked/);
  });
});

describeDb('retirement', () => {
  it('keeps the row and its history, and takes it off the board', async () => {
    const seen = await rolledBack(async (tx) => {
      const { driverId } = await createDriver(as(tx), {
        actorUserId: null,
        driver: { name: 'Leaving Soon' },
      });
      await retireDriver(as(tx), { actorUserId: null, driverId, retired: true });
      const [row] = await tx.select().from(drivers).where(eq(drivers.id, driverId));
      return row;
    });
    expect(seen?.retiredAt).toBeInstanceOf(Date);
    // Never deleted: assignments.driver_id is ON DELETE RESTRICT and the
    // history is the record of who drove what.
    expect(seen?.name).toBe('Leaving Soon');
  });

  it('refuses while the driver is still on a truck', async () => {
    await expect(
      rolledBack(async (tx) => {
        const truck = await makeTruck(tx);
        const { driverId } = await createDriver(as(tx), {
          actorUserId: null,
          driver: { name: 'Still Driving' },
        });
        await assign(tx, truck.id, driverId);
        await retireDriver(as(tx), { actorUserId: null, driverId, retired: true });
      }),
    ).rejects.toThrow(/still on a truck/);
  });

  it('survives a roster sync, because retired_at is ours', async () => {
    const seen = await rolledBack(async (tx) => {
      const driver = await makeDriver(tx);
      await tx
        .update(drivers)
        .set({ samsaraDriverId: 'sam-live', source: 'samsara' })
        .where(eq(drivers.id, driver.id));
      await retireDriver(as(tx), { actorUserId: null, driverId: driver.id, retired: true });
      // Samsara says this driver is very much active.
      await upsertDrivers(as(tx), [samsaraRow('sam-live', driver.name, 'active')]);
      const [row] = await tx.select().from(drivers).where(eq(drivers.id, driver.id));
      return row;
    });
    // `active` is Samsara's and comes back true; retirement is ours and stays.
    expect(seen?.active).toBe(true);
    expect(seen?.retiredAt).toBeInstanceOf(Date);
  });

  it('can be undone', async () => {
    const seen = await rolledBack(async (tx) => {
      const { driverId } = await createDriver(as(tx), {
        actorUserId: null,
        driver: { name: 'Came Back' },
      });
      await retireDriver(as(tx), { actorUserId: null, driverId, retired: true });
      await retireDriver(as(tx), { actorUserId: null, driverId, retired: false });
      const [row] = await tx.select().from(drivers).where(eq(drivers.id, driverId));
      return row;
    });
    expect(seen?.retiredAt).toBeNull();
  });
});

describeDb('a truck with an app-created driver reports position normally', () => {
  /**
   * Stated, not assumed (§12.35).
   *
   * Position comes from the VEHICLE: the fleet query joins `positions` with a
   * lateral on `truck_id`, and the driver join supplies only `driver_id` and
   * `driver_name`. A driver with no ELD therefore costs nothing — no position,
   * no ETA, no miles, no arrival detection depends on them existing in
   * Samsara. What it does cost is the driver's own HOS, which this product
   * does not use at all (Correction 1).
   */
  it('has position, an ETA and a status, exactly as a Samsara driver would', async () => {
    const seen = await rolledBack(async (tx) => {
      const fixture = await makeFullFleetRow(tx);

      // Swap the Samsara-backed driver for one a dispatcher typed.
      await tx
        .update(assignments)
        .set({ endedAt: sql`now()` })
        .where(eq(assignments.truckId, fixture.truck.id));
      const { driverId } = await createDriver(as(tx), {
        actorUserId: null,
        driver: { name: 'No ELD Driver', phone: '555-0150' },
      });
      await assign(tx, fixture.truck.id, driverId);

      const rows = parseFleetRows(await tx.execute(LATEST_POSITION_SQL));
      return rows.find((r) => r.id === fixture.truck.id);
    });

    expect(seen?.driverName).toBe('No ELD Driver');
    // The three things that would break if position were keyed on the driver.
    expect(seen?.lat).not.toBeNull();
    expect(seen?.recordedAt).not.toBeNull();
    expect(seen?.formattedLocation).not.toBeNull();
    // And the truck is not UNASSIGNED — an app driver is a real assignment.
    expect(seen?.status).not.toBe('UNASSIGNED');
    expect(seen?.etaAbsence).not.toBe('suppressed-unassigned');
  });
});
