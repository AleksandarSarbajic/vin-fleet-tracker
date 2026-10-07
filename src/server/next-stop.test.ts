import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { loads, stops } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import { makeTruck } from '@/test/fleet';
import { LATEST_POSITION_SQL, parseFleetRows, type FleetRow } from './fleet-query';
import { BOARD_NEXT_STOP } from './next-stop';
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
      departedSource: leg.departed ? ('detected' as const) : null,
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

  /**
   * Truck 124, live on 2026-09-22: ONE load, seq 1 Joliet appointment
   * 2026-09-22 05:01, seq 2 Fargo appointment 2026-09-20 23:30 — two days
   * EARLIER. Ordering the whole fleet's stops by appointment made Fargo the
   * next stop while Joliet was undelivered, so the board, the ETA and the
   * arrival sweep's one candidate all pointed at the second stop of a load
   * whose first stop had not happened.
   */
  it('keeps a load in sequence even when a later leg has an earlier time', async () => {
    const row = await rolledBack(async (tx) => {
      const truckId = await emptyTruck(tx);
      await addLoad(tx, truckId, 'TEST-BACKWARDS', 'DISPATCHED', [
        { seq: 1, appt: at(30) },
        { seq: 2, appt: at(-18) },
      ]);
      return rowFor(tx, truckId);
    });
    // Sequence 1 is the PU, sequence 2 the DEL: you cannot deliver before
    // you load, whatever the two appointment times say.
    expect(row?.nextStop?.type).toBe('PU');
  });

  /**
   * The across-loads half of §12.13 is ranked on the earliest deadline a load
   * still HAS, not the one it started with — otherwise a load whose first leg
   * is done keeps winning on a deadline nobody is driving to any more.
   */
  it('ranks a part-finished load by the leg it has left', async () => {
    const row = await rolledBack(async (tx) => {
      const truckId = await emptyTruck(tx);
      await addLoad(tx, truckId, 'TEST-STARTED', 'DISPATCHED', [
        { seq: 1, appt: at(-6), departed: true },
        { seq: 2, appt: at(20) },
      ]);
      await addLoad(tx, truckId, 'TEST-URGENT', 'DISPATCHED', [{ seq: 1, appt: at(8) }]);
      return rowFor(tx, truckId);
    });
    expect(row?.nextStop?.loadNumber).toBe('TEST-URGENT');
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

/**
 * §12.116. The worker reaches the next stop through BOARD_NEXT_STOP; the board
 * keeps its own lateral. Two copies of a selection are only safe while they
 * give the same answer, so every shape above is asked of both at once.
 */
withDb('BOARD_NEXT_STOP picks the stop the board shows', () => {
  it('agrees with the fleet query on every case above, truck by truck', async () => {
    const seen = await rolledBack(async (tx) => {
      const trucks: string[] = [];
      const truck = async () => {
        const id = await emptyTruck(tx);
        trucks.push(id);
        return id;
      };

      await truck(); // no load at all
      await addLoad(tx, await truck(), 'AGREE-DEPARTED', 'DISPATCHED', [
        { seq: 1, appt: at(-6), departed: true },
        { seq: 2, appt: at(6) },
      ]);
      const delivered = await truck();
      await addLoad(tx, delivered, 'AGREE-DONE', 'DELIVERED', [{ seq: 1, appt: at(1) }]);
      await addLoad(tx, delivered, 'AGREE-LIVE', 'DISPATCHED', [{ seq: 1, appt: at(9) }]);
      const two = await truck();
      await addLoad(tx, two, 'AGREE-LATER', 'DISPATCHED', [{ seq: 1, appt: at(20) }]);
      await addLoad(tx, two, 'AGREE-SOONER', 'DISPATCHED', [{ seq: 1, appt: at(4) }]);
      await addLoad(tx, await truck(), 'AGREE-BACKWARDS', 'DISPATCHED', [
        { seq: 1, appt: at(30) },
        { seq: 2, appt: at(-18) },
      ]);
      const part = await truck();
      await addLoad(tx, part, 'AGREE-STARTED', 'DISPATCHED', [
        { seq: 1, appt: at(-6), departed: true },
        { seq: 2, appt: at(20) },
      ]);
      await addLoad(tx, part, 'AGREE-URGENT', 'DISPATCHED', [{ seq: 1, appt: at(8) }]);
      // At the pickup: arrived, not left. The board stays on it (§12.13).
      const atPickup = await addLoad(tx, await truck(), 'AGREE-AT-PICKUP', 'DISPATCHED', [
        { seq: 1, appt: at(-1) },
        { seq: 2, appt: at(7) },
      ]);
      await tx
        .update(stops)
        .set({ arrivedAt: at(-1), arrivedSource: 'detected' })
        .where(sql`${stops.loadId} = ${atPickup} and ${stops.sequence} = 1`);
      const allDone = await truck();
      await addLoad(tx, allDone, 'AGREE-ALL-LEFT', 'DISPATCHED', [
        { seq: 1, appt: at(-9), departed: true },
        { seq: 2, appt: at(-4), departed: true },
      ]);

      const board = parseFleetRows(await tx.execute(LATEST_POSITION_SQL));
      const shared = (await tx.execute(sql`
        select t.id::text as truck_id, s.id::text as stop_id
        from trucks t
        ${BOARD_NEXT_STOP}
      `)) as unknown as { truck_id: string; stop_id: string }[];

      return trucks.map((id) => ({
        truck: id,
        board: board.find((r) => r.id === id)?.nextStop?.stopId ?? null,
        shared: shared.find((r) => r.truck_id === id)?.stop_id ?? null,
      }));
    });

    // Some have a next stop and some do not, or the comparison proves little.
    expect(seen.filter((t) => t.board !== null)).toHaveLength(6);
    for (const truck of seen) expect(truck.shared).toBe(truck.board);
  });
});

/**
 * §12.116. The defect was a condition added INSIDE an ordered next-stop
 * lookup, which skips to the next stop instead of yielding none. The order is
 * therefore used in exactly three places: its own module, and the two queries
 * that select with the board's conditions and nothing else. Anything new goes
 * through BOARD_NEXT_STOP and filters outside it.
 */
describe('nothing else orders its own next stop', () => {
  const ROOT = process.cwd();
  const ALLOWED = new Set([
    join(ROOT, 'src', 'server', 'next-stop.ts'),
    join(ROOT, 'src', 'server', 'fleet-query.ts'),
    join(ROOT, 'src', 'server', 'reassign.ts'),
  ]);

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return sources(path);
      if (!/\.m?tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) return [];
      return [path];
    });
  }

  it('uses NEXT_STOP_ORDER only in next-stop, the fleet query and the reassign preview', () => {
    const users = [...sources(join(ROOT, 'src')), ...sources(join(ROOT, 'scripts'))].filter(
      (file) => /\$\{NEXT_STOP_ORDER\}/.test(readFileSync(file, 'utf8')),
    );
    expect(users.filter((file) => !ALLOWED.has(file))).toEqual([]);
  });

  it('adds no condition of its own in the two queries allowed to use it', () => {
    for (const file of [...ALLOWED].filter((f) => !f.endsWith('next-stop.ts'))) {
      const text = readFileSync(file, 'utf8');
      const lookup = text.slice(
        text.lastIndexOf('where l.truck_id = t.id', text.indexOf('${NEXT_STOP_ORDER}')),
        text.indexOf('${NEXT_STOP_ORDER}'),
      );
      const conditions = lookup
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^(where|and)\b/.test(line));
      expect(conditions, file).toEqual([
        'where l.truck_id = t.id',
        "and l.status not in ('DELIVERED', 'TONU', 'CANCELLED')",
        'and s.departed_at is null',
      ]);
    }
  });
});
