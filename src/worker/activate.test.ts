import { describe, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { auditLog, trucks } from '@/db/schema';
import { commitDb, describeDb, rolledBack } from '@/test/db';
import { makeTruck } from '@/test/fleet';
import type { Tx } from '@/server/audit';
import { activateMovingTrucks, movingFixes, runActivation } from './activate';
import type { PendingPosition } from './ingest';

/**
 * §12.151. An inactive truck nobody switched off comes back when it drives;
 * an admin's switch-off stands; nothing is ever switched off.
 */

const VEHICLE = 'vitest-activate-vehicle';
const FIX_AT = new Date('2026-11-10T18:00:00.000Z');

const fix = (speedMph: number | null, recordedAt = FIX_AT): PendingPosition => ({
  samsaraVehicleId: VEHICLE,
  lat: 41.548277,
  lng: -87.980377,
  heading: null,
  speedMph,
  recordedAt,
  formattedLocation: null,
});

const quiet = () => ({ info: vi.fn(), error: vi.fn() });

const poll = (tx: Tx, truckId: string, pending: PendingPosition[], logger = quiet()) =>
  runActivation(tx, logger, pending, new Map([[VEHICLE, truckId]]));

async function flag(tx: Tx, truckId: string): Promise<boolean | undefined> {
  const [row] = await tx.select({ active: trucks.active }).from(trucks).where(eq(trucks.id, truckId));
  return row?.active;
}

async function truckAudit(tx: Tx, truckId: string) {
  return tx
    .select({ actor: auditLog.actorUserId, before: auditLog.before, after: auditLog.after })
    .from(auditLog)
    .where(and(eq(auditLog.entity, 'truck'), eq(auditLog.entityId, truckId)))
    .orderBy(auditLog.createdAt);
}

/** An audit row as each writer writes it, at a stated time, so "newest" is literal. */
async function auditRow(tx: Tx, truckId: string, after: Record<string, unknown>, at: string) {
  await tx.insert(auditLog).values({
    actorUserId: null,
    entity: 'truck',
    entityId: truckId,
    before: null,
    after,
    createdAt: new Date(at),
  });
}

const ADMIN_OFF = { active: false, source: 'edit-modal' };
const ADVISOR_ON = { active: true, source: 'advisor', reason: 'seed flag, moving' };

describeDb('an inactive truck that drives is switched on (§12.151)', () => {
  it('switches on a seed-inactive truck with a 40 mph fix, with exactly one worker audit row', async () => {
    const seen = await rolledBack(async (tx) => {
      const truck = await makeTruck(tx, { active: false });
      const switched = await poll(tx, truck.id, [fix(40)]);
      return { switched, active: await flag(tx, truck.id), audit: await truckAudit(tx, truck.id) };
    });
    expect(seen.switched).toBe(1);
    expect(seen.active).toBe(true);
    expect(seen.audit).toEqual([
      {
        actor: null,
        before: { active: false },
        after: {
          active: true,
          source: 'worker',
          reason: 'moving',
          speedMph: 40,
          fixAt: '2026-11-10T18:00:00.000Z',
        },
      },
    ]);
  });

  it('writes no second audit row on the next poll', async () => {
    const seen = await rolledBack(async (tx) => {
      const truck = await makeTruck(tx, { active: false });
      const first = await poll(tx, truck.id, [fix(40)]);
      const second = await poll(tx, truck.id, [fix(41, new Date('2026-11-10T18:00:30.000Z'))]);
      return { first, second, audit: await truckAudit(tx, truck.id) };
    });
    expect(seen.first).toBe(1);
    expect(seen.second).toBe(0);
    expect(seen.audit).toHaveLength(1);
  });

  it('leaves a truck an admin switched off inactive at 40 mph, with no audit row', async () => {
    const seen = await rolledBack(async (tx) => {
      const truck = await makeTruck(tx, { active: false });
      await auditRow(tx, truck.id, ADMIN_OFF, '2026-11-01T10:00:00.000Z');
      const switched = await poll(tx, truck.id, [fix(40)]);
      return { switched, active: await flag(tx, truck.id), audit: await truckAudit(tx, truck.id) };
    });
    expect(seen.switched).toBe(0);
    expect(seen.active).toBe(false);
    expect(seen.audit).toHaveLength(1);
  });

  it('keeps it off when an admin switched it off again after an advisor switched it on (newest row wins)', async () => {
    const seen = await rolledBack(async (tx) => {
      const truck = await makeTruck(tx, { active: false });
      await auditRow(tx, truck.id, ADMIN_OFF, '2026-11-01T10:00:00.000Z');
      await auditRow(tx, truck.id, ADVISOR_ON, '2026-11-02T10:00:00.000Z');
      await auditRow(tx, truck.id, ADMIN_OFF, '2026-11-03T10:00:00.000Z');
      const switched = await poll(tx, truck.id, [fix(40)]);
      return { switched, active: await flag(tx, truck.id), audit: await truckAudit(tx, truck.id) };
    });
    expect(seen.switched).toBe(0);
    expect(seen.active).toBe(false);
    expect(seen.audit).toHaveLength(3);
  });

  it('switches it on when the newest row about the flag is an advisor’s, after an admin’s switch-off', async () => {
    const seen = await rolledBack(async (tx) => {
      // Inactive again without an admin: the seed's guess, not anyone's choice.
      const truck = await makeTruck(tx, { active: false });
      await auditRow(tx, truck.id, ADMIN_OFF, '2026-11-01T10:00:00.000Z');
      await auditRow(tx, truck.id, ADVISOR_ON, '2026-11-02T10:00:00.000Z');
      return { switched: await poll(tx, truck.id, [fix(40)]), active: await flag(tx, truck.id) };
    });
    expect(seen.switched).toBe(1);
    expect(seen.active).toBe(true);
  });

  it('keeps an admin’s switch-off when a later bulk assignment wrote a truck row without the flag', async () => {
    const seen = await rolledBack(async (tx) => {
      const truck = await makeTruck(tx, { active: false });
      await auditRow(tx, truck.id, ADMIN_OFF, '2026-11-01T10:00:00.000Z');
      await auditRow(
        tx,
        truck.id,
        {
          driverId: null,
          driverName: null,
          batch: '00000000-0000-4000-8000-000000000001',
          source: 'bulk-assignment',
        },
        '2026-11-05T10:00:00.000Z',
      );
      const switched = await poll(tx, truck.id, [fix(40)]);
      return { switched, active: await flag(tx, truck.id) };
    });
    expect(seen.switched).toBe(0);
    expect(seen.active).toBe(false);
  });

  it('lets the admin’s switch-off win a tie on created_at', async () => {
    const seen = await rolledBack(async (tx) => {
      const truck = await makeTruck(tx, { active: false });
      await auditRow(tx, truck.id, ADVISOR_ON, '2026-11-03T10:00:00.000Z');
      await auditRow(tx, truck.id, ADMIN_OFF, '2026-11-03T10:00:00.000Z');
      return { switched: await poll(tx, truck.id, [fix(40)]), active: await flag(tx, truck.id) };
    });
    expect(seen.switched).toBe(0);
    expect(seen.active).toBe(false);
  });

  it('leaves a parked truck inactive: fixes at 0 and at exactly 3 mph', async () => {
    const seen = await rolledBack(async (tx) => {
      const truck = await makeTruck(tx, { active: false });
      const switched = await poll(tx, truck.id, [
        fix(0, new Date('2026-11-10T18:00:00.000Z')),
        fix(3, new Date('2026-11-10T18:00:30.000Z')),
        fix(null, new Date('2026-11-10T18:01:00.000Z')),
      ]);
      return { switched, active: await flag(tx, truck.id), audit: await truckAudit(tx, truck.id) };
    });
    expect(seen.switched).toBe(0);
    expect(seen.active).toBe(false);
    expect(seen.audit).toEqual([]);
  });

  it('leaves an active truck untouched, with no audit row', async () => {
    const seen = await rolledBack(async (tx) => {
      const truck = await makeTruck(tx, { active: true });
      const switched = await poll(tx, truck.id, [fix(40)]);
      return { switched, active: await flag(tx, truck.id), audit: await truckAudit(tx, truck.id) };
    });
    expect(seen.switched).toBe(0);
    expect(seen.active).toBe(true);
    expect(seen.audit).toEqual([]);
  });

  it('switches on two trucks in one poll, one audit row each', async () => {
    const seen = await rolledBack(async (tx) => {
      const a = await makeTruck(tx, { active: false });
      const b = await makeTruck(tx, { active: false });
      const ids = new Map([
        ['vitest-activate-a', a.id],
        ['vitest-activate-b', b.id],
      ]);
      const switched = await runActivation(
        tx,
        quiet(),
        [
          { ...fix(40), samsaraVehicleId: 'vitest-activate-a' },
          { ...fix(55), samsaraVehicleId: 'vitest-activate-b' },
        ],
        ids,
      );
      return {
        switched,
        a: (await truckAudit(tx, a.id)).length,
        b: (await truckAudit(tx, b.id)).length,
      };
    });
    expect(seen).toEqual({ switched: 2, a: 1, b: 1 });
  });
});

describe('movingFixes', () => {
  const ids = new Map([[VEHICLE, 'truck-1']]);

  it('keeps the newest fix above 3 mph per truck, and nothing at or below it', () => {
    expect(
      movingFixes(
        [
          fix(40, new Date('2026-11-10T18:00:00.000Z')),
          fix(52, new Date('2026-11-10T18:00:30.000Z')),
          fix(3, new Date('2026-11-10T18:01:00.000Z')),
        ],
        ids,
      ),
    ).toEqual([
      { truckId: 'truck-1', speedMph: 52, recordedAt: new Date('2026-11-10T18:00:30.000Z') },
    ]);
  });

  it('counts 3.1 mph as moving and exactly 3 as stopped', () => {
    expect(movingFixes([fix(3.1)], ids)).toHaveLength(1);
    expect(movingFixes([fix(3)], ids)).toEqual([]);
  });

  it('drops a vehicle the roster does not know', () => {
    expect(movingFixes([{ ...fix(40), samsaraVehicleId: 'unknown' }], ids)).toEqual([]);
  });
});

/**
 * The failure, for real: COMMITTED, in `fleet_commit` (src/test/db.ts), so a
 * flag written without its row would survive to be seen — inside a test
 * transaction any error aborts everything and would hide it. A trigger makes
 * the worker's audit insert fail; it is dropped again at the end, and acts
 * only on rows whose source is 'worker', which no other suite writes.
 */
describeDb('a switch-on whose audit row fails (§12.151)', () => {
  it('leaves no flag without its row, logs the error by name, and resolves', async () => {
    const db = commitDb();
    const truck = await makeTruck(db as never, { active: false });
    await db.execute(sql`
      create or replace function vitest_refuse_worker_audit() returns trigger
      language plpgsql as $$
      begin
        if new.after ->> 'source' = 'worker' then
          raise exception 'vitest: worker audit refused';
        end if;
        return new;
      end $$
    `);
    await db.execute(sql`
      create trigger vitest_refuse_worker_audit before insert on audit_log
      for each row execute function vitest_refuse_worker_audit()
    `);
    try {
      await expect(
        activateMovingTrucks(db as never, [{ truckId: truck.id, speedMph: 40, recordedAt: FIX_AT }]),
      ).rejects.toThrow();

      const logger = quiet();
      const switched = await poll(db as never, truck.id, [fix(40)], logger);
      expect(switched).toBe(0);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error.mock.calls[0]?.[0]).toBe('truck activation failed');
      expect(logger.error.mock.calls[0]?.[1]).toMatchObject({
        error: 'vitest: worker audit refused',
      });

      expect(await flag(db as never, truck.id)).toBe(false);
      expect(await truckAudit(db as never, truck.id)).toEqual([]);
    } finally {
      await db.execute(sql`drop trigger if exists vitest_refuse_worker_audit on audit_log`);
      await db.execute(sql`drop function if exists vitest_refuse_worker_audit()`);
      await db.delete(auditLog).where(eq(auditLog.entityId, truck.id));
      await db.delete(trucks).where(eq(trucks.id, truck.id));
    }
  });
});
