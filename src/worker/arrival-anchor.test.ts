import { expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLog, loads, stops } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import { makePosition, makeTruck } from '@/test/fleet';
import { StopEdit } from '@/lib/stop-edit';
import { STATUS_DEFAULTS } from '@/lib/status';
import { saveStopEdit } from '@/test/stop-save';
import { LATEST_POSITION_SQL, applyStatus, parseFleetRows } from '@/server/fleet-query';
import type { Tx } from '@/server/audit';
import { sweepArrivals } from './arrival';

/**
 * §12.85 end to end: a ZIP-centre stop marked arrived by hand, the truck
 * driving away, and the row clearing — through the real save, the real sweep
 * and the real board query, not the pure functions.
 *
 * The geometry is REAL. Trucks 128 and 143 were parked at 41.4041, -88.1317
 * on 28 Sep 2026 against a stop at 26634 S Walton Dr, Elwood IL, which Census
 * could only place at the 60421 ZIP centroid (41.4142, -88.0835, ±4.4 mi):
 * 2.6 miles from where the trucks actually stood. The sweep cannot arrive
 * them there (§12.30) and, before this, could not have ended a hand-marked
 * arrival either.
 *
 * The sweep reads the last 30 minutes relative to the real clock, so every
 * fix is placed at an offset from `Date.now()`.
 */

const ZIP_CENTRE = { lat: 41.4142, lng: -88.0835, accuracyMiles: 4.4 };
const PARKED = { lat: 41.404141, lng: -88.131737 };
const TZ = 'America/Chicago';
const config = { ...STATUS_DEFAULTS, dispatchTz: TZ };
const silent = { info: () => {} };

/** Set NARRATE=1 to print each step — the demonstration asked for in §12.85. */
const say = (line: string) => {
  if (process.env['NARRATE']) console.info(line);
};

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

/** A wall time in the stop's zone, derived rather than pasted. */
function wallTime(instant: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: { y: Number(parts['year']), m: Number(parts['month']), d: Number(parts['day']) },
    time: { h: Number(parts['hour']), min: Number(parts['minute']) },
    tz: TZ,
  };
}

const editFor = (truckId: string, over: Record<string, unknown>) =>
  StopEdit.parse({
    stopId: null,
    truckId,
    loadNumber: 'ELWOOD-1',
    loadStatus: 'DISPATCHED',
    stopType: 'DEL',
    addressLine: '26634 S Walton Dr',
    city: 'Elwood',
    state: 'IL',
    zip: '60421',
    appointment: null,
    dispatcherNote: null,
    ...over,
  });

/** A load and a ZIP-centre stop on a fresh truck, parked where 128 was. */
async function zipStop(tx: Tx) {
  const truck = await makeTruck(tx);
  const [load] = await tx
    .insert(loads)
    .values({ truckId: truck.id, loadNumber: 'ELWOOD-1', status: 'DISPATCHED' })
    .returning({ id: loads.id });
  const [stop] = await tx
    .insert(stops)
    .values({
      loadId: load!.id,
      type: 'DEL',
      sequence: 1,
      addressLine: '26634 S Walton Dr',
      city: 'Elwood',
      state: 'IL',
      zip: '60421',
      lat: ZIP_CENTRE.lat,
      lng: ZIP_CENTRE.lng,
      geocodePrecision: 'zip',
      geocodeAccuracyMiles: ZIP_CENTRE.accuracyMiles,
      geocodedAt: new Date(),
    })
    .returning({ id: stops.id });
  return { truck, stopId: stop!.id };
}

/** Parked where truck 128 really was, one fix every 30 s. */
async function parkedFrom(tx: Tx, truckId: string, fromMin: number, toMin: number) {
  for (let s = fromMin * 60; s >= toMin * 60; s -= 30) {
    await makePosition(tx, truckId, {
      ...PARKED,
      speedMph: 0,
      recordedAt: new Date(Date.now() - s * 1000),
    });
  }
}

/** Driving south at 50 mph from the parked spot, a fix every 6 s. */
async function drivingAway(tx: Tx, truckId: string, fromSec: number, toSec: number) {
  const milesPerFix = (50 / 3600) * 6;
  let i = 1;
  for (let s = fromSec; s >= toSec; s -= 6, i += 1) {
    await makePosition(tx, truckId, {
      lat: PARKED.lat - (i * milesPerFix) / 69,
      lng: PARKED.lng,
      speedMph: 50,
      recordedAt: new Date(Date.now() - s * 1000),
    });
  }
}

async function row(tx: Tx, truckId: string) {
  const rows = applyStatus(parseFleetRows(await tx.execute(LATEST_POSITION_SQL)), config, new Date());
  return rows.find((r) => r.id === truckId)!;
}

async function stopState(tx: Tx, stopId: string) {
  const [s] = await tx
    .select({
      arrivedAt: stops.arrivedAt,
      arrivedSource: stops.arrivedSource,
      departedAt: stops.departedAt,
      anchorLat: stops.arrivalAnchorLat,
      anchorLng: stops.arrivalAnchorLng,
      anchorAt: stops.arrivalAnchorAt,
    })
    .from(stops)
    .where(eq(stops.id, stopId));
  return s!;
}

const describeRow = (r: Awaited<ReturnType<typeof row>>) =>
  `status ${r.status}` +
  (r.nextStop
    ? ` · next stop ${r.nextStop.addressLine}, ${r.nextStop.city} (${r.nextStop.precision})` +
      (r.nextStop.arrivedAt ? ` · arrived ${r.nextStop.arrivedAt} [${r.nextStop.arrivedSource}]` : '')
    : ' · no next stop');

describeDb('a hand-marked arrival on a ZIP-centre stop ends when the truck leaves (§12.85)', () => {
  it('marks, anchors, sees the truck drive off, and clears the row', async () => {
    const seen = await rolledBack(async (tx) => {
      const { truck, stopId } = await zipStop(tx);
      await parkedFrom(tx, truck.id, 25, 4);

      const before = await row(tx, truck.id);
      say(`\n1. Before: truck parked 2.6 mi from the 60421 ZIP centre (±4.4 mi)`);
      say(`   row: ${describeRow(before)}`);
      const sweep0 = await sweepArrivals(tx as never, silent);
      say(`   sweep: arrived ${sweep0.arrived}, cannotArrive ${JSON.stringify(sweep0.cannotArrive.map((c) => c.precision))}`);

      // The dispatcher ticks it: arrived 25 minutes ago, receiver's clock.
      const saved = await saveStopEdit(tx as never, {
        actorUserId: null,
        dispatchTz: TZ,
        edit: editFor(truck.id, { stopId, arrivedAt: wallTime(minutesAgo(25)) }),
      });
      const marked = await stopState(tx, stopId);
      const markedRow = await row(tx, truck.id);
      say(`\n2. Dispatcher marks it arrived (25 min ago, on the receiver's clock)`);
      say(`   stored: arrived ${marked.arrivedAt?.toISOString()} [${marked.arrivedSource}]`);
      say(`   anchor: ${marked.anchorLat}, ${marked.anchorLng} @ ${marked.anchorAt?.toISOString()}`);
      say(`   warnings: ${JSON.stringify(saved.warnings)}`);
      say(`   row: ${describeRow(markedRow)}`);

      // The truck pulls out: 3 minutes at 50 mph.
      await drivingAway(tx, truck.id, 180, 0);
      const sweep = await sweepArrivals(tx as never, silent);
      const left = await stopState(tx, stopId);
      const afterRow = await row(tx, truck.id);
      const [audit] = await tx
        .select({ after: auditLog.after, actor: auditLog.actorUserId })
        .from(auditLog)
        .where(and(eq(auditLog.entityId, stopId), eq(auditLog.entity, 'stop')))
        .orderBy(auditLog.id);
      const departures = (
        await tx
          .select({ after: auditLog.after })
          .from(auditLog)
          .where(eq(auditLog.entityId, stopId))
      )
        .map((r) => r.after as Record<string, unknown>)
        .filter((a) => 'departedAt' in a);
      say(`\n3. Truck drives away south at 50 mph for 3 minutes; the worker sweeps`);
      say(`   sweep: departed ${sweep.departed}`);
      say(`   stored: departed ${left.departedAt?.toISOString()}`);
      say(`   audit: ${JSON.stringify(departures[0])}`);
      say(`\n4. The row`);
      say(`   row: ${describeRow(afterRow)}`);
      void audit;

      return { before, saved, marked, markedRow, sweep, left, afterRow, departures };
    });

    expect(seen.before.status).not.toBe('ARRIVED');
    // Anchored to where the truck stood, not to the ZIP centroid.
    expect(seen.marked.arrivedSource).toBe('dispatcher');
    expect(seen.marked.anchorLat).toBeCloseTo(PARKED.lat, 6);
    expect(seen.marked.anchorLng).toBeCloseTo(PARKED.lng, 6);
    expect(seen.saved.warnings).toEqual([]);
    expect(seen.markedRow.status).toBe('ARRIVED');

    expect(seen.sweep.departed).toBe(1);
    expect(seen.left.departedAt).not.toBeNull();
    expect(seen.afterRow.status).not.toBe('ARRIVED');
    expect(seen.afterRow.nextStop).toBeNull();

    expect(seen.departures).toHaveLength(1);
    const entry = seen.departures[0]!;
    expect(entry['source']).toBe('departure-after-manual-arrival');
    expect(entry['detection']).toMatchObject({ rule: 'departure', measuredFrom: 'anchor' });
  });

  /**
   * The two-poll confirmation, broken on purpose. One fix six miles away at
   * highway speed — the classic GPS jump — is the newest fix, is moving, is
   * outside the radius: everything a departure needs except corroboration.
   */
  it('does not clear the arrival on a single GPS jump', async () => {
    const seen = await rolledBack(async (tx) => {
      const { truck, stopId } = await zipStop(tx);
      await parkedFrom(tx, truck.id, 25, 1);
      await saveStopEdit(tx as never, {
        actorUserId: null,
        dispatchTz: TZ,
        edit: editFor(truck.id, { stopId, arrivedAt: wallTime(minutesAgo(25)) }),
      });

      // One fix, 6 mi east, 62 mph, newest in the table.
      await makePosition(tx, truck.id, {
        lat: PARKED.lat,
        lng: PARKED.lng + 6 / 52,
        speedMph: 62,
        recordedAt: new Date(),
      });
      const jumped = await sweepArrivals(tx as never, silent);
      const afterJump = await stopState(tx, stopId);
      say(`\nGPS jump: one fix 6 mi away at 62 mph → departed ${jumped.departed}, departedAt ${afterJump.departedAt}`);

      return { jumped, afterJump, row: await row(tx, truck.id) };
    });

    expect(seen.jumped.departed).toBe(0);
    expect(seen.afterJump.departedAt).toBeNull();
    expect(seen.row.status).toBe('ARRIVED');
  });

  it('does not clear it on a burst of jumps shorter than the confirmation', async () => {
    const seen = await rolledBack(async (tx) => {
      const { truck, stopId } = await zipStop(tx);
      await parkedFrom(tx, truck.id, 25, 2);
      await saveStopEdit(tx as never, {
        actorUserId: null,
        dispatchTz: TZ,
        edit: editFor(truck.id, { stopId, arrivedAt: wallTime(minutesAgo(25)) }),
      });
      // 90 seconds of "moving, far away" — fifteen fixes, under 120 s.
      await drivingAway(tx, truck.id, 90, 0);
      const swept = await sweepArrivals(tx as never, silent);
      return { swept, state: await stopState(tx, stopId) };
    });
    expect(seen.swept.departed).toBe(0);
    expect(seen.state.departedAt).toBeNull();
  });

  it('never clears an unanchored hand-marked ZIP arrival, and says so at save', async () => {
    const seen = await rolledBack(async (tx) => {
      const { truck, stopId } = await zipStop(tx);
      // The dispatcher marks it after the truck has already left: moving now.
      await parkedFrom(tx, truck.id, 25, 5);
      await drivingAway(tx, truck.id, 240, 60);
      const saved = await saveStopEdit(tx as never, {
        actorUserId: null,
        dispatchTz: TZ,
        edit: editFor(truck.id, { stopId, arrivedAt: wallTime(minutesAgo(25)) }),
      });
      await drivingAway(tx, truck.id, 54, 0);
      const swept = await sweepArrivals(tx as never, silent);
      say(`\nUnanchored: warnings ${JSON.stringify(saved.warnings)} → departed ${swept.departed}`);
      return { saved, swept, state: await stopState(tx, stopId) };
    });

    expect(seen.state.anchorLat).toBeNull();
    expect(seen.state.departedAt).toBeNull();
    expect(seen.swept.departed).toBe(0);
    expect(seen.saved.warnings).toHaveLength(1);
    expect(seen.saved.warnings[0]!.field).toBe('arrivedAt');
    expect(seen.saved.warnings[0]!.message).toMatch(/moving/);
    expect(seen.saved.warnings[0]!.message).toMatch(/will not clear by itself/);
  });
});
