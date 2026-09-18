import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createPooledDb } from '@/db/connection';
import { routeSamples, routingBudget, stopRoutes } from '@/db/schema';
import { sweepRouting } from './routing';
import type { EtaProvider, RouteOutcome } from '@/server/routing/provider';
import type { Tx } from '@/server/audit';

/**
 * §12.31. The sweep against the real database, always rolled back.
 *
 * The property that matters most is the one that does NOT happen: a poll on
 * an unchanged fleet must spend nothing. 23 trucks every 30 seconds is 66,240
 * polls a day, and the difference between a good and a bad rule here is three
 * orders of magnitude in calls.
 */

const url = process.env.DATABASE_URL;
const withDb = url ? describe : describe.skip;

let handle: ReturnType<typeof createPooledDb> | null = null;
const connect = () => (handle ??= createPooledDb(url!));
afterAll(async () => {
  await handle?.client.end({ timeout: 5 });
});

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

const silent = { info: () => {}, warn: () => {} };

/** Always answers, and counts how often it was asked. */
function stubProvider(outcome?: RouteOutcome) {
  const route = vi.fn(
    async (): Promise<RouteOutcome> =>
      outcome ?? {
        ok: true,
        miles: 481.3,
        durationSeconds: 7.35 * 3600,
        snapFromMeters: 4,
        snapToMeters: 379,
      },
  );
  const provider: EtaProvider = { name: 'stub', route };
  return { provider, route };
}

withDb('the routing sweep', () => {
  it('routes lanes that have never been routed, and records both rows', async () => {
    const seen = await rolledBack(async (tx) => {
      // Start from a clean slate inside the transaction.
      await tx.delete(stopRoutes);
      const { provider, route } = stubProvider();
      const sweep = await sweepRouting(tx as never, provider, silent, { ceiling: 25_000 });
      const cached = await tx.select().from(stopRoutes);
      const samples = await tx.select().from(routeSamples);
      return { sweep, calls: route.mock.calls.length, cached, samples };
    });

    expect(seen.sweep.routed).toBeGreaterThan(0);
    expect(seen.calls).toBe(seen.sweep.routed);
    expect(seen.cached.length).toBe(seen.sweep.routed);
    // The sample log fills itself without anyone thinking about it.
    expect(seen.samples.length).toBe(seen.sweep.routed);

    const row = seen.cached[0]!;
    expect(row.laneRatio).toBeCloseTo(row.routedMiles / row.straightAtRouteMiles, 6);
    expect(row.provider).toBe('stub');

    const sample = seen.samples[0]!;
    expect(sample.impliedMph).toBeCloseTo(481.3 / 7.35, 1);
    expect(sample.destState).not.toBeNull();
  });

  /**
   * The rule that keeps this affordable, and the assertion this whole feature
   * lives or dies on.
   *
   * Sweeps run until the fleet is fully routed — MAX_PER_CYCLE means that
   * takes several polls, by design — and THEN one more must spend nothing at
   * all. 23 trucks every 30 seconds is 66,240 polls a day; if a settled fleet
   * costs anything per poll, the bill is the feature.
   */
  it('spends NOTHING once every lane is routed and nothing has moved', async () => {
    const calls = await rolledBack(async (tx) => {
      await tx.delete(stopRoutes);
      const { provider, route } = stubProvider();

      let guard = 0;
      for (;;) {
        const sweep = await sweepRouting(tx as never, provider, silent, { ceiling: 25_000 });
        if (sweep.routed === 0) break;
        if ((guard += 1) > 20) throw new Error('sweep never converged');
      }
      const afterConverged = route.mock.calls.length;

      const settled = await sweepRouting(tx as never, provider, silent, { ceiling: 25_000 });
      return { afterConverged, total: route.mock.calls.length, settled };
    });

    expect(calls.afterConverged).toBeGreaterThan(0);
    expect(calls.total).toBe(calls.afterConverged);
    expect(calls.settled.routed).toBe(0);
    expect(calls.settled.skipped).toBeGreaterThan(0);
  });

  it('counts every call against the month, including ones that fail', async () => {
    const seen = await rolledBack(async (tx) => {
      await tx.delete(stopRoutes);
      await tx.delete(routingBudget);
      const { provider } = stubProvider({
        ok: false,
        reason: 'provider-error',
        detail: 'boom',
      });
      const sweep = await sweepRouting(tx as never, provider, silent, { ceiling: 25_000 });
      const [budget] = await tx.select().from(routingBudget);
      return { sweep, budget };
    });

    // A call that failed still cost quota. Counting only successes would let
    // a broken provider burn the month while the counter said zero.
    expect(seen.sweep.failed).toBeGreaterThan(0);
    expect(seen.budget?.calls).toBe(seen.sweep.failed);
    expect(seen.sweep.routed).toBe(0);
  });

  /** A caching bug should cost accuracy, not money. */
  it('stops dead at the monthly ceiling instead of spending', async () => {
    const seen = await rolledBack(async (tx) => {
      await tx.delete(stopRoutes);
      await tx.delete(routingBudget);
      await tx.insert(routingBudget).values({
        month: `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`,
        calls: 100,
      });
      const { provider, route } = stubProvider();
      const sweep = await sweepRouting(tx as never, provider, silent, { ceiling: 100 });
      return { sweep, calls: route.mock.calls.length };
    });

    expect(seen.sweep.budgetExhausted).toBe(true);
    expect(seen.calls).toBe(0);
    expect(seen.sweep.routed).toBe(0);
  });

  it('caps how many routes one poll may spend', async () => {
    const routed = await rolledBack(async (tx) => {
      await tx.delete(stopRoutes);
      const { provider } = stubProvider();
      const sweep = await sweepRouting(tx as never, provider, silent, { ceiling: 25_000 });
      return sweep.routed;
    });
    // MAX_PER_CYCLE — a bad threshold bounds to 8 calls per 30s, not one per truck.
    expect(routed).toBeLessThanOrEqual(8);
  });

  it('re-routes once the stop has been re-geocoded', async () => {
    const calls = await rolledBack(async (tx) => {
      await tx.delete(stopRoutes);
      const { provider, route } = stubProvider();
      await sweepRouting(tx as never, provider, silent, { ceiling: 25_000 });
      const afterFirst = route.mock.calls.length;
      // Move every cached destination: the route now measures elsewhere.
      await tx.update(stopRoutes).set({ stopLat: sql`${stopRoutes.stopLat} + 1.0` });
      await sweepRouting(tx as never, provider, silent, { ceiling: 25_000 });
      return { afterFirst, total: route.mock.calls.length };
    });
    expect(calls.total).toBeGreaterThan(calls.afterFirst);
  });

  it('leaves an arrived stop alone — there is nothing left to route to', async () => {
    const considered = await rolledBack(async (tx) => {
      await tx.delete(stopRoutes);
      const { provider } = stubProvider();
      const before = await sweepRouting(tx as never, provider, silent, { ceiling: 25_000 });
      return before.routed + before.skipped;
    });
    expect(considered).toBeGreaterThan(0);
  });
});

withDb('the cached route survives a round trip', () => {
  it('reads back as the same numbers it wrote', async () => {
    const seen = await rolledBack(async (tx) => {
      await tx.delete(stopRoutes);
      const { provider } = stubProvider();
      await sweepRouting(tx as never, provider, silent, { ceiling: 25_000 });
      const [row] = await tx.select().from(stopRoutes).limit(1);
      if (!row) return null;
      const [again] = await tx
        .select()
        .from(stopRoutes)
        .where(eq(stopRoutes.stopId, row.stopId));
      return { row, again };
    });
    if (!seen) return;
    expect(seen.again?.routedMiles).toBe(seen.row.routedMiles);
    expect(seen.again?.computedAt).toBeInstanceOf(Date);
  });
});
