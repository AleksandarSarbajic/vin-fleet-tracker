import { expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { etaMarks, loads, stopRoutes, stops } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import { makePosition, makeTruck } from '@/test/fleet';
import { STATUS_DEFAULTS } from '@/lib/status';
import { LATEST_POSITION_SQL, applyStatus, parseFleetRows } from '@/server/fleet-query';
import type { Tx } from '@/server/audit';
import type { EtaProvider, RouteOutcome } from '@/server/routing/provider';
import { sweepArrivals } from './arrival';
import { logEtaMarks } from './eta-marks';
import { sweepRouting } from './routing';

/**
 * A load with two stops, through the three worker sweeps (§12.13).
 *
 * Every worker query used to pick "the next stop" with its own filters INSIDE
 * the ordered lookup — coordinates for the arrival sweep, coordinates and "not
 * arrived" for routing and the ETA log. On a one-stop load that only ever
 * removed the stop; on a two-stop load it moved past stop 1 to stop 2 while
 * the board still showed stop 1. Truck 124's bug (§12.13) by another route:
 * the worker watching, routing and scoring a stop the dispatcher was not
 * looking at.
 *
 * Each case builds a truck whose board says stop 1 and asserts that no sweep
 * acts on stop 2.
 *
 * The sweeps read the last 30 minutes relative to the real clock, so every
 * fix is placed at an offset from `Date.now()`.
 */

/** 1900 N 25th Ave, Melrose Park IL — the pickup. */
const PICKUP = { lat: 41.9006, lng: -87.8567 };
/** Joliet IL — the delivery, about 28 miles south-west. */
const DELIVERY = { lat: 41.525, lng: -88.0817 };
const TZ = 'America/Chicago';
const config = { ...STATUS_DEFAULTS, dispatchTz: TZ };
const silent = { info: () => {}, warn: () => {} };

interface LegOptions {
  /** False leaves the stop unlocated: no coordinates, no precision. */
  located?: boolean;
  /** A detected arrival an hour ago, not departed. */
  arrived?: boolean;
}

/** One open load on a fresh truck: seq 1 PU at Melrose Park, seq 2 DEL at Joliet. */
async function twoStopLoad(tx: Tx, pickup: LegOptions = {}, delivery: LegOptions = {}) {
  const truck = await makeTruck(tx);
  const [load] = await tx
    .insert(loads)
    .values({ truckId: truck.id, loadNumber: 'VT-TWO-STOP', status: 'DISPATCHED' })
    .returning({ id: loads.id });

  const leg = async (
    sequence: number,
    type: 'PU' | 'DEL',
    at: { lat: number; lng: number },
    options: LegOptions,
    hoursAhead: number,
  ) => {
    const located = options.located ?? true;
    const [row] = await tx
      .insert(stops)
      .values({
        loadId: load!.id,
        type,
        sequence,
        addressLine: `${sequence} Vitest Dock`,
        city: type === 'PU' ? 'Melrose Park' : 'Joliet',
        state: 'IL',
        ...(located
          ? {
              lat: at.lat,
              lng: at.lng,
              geocodePrecision: 'street' as const,
              geocodedAt: new Date(),
            }
          : {}),
        appointmentStartUtc: new Date(Date.now() + hoursAhead * 3_600_000),
        appointmentTz: TZ,
        appointmentType: 'APPT',
        ...(options.arrived
          ? { arrivedAt: new Date(Date.now() - 3_600_000), arrivedSource: 'detected' as const }
          : {}),
      })
      .returning({ id: stops.id });
    return row!.id;
  };

  const pickupId = await leg(1, 'PU', PICKUP, pickup, 2);
  const deliveryId = await leg(2, 'DEL', DELIVERY, delivery, 8);
  return { truck, loadId: load!.id, pickupId, deliveryId };
}

/** Parked at `where`, one fix every 30 s from `fromMin` to `toMin` minutes ago. */
async function parkedAt(
  tx: Tx,
  truckId: string,
  where: { lat: number; lng: number },
  fromMin = 25,
  toMin = 4,
) {
  for (let s = fromMin * 60; s >= toMin * 60; s -= 30) {
    await makePosition(tx, truckId, {
      ...where,
      speedMph: 0,
      recordedAt: new Date(Date.now() - s * 1000),
    });
  }
}

/** Driving south from the pickup at 50 mph, a fix every 6 s, the last 3 minutes. */
async function drivingAwayFromPickup(tx: Tx, truckId: string) {
  const milesPerFix = (50 / 3600) * 6;
  let i = 1;
  for (let s = 180; s >= 0; s -= 6, i += 1) {
    await makePosition(tx, truckId, {
      lat: PICKUP.lat - (i * milesPerFix) / 69,
      lng: PICKUP.lng,
      speedMph: 50,
      recordedAt: new Date(Date.now() - s * 1000),
    });
  }
}

/** What the board shows for this truck — the reference every sweep must agree with. */
async function boardFor(tx: Tx, truckId: string) {
  const rows = applyStatus(
    parseFleetRows(await tx.execute(LATEST_POSITION_SQL)),
    config,
    new Date(),
  );
  return rows.find((r) => r.id === truckId)!;
}

async function stopState(tx: Tx, stopId: string) {
  const [row] = await tx
    .select({ arrivedAt: stops.arrivedAt, departedAt: stops.departedAt })
    .from(stops)
    .where(eq(stops.id, stopId));
  return row!;
}

/** Always answers, and counts how often it was asked. */
function stubProvider() {
  const route = vi.fn(
    async (): Promise<RouteOutcome> => ({
      ok: true,
      miles: 31.2,
      durationSeconds: 2_400,
      baseDurationSeconds: 2_100,
      snapFromMeters: 4,
      snapToMeters: 12,
    }),
  );
  const provider: EtaProvider = { name: 'stub', route };
  return { provider, route };
}

describeDb('the arrival sweep watches the board’s next stop on a two-stop load', () => {
  it('does not watch stop 2 while stop 1 is unlocated', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await twoStopLoad(tx, { located: false });
      // Parked on the delivery itself: if the sweep were watching stop 2, this
      // is an arrival it could not miss.
      await parkedAt(tx, lane.truck.id, DELIVERY);
      const sweep = await sweepArrivals(tx as never, silent);
      return {
        lane,
        sweep,
        board: await boardFor(tx, lane.truck.id),
        delivery: await stopState(tx, lane.deliveryId),
      };
    });

    expect(seen.board.nextStop?.stopId).toBe(seen.lane.pickupId);
    // The board's stop cannot be detected, so there is nothing to watch.
    expect(seen.sweep.considered).toBe(0);
    expect(seen.sweep.arrived).toBe(0);
    expect(seen.delivery.arrivedAt).toBeNull();
  });

  it('keeps watching stop 1 while it is arrived, and arrives nothing at stop 2', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await twoStopLoad(tx, { arrived: true });
      // Parked on the delivery, standing still: a sweep watching stop 2 would
      // record an arrival there, and one watching stop 1 sees no departure,
      // because the newest fix is not moving.
      await parkedAt(tx, lane.truck.id, DELIVERY);
      const sweep = await sweepArrivals(tx as never, silent);
      return {
        lane,
        sweep,
        board: await boardFor(tx, lane.truck.id),
        pickup: await stopState(tx, lane.pickupId),
        delivery: await stopState(tx, lane.deliveryId),
      };
    });

    expect(seen.board.nextStop?.stopId).toBe(seen.lane.pickupId);
    expect(seen.board.status).toBe('ARRIVED');
    // Watched for its departure — the one thing that can move the board on.
    expect(seen.sweep.considered).toBe(1);
    expect(seen.sweep.departed).toBe(0);
    expect(seen.pickup.departedAt).toBeNull();
    expect(seen.delivery.arrivedAt).toBeNull();
  });
});

describeDb('departure, not arrival, moves a two-stop load on (§12.13)', () => {
  it('stays on the pickup when it is arrived, and moves to the delivery when it is left', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await twoStopLoad(tx);

      await parkedAt(tx, lane.truck.id, PICKUP);
      const arrival = await sweepArrivals(tx as never, silent);
      const atPickup = await boardFor(tx, lane.truck.id);
      const pickupArrived = await stopState(tx, lane.pickupId);

      await drivingAwayFromPickup(tx, lane.truck.id);
      const departure = await sweepArrivals(tx as never, silent);
      const leaving = await boardFor(tx, lane.truck.id);
      const pickupLeft = await stopState(tx, lane.pickupId);

      return { lane, arrival, atPickup, pickupArrived, departure, leaving, pickupLeft };
    });

    // Arrival alone: the pickup is still the next stop, now ARRIVED.
    expect(seen.arrival.arrived).toBe(1);
    expect(seen.pickupArrived.arrivedAt).not.toBeNull();
    expect(seen.atPickup.nextStop?.stopId).toBe(seen.lane.pickupId);
    expect(seen.atPickup.status).toBe('ARRIVED');

    // Departure: the delivery becomes the next stop.
    expect(seen.departure.departed).toBe(1);
    expect(seen.pickupLeft.departedAt).not.toBeNull();
    expect(seen.leaving.nextStop?.stopId).toBe(seen.lane.deliveryId);
    expect(seen.leaving.status).not.toBe('ARRIVED');
  });
});

describeDb('the routing sweep routes the board’s next stop on a two-stop load', () => {
  it('routes nothing while the truck is at an arrived pickup', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await twoStopLoad(tx, { arrived: true });
      await parkedAt(tx, lane.truck.id, PICKUP, 2, 1);
      const { provider, route } = stubProvider();
      const sweep = await sweepRouting(tx as never, provider, silent, { ceiling: 25_000 });
      const routed = await tx.select({ stopId: stopRoutes.stopId }).from(stopRoutes);
      return { lane, sweep, calls: route.mock.calls.length, routed };
    });

    expect(seen.sweep.considered).toBe(0);
    expect(seen.calls).toBe(0);
    expect(seen.routed).toEqual([]);
  });

  it('routes nothing while the pickup is unlocated', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await twoStopLoad(tx, { located: false });
      await parkedAt(tx, lane.truck.id, PICKUP, 2, 1);
      const { provider, route } = stubProvider();
      const sweep = await sweepRouting(tx as never, provider, silent, { ceiling: 25_000 });
      const routed = await tx.select({ stopId: stopRoutes.stopId }).from(stopRoutes);
      return { lane, sweep, calls: route.mock.calls.length, routed };
    });

    expect(seen.sweep.considered).toBe(0);
    expect(seen.calls).toBe(0);
    expect(seen.routed).toEqual([]);
  });

  it('routes the pickup itself when it is the open next stop', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await twoStopLoad(tx);
      await parkedAt(tx, lane.truck.id, { lat: 42.2, lng: -87.9 }, 2, 1);
      const { provider } = stubProvider();
      await sweepRouting(tx as never, provider, silent, { ceiling: 25_000 });
      const routed = await tx.select({ stopId: stopRoutes.stopId }).from(stopRoutes);
      return { lane, routed };
    });

    expect(seen.routed.map((r) => r.stopId)).toEqual([seen.lane.pickupId]);
  });
});

describeDb('the ETA log scores the board’s next stop on a two-stop load (§12.112)', () => {
  it('writes nothing for the delivery while the truck is at the pickup', async () => {
    const rows = await rolledBack(async (tx) => {
      const lane = await twoStopLoad(tx, { arrived: true });
      await parkedAt(tx, lane.truck.id, PICKUP, 2, 1);
      const result = await logEtaMarks(tx);
      const marks = await tx.select({ stopId: etaMarks.stopId }).from(etaMarks);
      return { result, marks };
    });

    expect(rows.result.considered).toBe(0);
    expect(rows.marks).toEqual([]);
  });

  it('writes nothing for the delivery while the pickup is unlocated', async () => {
    const rows = await rolledBack(async (tx) => {
      const lane = await twoStopLoad(tx, { located: false });
      await parkedAt(tx, lane.truck.id, { lat: 42.2, lng: -87.9 }, 2, 1);
      const result = await logEtaMarks(tx);
      const marks = await tx.select({ stopId: etaMarks.stopId }).from(etaMarks);
      return { result, marks };
    });

    expect(rows.result.considered).toBe(0);
    expect(rows.marks).toEqual([]);
  });

  it('logs the delivery once the pickup has been left', async () => {
    const rows = await rolledBack(async (tx) => {
      const lane = await twoStopLoad(tx, { arrived: true });
      await tx
        .update(stops)
        .set({ departedAt: new Date(Date.now() - 30 * 60_000) })
        .where(eq(stops.id, lane.pickupId));
      await parkedAt(tx, lane.truck.id, { lat: 41.7, lng: -88.0 }, 2, 1);
      await logEtaMarks(tx);
      const marks = await tx.select({ stopId: etaMarks.stopId }).from(etaMarks);
      return { lane, marks };
    });

    expect(rows.marks.map((m) => m.stopId)).toEqual([rows.lane.deliveryId]);
  });
});
