import { expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { routeSamples, routingBudget, stopRoutes, stops } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import { makeRoutableLane, makeRoutableLanes } from '@/test/fleet';
import { budgetMonth } from '@/lib/routing';
import { sweepRouting } from './routing';
import type { EtaProvider, RouteOutcome } from '@/server/routing/provider';

/**
 * §12.31. The sweep against the real database, always rolled back.
 *
 * The property that matters most is the one that does NOT happen: a poll on
 * an unchanged fleet must spend nothing. 23 trucks every 30 seconds is 66,240
 * polls a day, and the difference between a good and a bad rule here is three
 * orders of magnitude in calls.
 */

const withDb = describeDb;

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
  /**
   * The lanes are built here, so the sweep's input is known (§12.32).
   *
   * These used to sweep whatever production held, while the real worker was
   * polling and committing routes of its own. Under READ COMMITTED each
   * statement takes a fresh snapshot, so rows the worker committed mid-test
   * became visible to a later SELECT — which is how a count of the table
   * returned 27 when the sweep had written 8. Scoping the count to
   * `provider = 'stub'` hid that; owning the database removes it.
   */
  it('routes lanes that have never been routed, and records both rows', async () => {
    const seen = await rolledBack(async (tx) => {
      await makeRoutableLanes(tx, 3);
      const { provider, route } = stubProvider();
      const sweep = await sweepRouting(tx as never, provider, silent, { ceiling: 25_000 });
      const cached = await tx
        .select()
        .from(stopRoutes)
        .where(eq(stopRoutes.provider, 'stub'));
      const samples = await tx
        .select()
        .from(routeSamples)
        .where(eq(routeSamples.provider, 'stub'));
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
      // More lanes than MAX_PER_CYCLE, so convergence genuinely takes several
      // polls — which is the condition the rule has to survive.
      await makeRoutableLanes(tx, 11);
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
      await makeRoutableLanes(tx, 3);
      const { provider } = stubProvider({
        ok: false,
        reason: 'provider-error',
        detail: 'boom',
      });
      const sweep = await sweepRouting(tx as never, provider, silent, { ceiling: 25_000 });
      const [budget] = await tx
        .select()
        .from(routingBudget)
        .where(eq(routingBudget.month, budgetMonth(new Date())));
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
      await makeRoutableLanes(tx, 3);
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
      // Twelve lanes, all unrouted: without the cap this poll would spend 12.
      // Against a database with fewer than nine lanes the assertion below is
      // vacuously true, which is what it was before the fixture existed.
      await makeRoutableLanes(tx, 12);
      const { provider } = stubProvider();
      const sweep = await sweepRouting(tx as never, provider, silent, { ceiling: 25_000 });
      return sweep.routed;
    });
    // MAX_PER_CYCLE — a bad threshold bounds to 8 calls per 30s, not one per truck.
    expect(routed).toBe(8);
  });

  it('re-routes once the stop has been re-geocoded', async () => {
    const calls = await rolledBack(async (tx) => {
      await makeRoutableLanes(tx, 3);
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
    /**
     * This used to assert only that the sweep considered SOMETHING, which was
     * true of any non-empty fleet and said nothing about arrival. With both
     * lanes built here it can assert the thing it is named for: the arrived
     * one is not routed, the open one is.
     */
    const seen = await rolledBack(async (tx) => {
      const open = await makeRoutableLane(tx);
      await makeRoutableLane(tx, { arrived: true });
      const { provider, route } = stubProvider();
      const sweep = await sweepRouting(tx as never, provider, silent, { ceiling: 25_000 });
      const routed = await tx.select({ stopId: stopRoutes.stopId }).from(stopRoutes);
      return { sweep, calls: route.mock.calls.length, routed, openStopId: open.stopId };
    });

    expect(seen.calls).toBe(1);
    expect(seen.sweep.routed).toBe(1);
    expect(seen.routed.map((r) => r.stopId)).toEqual([seen.openStopId]);
  });
});

withDb('the cached route survives a round trip', () => {
  it('reads back as the same numbers it wrote', async () => {
    const seen = await rolledBack(async (tx) => {
      await makeRoutableLane(tx);
      const { provider } = stubProvider();
      await sweepRouting(tx as never, provider, silent, { ceiling: 25_000 });
      const [row] = await tx
        .select()
        .from(stopRoutes)
        .where(eq(stopRoutes.provider, 'stub'))
        .limit(1);
      // `if (!row) return null` used to sit here, so an empty table passed.
      if (!row) throw new Error('the sweep wrote no route for the fixture lane');
      const [again] = await tx
        .select()
        .from(stopRoutes)
        .where(eq(stopRoutes.stopId, row.stopId));
      return { row, again };
    });
    expect(seen.again?.routedMiles).toBe(seen.row.routedMiles);
    expect(seen.again?.computedAt).toBeInstanceOf(Date);
  });
});

/**
 * §12.54. Every candidate lane leaves the sweep with a named outcome.
 *
 * The sweep recorded a reason only for lanes it ROUTED or that the provider
 * refused. Both skip branches did `skipped += 1; continue`, so the poll line
 * read `routesSkipped: 20, routeReasons: {}` whether twenty lanes were
 * correctly current or one was being dropped by the wrong rule. Diagnosing
 * truck 132 took four database queries against a log that had the answer and
 * was not printing it.
 */
withDb('the sweep can explain itself (§12.54)', () => {
  it('accounts for every candidate — the outcomes sum to considered', async () => {
    const seen = await rolledBack(async (tx) => {
      await makeRoutableLanes(tx, 3);
      const { provider } = stubProvider();
      return sweepRouting(tx as never, provider, silent, { ceiling: 25_000 });
    });

    // The property that makes the numbers trustworthy: nothing falls out of
    // the loop unrecorded, so a branch added later cannot be silent.
    const total = Object.values(seen.outcomes).reduce((a, b) => a + b, 0);
    expect(seen.considered).toBeGreaterThan(0);
    expect(total).toBe(seen.considered);
    expect(seen.routed + seen.skipped + seen.failed).toBe(seen.considered);
  });

  /**
   * Truck 132, reconstructed: the stop is re-pointed to an address the truck
   * is already parked beside. `needsRecompute` says `stop-moved` and the
   * half-mile floor then drops it, so the lane is both urgently stale and
   * permanently unroutable — the exact combination the old log could not show.
   */
  it('names a lane dropped by the half-mile floor, and says which floor', async () => {
    const seen = await rolledBack(async (tx) => {
      // 0.31 miles apart, which is where truck 132 actually sat.
      const lane = await makeRoutableLane(tx, {
        from: { lat: 40.934355, lng: -75.949289 },
        to: { lat: 40.93735438403, lng: -75.953783147648 },
      });
      const { provider, route } = stubProvider();
      const sweep = await sweepRouting(tx as never, provider, silent, { ceiling: 25_000 });
      return { sweep, calls: route.mock.calls.length, lane };
    });

    expect(seen.sweep.outcomes['too-close']).toBe(1);
    expect(seen.calls).toBe(0);

    const named = seen.sweep.blocked.find((b) => b.stopId === seen.lane.stopId);
    expect(named).toBeDefined();
    expect(named?.outcome).toBe('too-close');
    expect(named?.truck).toBe(seen.lane.truck.truckNumber);
    // With the distance, so the next reader does not have to query for it.
    expect(named?.straightMiles).toBeCloseTo(0.313, 2);
  });

  it('does not name the lanes that are simply current', async () => {
    const seen = await rolledBack(async (tx) => {
      await makeRoutableLanes(tx, 3);
      const { provider } = stubProvider();
      // First sweep routes them; the second finds every route current.
      await sweepRouting(tx as never, provider, silent, { ceiling: 25_000 });
      return sweepRouting(tx as never, provider, silent, { ceiling: 25_000 });
    });

    expect(seen.outcomes['route-current']).toBe(seen.considered);
    // Naming twenty healthy lanes every thirty seconds is how the one that
    // matters gets buried — which is the failure this whole ruling is about.
    expect(seen.blocked).toEqual([]);
  });

  it('records the cycle cap instead of truncating the list in silence', async () => {
    const seen = await rolledBack(async (tx) => {
      // Ten lanes against a cap of eight.
      await makeRoutableLanes(tx, 10);
      const { provider } = stubProvider();
      return sweepRouting(tx as never, provider, silent, { ceiling: 25_000 });
    });

    expect(seen.routed).toBe(8);
    expect(seen.outcomes['cycle-cap']).toBe(2);
    // Still accounted for: the cap is a deferral, not a disappearance.
    const total = Object.values(seen.outcomes).reduce((a, b) => a + b, 0);
    expect(total).toBe(seen.considered);
    expect(seen.blocked.map((b) => b.outcome)).toEqual(['cycle-cap', 'cycle-cap']);
  });

  it('snapshots the destination it routed to, not a reference to it', async () => {
    /**
     * §12.54. `stop_id` is provenance; the destination facts are the
     * snapshot. 31% of the samples in the database when this was written
     * already named a city their stop no longer had, so joining `stops` to
     * recover a destination returns Hazleton for a Dallas measurement.
     */
    const seen = await rolledBack(async (tx) => {
      const lane = await makeRoutableLane(tx, { to: { lat: 32.7211, lng: -96.8744 } });
      const { provider } = stubProvider();
      await sweepRouting(tx as never, provider, silent, { ceiling: 25_000 });
      const [sample] = await tx
        .select()
        .from(routeSamples)
        .where(eq(routeSamples.stopId, lane.stopId));

      // Re-point the stop 1,100 miles away, as a dispatcher's edit would.
      await tx.update(stops).set({ lat: 40.9373, lng: -75.9537 }).where(eq(stops.id, lane.stopId));
      const [after] = await tx
        .select()
        .from(routeSamples)
        .where(eq(routeSamples.stopId, lane.stopId));
      return { sample, after };
    });

    expect(seen.sample?.destLat).toBeCloseTo(32.7211, 4);
    expect(seen.sample?.destLng).toBeCloseTo(-96.8744, 4);
    // The measurement does not move when the stop does. That is the property.
    expect(seen.after?.destLat).toBeCloseTo(32.7211, 4);
    expect(seen.after?.destLng).toBeCloseTo(-96.8744, 4);
  });

  it('keeps the money separate from the outcome', async () => {
    const seen = await rolledBack(async (tx) => {
      await makeRoutableLanes(tx, 2);
      const { provider } = stubProvider();
      return sweepRouting(tx as never, provider, silent, { ceiling: 25_000 });
    });

    // `routedBecause` answers "what did we spend on", which is a different
    // question from "what happened to each lane" and used to share one field.
    expect(seen.routedBecause['no-route']).toBe(seen.routed);
    expect(seen.failures).toEqual({});
  });

  it('records a provider refusal as its own outcome, with the reason kept', async () => {
    const seen = await rolledBack(async (tx) => {
      await makeRoutableLane(tx);
      const { provider } = stubProvider({ ok: false, reason: 'no-route', detail: 'stub' });
      return sweepRouting(tx as never, provider, silent, { ceiling: 25_000 });
    });

    expect(seen.outcomes['failed']).toBe(1);
    expect(seen.failures['no-route']).toBe(1);
    expect(seen.blocked[0]?.outcome).toBe('failed');
  });
});
