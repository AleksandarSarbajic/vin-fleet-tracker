import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { loads, stops } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import { makeTruck } from '@/test/fleet';
import type { Tx } from './audit';
import {
  DEMO_NOTE,
  DEMO_PREFIX,
  clearDemoData,
  countDemoRemnants,
  isClean,
} from './demo-data';

/**
 * `npm run seed:demo -- --clear` must actually clear.
 *
 * This is the brief's last instruction before deploying, and it is one command
 * that has been wrong before. §12.21 made an empty load number a real state;
 * the seed writes some to exercise it; and `load_number LIKE 'DEMO-%'` does
 * not match NULL. One demo load in seven survived — the data that must not
 * reach production, surviving the one command whose job is to remove it.
 *
 * It is verified HERE, against the disposable cluster, rather than by running
 * it against the live database and looking at the output. The shape of the
 * seed is reproduced — including the load with no number, which is the case
 * that broke it.
 */

/** The seed's own shape: some loads numbered, every seventh with none. */
async function seedDemoShaped(tx: Tx, count = 7): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    const truck = await makeTruck(tx);
    const [load] = await tx
      .insert(loads)
      .values({
        truckId: truck.id,
        // §12.21: every seventh demo load has NO number at all.
        loadNumber: i % 7 === 5 ? null : `${DEMO_PREFIX}${100 + i}-A`,
        status: 'DISPATCHED',
      })
      .returning({ id: loads.id });

    await tx.insert(stops).values({
      loadId: load!.id,
      type: 'DEL',
      sequence: 1,
      addressLine: '1 Demo Dock',
      city: 'Chicago',
      state: 'IL',
      zip: '60601',
      // Written unconditionally, which is what makes the numberless load findable.
      dispatcherNote: DEMO_NOTE,
    });
  }
}

/** A real load a dispatcher entered. Must survive untouched. */
async function seedRealLoad(tx: Tx): Promise<string> {
  const truck = await makeTruck(tx);
  const [load] = await tx
    .insert(loads)
    .values({ truckId: truck.id, loadNumber: 'REAL-4471', status: 'LOADED' })
    .returning({ id: loads.id });
  await tx.insert(stops).values({
    loadId: load!.id,
    type: 'PU',
    sequence: 1,
    addressLine: '900 Real Street',
    city: 'Dallas',
    state: 'TX',
    zip: '75201',
    dispatcherNote: 'call the dock at 06:00',
  });
  return load!.id;
}

describeDb('clearing the demo data', () => {
  it('reaches zero, counted three independent ways', async () => {
    const result = await rolledBack(async (tx) => {
      await seedDemoShaped(tx);
      const before = await countDemoRemnants(tx);
      const cleared = await clearDemoData(tx);
      return { before, cleared };
    });

    expect(result.before.notedStops).toBe(7);
    expect(result.cleared.loadsDeleted).toBe(7);
    // The assertion that matters. Not "the delete ran" — nothing left.
    expect(result.cleared.remnants).toEqual({
      numberedLoads: 0,
      notedStops: 0,
      loadsWithNotedStops: 0,
    });
    expect(isClean(result.cleared.remnants)).toBe(true);
  });

  /**
   * §12.21's survivor, pinned. A prefix match alone leaves this behind, and
   * the command reports success while demo data sits in production.
   */
  it('removes the demo load that has no load number at all', async () => {
    const left = await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      const [load] = await tx
        .insert(loads)
        .values({ truckId: truck.id, loadNumber: null, status: 'DISPATCHED' })
        .returning({ id: loads.id });
      await tx.insert(stops).values({
        loadId: load!.id,
        type: 'DEL',
        sequence: 1,
        addressLine: '1 Demo Dock',
        city: 'Chicago',
        state: 'IL',
        zip: '60601',
        dispatcherNote: DEMO_NOTE,
      });

      await clearDemoData(tx);
      return tx.select({ id: loads.id }).from(loads).where(eq(loads.id, load!.id));
    });
    expect(left).toEqual([]);
  });

  it('leaves a real dispatcher-entered load completely alone', async () => {
    const survivor = await rolledBack(async (tx) => {
      const realId = await seedRealLoad(tx);
      await seedDemoShaped(tx, 3);
      await clearDemoData(tx);
      return {
        load: await tx.select({ id: loads.id }).from(loads).where(eq(loads.id, realId)),
        stops: await tx.select({ id: stops.id }).from(stops).where(eq(stops.loadId, realId)),
      };
    });
    expect(survivor.load).toHaveLength(1);
    expect(survivor.stops).toHaveLength(1);
  });

  it('cascades the stops rather than orphaning them', async () => {
    const remaining = await rolledBack(async (tx) => {
      await seedDemoShaped(tx, 4);
      await clearDemoData(tx);
      return tx.select({ id: stops.id }).from(stops);
    });
    expect(remaining).toEqual([]);
  });

  it('is safe to run twice, and says zero the second time', async () => {
    const second = await rolledBack(async (tx) => {
      await seedDemoShaped(tx, 3);
      await clearDemoData(tx);
      return clearDemoData(tx);
    });
    expect(second.loadsDeleted).toBe(0);
    expect(isClean(second.remnants)).toBe(true);
  });

  it('reports a clean database as clean when there was never any demo data', async () => {
    const remnants = await rolledBack(async (tx) => {
      await seedRealLoad(tx);
      return countDemoRemnants(tx);
    });
    expect(isClean(remnants)).toBe(true);
  });
});
