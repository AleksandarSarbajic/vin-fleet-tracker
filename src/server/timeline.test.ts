import { expect, it } from 'vitest';
import { loads, overrides, stops } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import { makeDispatcher, makeTruck } from '@/test/fleet';
import { loadTruckTimeline } from './timeline';
import type { Tx } from './audit';

/**
 * §14 feature 15, against the real database.
 *
 * The two things only a database test can settle: which loads count as this
 * truck's timeline, and that a stop with several overrides stays ONE stop —
 * a join rather than an aggregate would quietly triple it.
 */

const NOW = new Date('2026-09-23T18:00:00.000Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

async function addLoad(
  tx: Tx,
  truckId: string,
  status: 'DISPATCHED' | 'DELIVERED',
  legs: { seq: number; arrivedAt?: Date; departedAt?: Date }[],
) {
  const [load] = await tx
    .insert(loads)
    .values({
      truckId,
      loadNumber: `T-${Math.random().toString(36).slice(2, 8)}`,
      status,
    })
    .returning({ id: loads.id });
  const ids: string[] = [];
  for (const leg of legs) {
    const [row] = await tx
      .insert(stops)
      .values({
        loadId: load!.id,
        type: leg.seq === 1 ? 'PU' : 'DEL',
        sequence: leg.seq,
        city: 'Joliet',
        state: 'IL',
        appointmentStartUtc: ago(6),
        appointmentTz: 'America/Chicago',
        appointmentType: 'APPT',
        arrivedAt: leg.arrivedAt ?? null,
        arrivedSource: leg.arrivedAt ? ('detected' as const) : null,
        departedAt: leg.departedAt ?? null,
      })
      .returning({ id: stops.id });
    ids.push(row!.id);
  }
  return { loadId: load!.id, stopIds: ids };
}

describeDb('the per-truck timeline (§14 feature 15)', () => {
  it('is empty for a truck with nothing on it', async () => {
    await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      expect(await loadTruckTimeline(tx, truck.id, NOW)).toEqual([]);
    });
  });

  it('carries every stop of an open load, in sequence', async () => {
    await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      await addLoad(tx, truck.id, 'DISPATCHED', [{ seq: 1 }, { seq: 2 }, { seq: 3 }]);
      const timeline = await loadTruckTimeline(tx, truck.id, NOW);
      expect(timeline.map((s) => s.sequence)).toEqual([1, 2, 3]);
    });
  });

  /**
   * "What has 101 done today and what is left" means both halves. A timeline
   * that dropped the morning's delivery the moment it was marked DELIVERED
   * would answer only the second.
   */
  it('keeps a load finished within the last 24 hours', async () => {
    await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      await addLoad(tx, truck.id, 'DELIVERED', [
        { seq: 1, arrivedAt: ago(9), departedAt: ago(8) },
      ]);
      expect(await loadTruckTimeline(tx, truck.id, NOW)).toHaveLength(1);
    });
  });

  it('drops a load finished before that', async () => {
    await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      await addLoad(tx, truck.id, 'DELIVERED', [
        { seq: 1, arrivedAt: ago(40), departedAt: ago(39) },
      ]);
      expect(await loadTruckTimeline(tx, truck.id, NOW)).toEqual([]);
    });
  });

  it('never returns another truck’s load', async () => {
    await rolledBack(async (tx) => {
      const mine = await makeTruck(tx);
      const theirs = await makeTruck(tx);
      await addLoad(tx, theirs.id, 'DISPATCHED', [{ seq: 1 }]);
      const { stopIds } = await addLoad(tx, mine.id, 'DISPATCHED', [{ seq: 1 }]);
      const timeline = await loadTruckTimeline(tx, mine.id, NOW);
      expect(timeline.map((s) => s.stopId)).toEqual(stopIds);
    });
  });

  /**
   * The aggregate, not a join. A stop with three overrides has to stay one
   * stop — a join would return it three times and the timeline would print
   * the same dock three times over.
   */
  it('keeps a stop with several overrides as one stop', async () => {
    await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      const dispatcher = await makeDispatcher(tx);
      const { stopIds } = await addLoad(tx, truck.id, 'DISPATCHED', [{ seq: 1 }]);
      for (const hours of [5, 4, 3]) {
        await tx.insert(overrides).values({
          stopId: stopIds[0]!,
          forcedStatus: 'ARRIVED',
          reason: 'ELD_POSITION_WRONG',
          setBy: dispatcher.id,
          setAt: ago(hours),
          expiresAt: ago(hours - 1),
          // All but the newest are cleared, so the partial unique index that
          // allows one live override per stop is respected.
          clearedAt: hours === 3 ? null : ago(hours - 1),
        });
      }
      const timeline = await loadTruckTimeline(tx, truck.id, NOW);
      expect(timeline).toHaveLength(1);
      expect(timeline[0]?.overrides).toHaveLength(3);
      // Newest first, and carrying the name of whoever set it.
      expect(timeline[0]?.overrides[0]?.clearedAt).toBeNull();
      expect(timeline[0]?.overrides[0]?.setByName).toBeTruthy();
    });
  });

  it('returns no overrides as an empty list, never as null', async () => {
    await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      await addLoad(tx, truck.id, 'DISPATCHED', [{ seq: 1 }]);
      expect((await loadTruckTimeline(tx, truck.id, NOW))[0]?.overrides).toEqual([]);
    });
  });
});
