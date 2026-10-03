import { expect, it } from 'vitest';
import { assignments, loads, stops } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import { makeDriver, makeTruck } from '@/test/fleet';
import { addDays, mondayOf, zonedWallToUtc } from '@/lib/history-week';
import type { Tx } from './audit';
import { loadHistoryWeek } from './history';

/**
 * §12.101 — the week page's loader against the real database: the records it
 * picks up for a week, through `timestamptz`, and what the page then says.
 */

const TZ = 'America/Chicago';
const WEEK = { year: 2026, week: 40 };
const at = (day: number, hh: number, mm = 0) => zonedWallToUtc(addDays(mondayOf(WEEK), day), hh, mm, TZ);

async function addLoad(
  tx: Tx,
  truckId: string,
  over: { number?: string | null; status?: 'DELIVERED' | 'DISPATCHED'; createdAt?: Date },
  stopRows: { type: 'PU' | 'DEL'; city: string; state: string; arrivedAt?: Date; departedAt?: Date }[],
) {
  const [load] = await tx
    .insert(loads)
    .values({
      truckId,
      loadNumber: over.number ?? null,
      status: over.status ?? 'DELIVERED',
      createdAt: over.createdAt ?? at(0, 6),
    })
    .returning({ id: loads.id });
  for (const [i, s] of stopRows.entries()) {
    await tx.insert(stops).values({
      loadId: load!.id,
      type: s.type,
      sequence: i + 1,
      city: s.city,
      state: s.state,
      arrivedAt: s.arrivedAt ?? null,
      arrivedSource: s.arrivedAt ? 'detected' : null,
      departedAt: s.departedAt ?? null,
    });
  }
  return load!.id;
}

const assignFor = (tx: Tx, truckId: string, driverId: string, startedAt: Date, endedAt: Date | null = null) =>
  tx.insert(assignments).values({ truckId, driverId, startedAt, endedAt });

describeDb('the driver history week (§12.101)', () => {
  it('an empty week: no rows, empty lists, zero counts', async () => {
    const view = await rolledBack((tx) => loadHistoryWeek(tx as never, WEEK, TZ));
    expect(view.rows).toEqual([]);
    expect(view.notReached).toEqual([]);
    expect(view.noNumber).toEqual([]);
    expect(view.counts).toEqual({ drivers: 0, loads: 0, notReached: 0 });
    expect(view.range).toBe('Sep 28 – Oct 4, 2026');
  });

  it('a driver who changed trucks mid-week keeps one row, each load on its truck', async () => {
    const view = await rolledBack(async (tx) => {
      const t1 = await makeTruck(tx, { truckNumber: 1162 });
      const t2 = await makeTruck(tx, { truckNumber: 1188 });
      const dana = await makeDriver(tx, { name: 'Dana Kowalski' });
      await assignFor(tx, t1.id, dana.id, at(-10, 8), at(2, 6));
      await assignFor(tx, t2.id, dana.id, at(2, 6));
      await addLoad(tx, t1.id, { number: '48215' }, [{ type: 'DEL', city: 'Milwaukee', state: 'WI', arrivedAt: at(0, 10) }]);
      await addLoad(tx, t2.id, { number: '48262' }, [{ type: 'DEL', city: 'Rockford', state: 'IL', arrivedAt: at(2, 11) }]);
      return loadHistoryWeek(tx as never, WEEK, TZ);
    });
    const dana = view.rows.find((r) => r.name === 'Dana Kowalski')!;
    expect(view.rows.filter((r) => r.name === 'Dana Kowalski')).toHaveLength(1);
    expect(dana.trucks).toEqual([
      { label: '1162', days: 'Mon–Wed', partial: true },
      { label: '1188', days: 'Wed–Sun', partial: true },
    ]);
    expect(dana.cells[0]!.entries.map((e) => [e.number, e.truck, e.route.full])).toEqual([
      ['48215', '1162', 'DEL Milwaukee, WI'],
    ]);
    expect(dana.cells[2]!.entries.map((e) => [e.number, e.truck, e.route.full])).toEqual([
      ['48262', '1188', 'DEL Rockford, IL'],
    ]);
  });

  it('a load never reached is in "Not reached this week", not in the table', async () => {
    const view = await rolledBack(async (tx) => {
      const truck = await makeTruck(tx, { truckNumber: 1147 });
      const marcus = await makeDriver(tx, { name: 'Marcus Reyes' });
      await assignFor(tx, truck.id, marcus.id, at(-30, 8));
      await addLoad(tx, truck.id, { number: '48231', status: 'DISPATCHED', createdAt: at(0, 6) }, [
        { type: 'PU', city: 'Melrose Park', state: 'IL' },
      ]);
      return loadHistoryWeek(tx as never, WEEK, TZ);
    });
    expect(view.rows[0]!.cells.every((c) => c.entries.length === 0)).toBe(true);
    expect(view.notReached.map((x) => [x.number, x.route.full, x.driver, x.truck, x.created])).toEqual([
      ['48231', 'PU Melrose Park, IL', 'Marcus Reyes', '1147', 'created Mon Sep 28, no arrival recorded'],
    ]);
    expect(view.counts).toEqual({ drivers: 1, loads: 0, notReached: 1 });
  });

  it('a Sunday 23:30 arrival is on Sunday after the round trip through the database', async () => {
    const view = await rolledBack(async (tx) => {
      const truck = await makeTruck(tx, { truckNumber: 1169 });
      const hannah = await makeDriver(tx, { name: 'Hannah Brooks' });
      await assignFor(tx, truck.id, hannah.id, at(-30, 8));
      await addLoad(tx, truck.id, { number: '48290' }, [{ type: 'DEL', city: 'Lincoln', state: 'NE', arrivedAt: at(6, 23, 30) }]);
      return loadHistoryWeek(tx as never, WEEK, TZ);
    });
    expect(view.rows[0]!.cells.map((c) => c.entries.length)).toEqual([0, 0, 0, 0, 0, 0, 1]);
  });

  it('a pickup this Sunday paired with a delivery next Monday shows once, on the pickup day', async () => {
    const [thisWeek, nextWeek] = await rolledBack(async (tx) => {
      const truck = await makeTruck(tx, { truckNumber: 1158 });
      const samuel = await makeDriver(tx, { name: 'Samuel Okafor' });
      await assignFor(tx, truck.id, samuel.id, at(-30, 8));
      await addLoad(tx, truck.id, { number: '48300' }, [{ type: 'PU', city: 'Naperville', state: 'IL', arrivedAt: at(6, 20) }]);
      await addLoad(tx, truck.id, { number: '48300' }, [{ type: 'DEL', city: 'Louisville', state: 'KY', arrivedAt: at(7, 9) }]);
      return Promise.all([
        loadHistoryWeek(tx as never, WEEK, TZ),
        loadHistoryWeek(tx as never, { year: 2026, week: 41 }, TZ),
      ]);
    });
    expect(thisWeek.rows[0]!.cells[6]!.entries.map((e) => e.route.full)).toEqual([
      'Naperville, IL → Louisville, KY',
    ]);
    expect(nextWeek.rows[0]!.cells.flatMap((c) => c.entries)).toEqual([]);
  });
});
