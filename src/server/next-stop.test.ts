import { expect, it } from 'vitest';
import { loads, stops } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import { makeTruck } from '@/test/fleet';
import { LATEST_POSITION_SQL, parseFleetRows, type FleetRow } from './fleet-query';
import type { Tx } from './audit';

/**
 * §12.13, against the real database, inside transactions that always roll
 * back. The rule reads simply and has three edges that a query gets wrong
 * quietly: a departed stop, a delivered load, and a truck holding two loads.
 */

const withDb = describeDb;

/** A truck with no loads on it. Built here, so nothing else can have touched it. */
async function emptyTruck(tx: Tx) {
  const truck = await makeTruck(tx);
  return truck.id;
}

async function rowFor(tx: Tx, truckId: string): Promise<FleetRow | undefined> {
  const rows = parseFleetRows(await tx.execute(LATEST_POSITION_SQL));
  return rows.find((r) => r.id === truckId);
}

const at = (hours: number) => new Date(Date.now() + hours * 3_600_000);

async function addLoad(
  tx: Tx,
  truckId: string,
  loadNumber: string,
  status: 'DISPATCHED' | 'DELIVERED',
  legs: { seq: number; appt: Date; departed?: boolean }[],
) {
  const [load] = await tx
    .insert(loads)
    .values({ truckId, loadNumber, status })
    .returning({ id: loads.id });
  for (const leg of legs) {
    await tx.insert(stops).values({
      loadId: load!.id,
      type: leg.seq === 1 ? 'PU' : 'DEL',
      sequence: leg.seq,
      city: `City ${leg.seq}`,
      state: 'IL',
      appointmentStartUtc: leg.appt,
      appointmentTz: 'America/Chicago',
      appointmentType: 'APPT',
      arrivedAt: leg.departed ? at(-3) : null,
      // §12.57. A departed leg was arrived at first, and the pair is enforced.
      arrivedSource: leg.departed ? ('detected' as const) : null,
      departedAt: leg.departed ? at(-2) : null,
    });
  }
  return load!.id;
}

withDb('the next stop (§12.13)', () => {
  it('is null for a truck holding no load', async () => {
    const row = await rolledBack(async (tx) => {
      const truckId = await emptyTruck(tx);
      return rowFor(tx, truckId);
    });
    expect(row?.nextStop).toBeNull();
    expect(row?.apptAt).toBeNull();
    expect(row?.openLoadCount).toBe(0);
  });

  it('skips a stop that has already departed', async () => {
    const row = await rolledBack(async (tx) => {
      const truckId = await emptyTruck(tx);
      await addLoad(tx, truckId, 'TEST-DEPARTED', 'DISPATCHED', [
        { seq: 1, appt: at(-6), departed: true },
        { seq: 2, appt: at(6) },
      ]);
      return rowFor(tx, truckId);
    });
    // The pickup is done; the delivery is the work.
    expect(row?.nextStop?.type).toBe('DEL');
  });

  it('ignores a delivered load entirely', async () => {
    const row = await rolledBack(async (tx) => {
      const truckId = await emptyTruck(tx);
      await addLoad(tx, truckId, 'TEST-DONE', 'DELIVERED', [{ seq: 1, appt: at(1) }]);
      await addLoad(tx, truckId, 'TEST-LIVE', 'DISPATCHED', [{ seq: 1, appt: at(9) }]);
      return rowFor(tx, truckId);
    });
    // The delivered load's stop is earlier, and must still lose.
    expect(row?.nextStop?.loadNumber).toBe('TEST-LIVE');
    expect(row?.openLoadCount).toBe(1);
  });

  it('takes the earliest deadline across two open loads', async () => {
    const row = await rolledBack(async (tx) => {
      const truckId = await emptyTruck(tx);
      await addLoad(tx, truckId, 'TEST-LATER', 'DISPATCHED', [{ seq: 1, appt: at(20) }]);
      await addLoad(tx, truckId, 'TEST-SOONER', 'DISPATCHED', [{ seq: 1, appt: at(4) }]);
      return rowFor(tx, truckId);
    });
    expect(row?.nextStop?.loadNumber).toBe('TEST-SOONER');
    // Above one, the row names the load so it is clear which drives the status.
    expect(row?.openLoadCount).toBe(2);
  });

  it('sorts a stop with no appointment behind one that has a time', async () => {
    const row = await rolledBack(async (tx) => {
      const truckId = await emptyTruck(tx);
      const [load] = await tx
        .insert(loads)
        .values({ truckId, loadNumber: 'TEST-NOAPPT', status: 'DISPATCHED' })
        .returning({ id: loads.id });
      await tx.insert(stops).values({
        loadId: load!.id, type: 'PU', sequence: 1, city: 'Nowhere', state: 'IL',
      });
      await addLoad(tx, truckId, 'TEST-TIMED', 'DISPATCHED', [{ seq: 1, appt: at(8) }]);
      return rowFor(tx, truckId);
    });
    expect(row?.nextStop?.loadNumber).toBe('TEST-TIMED');
  });

  it('returns the appointment as an ISO string, never a Date', async () => {
    const value = await rolledBack(async (tx) => {
      const truckId = await emptyTruck(tx);
      await addLoad(tx, truckId, 'TEST-ISO', 'DISPATCHED', [{ seq: 1, appt: at(5) }]);
      const row = await rowFor(tx, truckId);
      return row?.nextStop?.apptStartUtc;
    });
    // The same rule as recorded_at: db.execute hands back driver values, so
    // the cast is in the query and the type says string.
    expect(typeof value).toBe('string');
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
