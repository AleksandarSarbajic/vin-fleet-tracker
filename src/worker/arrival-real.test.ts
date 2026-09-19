import { expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { loads, stops } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import { makeTruck, makePosition } from '@/test/fleet';
import {
  TRUCK_133_HALT_POINT,
  TRUCK_133_TRAFFIC_STOP,
  TRUCK_142_PARKED,
  TRUCK_142_PARK_POINT,
  type RealFix,
} from '@/test/real-tracks';
import { sweepArrivals } from './arrival';
import type { Db, Tx } from '@/server/audit';

/**
 * Arrival detection against REAL position data (§12.36).
 *
 * The 24 tests in lib/arrival.test.ts prove the rule. These prove the rule
 * survives contact with the feed: real cadence, real GPS wander, real speed
 * values, and the whole sweep rather than the pure function.
 *
 * The fixes are replayed at their recorded offsets relative to "now", because
 * the sweep only looks back 30 minutes. Nothing about the data is changed —
 * the gaps between fixes, which is what the two-poll confirmation measures,
 * are exactly as recorded.
 */

const silent = { info: () => {} };

/** Replays a real track as if it had just happened. */
async function replay(tx: Tx, truckId: string, fixes: RealFix[]) {
  const last = Date.parse(fixes[fixes.length - 1]!.recordedAtUtc);
  const now = Date.now();
  for (const fix of fixes) {
    await makePosition(tx, truckId, {
      lat: fix.lat,
      lng: fix.lng,
      speedMph: fix.speedMph,
      // Shifted as a block: every interval between fixes is preserved.
      recordedAt: new Date(now - (last - Date.parse(fix.recordedAtUtc))),
    });
  }
}

async function stopAt(tx: Tx, truckId: string, point: { lat: number; lng: number }) {
  const [load] = await tx
    .insert(loads)
    .values({ truckId, loadNumber: 'REAL-1', status: 'DISPATCHED' })
    .returning({ id: loads.id });
  const [stop] = await tx
    .insert(stops)
    .values({
      loadId: load!.id,
      type: 'DEL',
      sequence: 1,
      addressLine: '1 Real Track Road',
      city: 'Somewhere',
      state: 'WI',
      zip: '53965',
      lat: point.lat,
      lng: point.lng,
      geocodePrecision: 'street',
      geocodeAccuracyMiles: 0.1,
      geocodedAt: new Date(),
      appointmentStartUtc: new Date(Date.now() + 2 * 3_600_000),
      appointmentEndUtc: new Date(Date.now() + 3 * 3_600_000),
      appointmentTz: 'America/Chicago',
      appointmentType: 'APPT',
    })
    .returning({ id: stops.id });
  return stop!.id;
}

describeDb('real position data: a truck that is genuinely parked', () => {
  it('is detected as arrived, through the whole sweep', async () => {
    const seen = await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      const stopId = await stopAt(tx, truck.id, TRUCK_142_PARK_POINT);
      await replay(tx, truck.id, TRUCK_142_PARKED);

      const sweep = await sweepArrivals(tx as unknown as Db, silent);
      const [row] = await tx
        .select({
          arrivedAt: stops.arrivedAt,
          arrivedSource: stops.arrivedSource,
          departedAt: stops.departedAt,
        })
        .from(stops)
        .where(eq(stops.id, stopId));
      return { sweep, row };
    });

    expect(seen.sweep.arrived).toBe(1);
    expect(seen.row?.arrivedAt).toBeInstanceOf(Date);
    expect(seen.row?.departedAt).toBeNull();
    /**
     * §12.57. The sweep says what KIND of claim it just made. The modal can
     * write this column too now, and a detection that did not label itself
     * would be indistinguishable from somebody's guess — with the row
     * printing `arrived` over a time nothing measured.
     */
    expect(seen.row?.arrivedSource).toBe('detected');
  });

  it('anchors the arrival to a recorded fix, never to now()', async () => {
    const drift = await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      await stopAt(tx, truck.id, TRUCK_142_PARK_POINT);
      await replay(tx, truck.id, TRUCK_142_PARKED);
      await sweepArrivals(tx as unknown as Db, silent);
      const [row] = await tx
        .select({ arrivedAt: stops.arrivedAt })
        .from(stops)
        .where(sql`${stops.arrivedAt} is not null`);
      return Date.now() - (row?.arrivedAt?.getTime() ?? 0);
    });
    // The truck stopped ~5 minutes before the last fix. An arrival stamped
    // with now() would read as zero drift, which is the bug this rules out.
    expect(drift).toBeGreaterThan(60_000);
  });

  it('writes an audit row with the worker as actor', async () => {
    const entry = await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      await stopAt(tx, truck.id, TRUCK_142_PARK_POINT);
      await replay(tx, truck.id, TRUCK_142_PARKED);
      await sweepArrivals(tx as unknown as Db, silent);
      const rows = (await tx.execute(
        sql`select actor_user_id, after from audit_log where entity = 'stop'`,
      )) as unknown as {
        actor_user_id: string | null;
        after: Record<string, unknown>;
      }[];
      return rows[0];
    });
    // A stop flipping to ARRIVED with nobody's name on it has to be
    // explainable, and audit_log is the only thing that answers. No actor
    // user id, because no person did this — `source: 'worker'` is what names
    // the actor.
    expect(entry?.actor_user_id).toBeNull();
    expect(entry?.after?.source).toBe('worker');
    expect(entry?.after?.arrivedAt).toBeTruthy();
  });
});

describeDb('real position data: a truck stopped at a traffic light', () => {
  /**
   * THE failure that matters. Truck 133 held 0 mph for thirty-six seconds at
   * a junction and then drove on at 69. A detector that fires here parks a
   * moving truck on the board and tells a dispatcher it has arrived somewhere
   * it drove straight past.
   */
  it('is NOT detected as arrived, with the stop on the exact halt point', async () => {
    const seen = await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      const stopId = await stopAt(tx, truck.id, TRUCK_133_HALT_POINT);
      await replay(tx, truck.id, TRUCK_133_TRAFFIC_STOP);

      const sweep = await sweepArrivals(tx as unknown as Db, silent);
      const [row] = await tx
        .select({ arrivedAt: stops.arrivedAt })
        .from(stops)
        .where(eq(stops.id, stopId));
      return { sweep, arrivedAt: row?.arrivedAt ?? null };
    });

    expect(seen.sweep.arrived).toBe(0);
    expect(seen.arrivedAt).toBeNull();
    // It was still considered — this is the rule declining, not the sweep
    // failing to look.
    expect(seen.sweep.considered).toBeGreaterThan(0);
  });

  it('reports how close it got, so the silence is legible', async () => {
    const logged: Record<string, unknown>[] = [];
    await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      await stopAt(tx, truck.id, TRUCK_133_HALT_POINT);
      await replay(tx, truck.id, TRUCK_133_TRAFFIC_STOP);
      await sweepArrivals(tx as unknown as Db, {
        info: (_m, fields) => {
          if (fields) logged.push(fields);
        },
      });
    });

    const nearest = logged.find((f) => 'nearestMiles' in f);
    expect(nearest).toBeDefined();
    // Dead on the halt point, so the distance is ~0 and the reason is the
    // confirmation window, not the radius. Without this the sweep reports
    // "arrived: 0" for a truck 600 miles away and for one sitting in the
    // receiver's yard, and they read identically.
    expect(Number(nearest?.nearestMiles)).toBeLessThan(0.05);
    expect(nearest?.nearestBlockedBy).toBe('not-confirmed');
  });
});
