import { expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { auditLog, loads, stops } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import { makePosition, makeTruck } from '@/test/fleet';
import { ARRIVAL_DEFAULTS, departureCentre } from '@/lib/arrival';
import type { Tx } from '@/server/audit';
import { arrivalCandidates, recordDetection, sweepArrivals, type ArrivalCandidate } from './arrival';

/**
 * §12.118. The worker never overwrites — or relabels — what a dispatcher
 * recorded.
 *
 * The sweep reads its candidates once, at the top, and writes a while later.
 * A dispatcher can save in between. These run that interleaving for real:
 * read the candidate, save the dispatcher's record the way the app writes it,
 * then let the worker write — and the worker's write finds nothing to do.
 */

const STOP = { lat: 41.525, lng: -88.0817 };
const silent = { info: () => {} };
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

/** One open load, one street stop at STOP; arrived (detected) or not. */
async function stopOnTruck(tx: Tx, arrived: boolean) {
  const truck = await makeTruck(tx);
  const [load] = await tx
    .insert(loads)
    .values({ truckId: truck.id, status: 'DISPATCHED' })
    .returning({ id: loads.id });
  const [stop] = await tx
    .insert(stops)
    .values({
      loadId: load!.id,
      type: 'DEL',
      sequence: 1,
      lat: STOP.lat,
      lng: STOP.lng,
      geocodePrecision: 'street',
      ...(arrived ? { arrivedAt: minutesAgo(40), arrivedSource: 'detected' as const } : {}),
    })
    .returning({ id: stops.id });
  await makePosition(tx, truck.id, { ...STOP, speedMph: 0, recordedAt: minutesAgo(2) });
  return { truckId: truck.id, stopId: stop!.id };
}

const candidateFor = async (tx: Tx, stopId: string): Promise<ArrivalCandidate> =>
  (await arrivalCandidates(tx as never)).find((c) => c.stop_id === stopId)!;

async function state(tx: Tx, stopId: string) {
  const [row] = await tx
    .select({
      arrivedAt: stops.arrivedAt,
      arrivedSource: stops.arrivedSource,
      departedAt: stops.departedAt,
      departedSource: stops.departedSource,
    })
    .from(stops)
    .where(eq(stops.id, stopId));
  return row!;
}

const workerRows = (tx: Tx, stopId: string) =>
  tx
    .select({ after: auditLog.after })
    .from(auditLog)
    .where(and(eq(auditLog.entityId, stopId), sql`${auditLog.after}->>'source' = 'worker'`));

describeDb('the sweep and a dispatcher saving at the same moment (§12.118)', () => {
  it('a hand departure saved after the read is kept: zero rows, no audit row', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await stopOnTruck(tx, true);
      // 1. The sweep reads its candidate: arrived, not departed.
      const candidate = await candidateFor(tx, lane.stopId);

      // 2. The dispatcher saves a departure — the app's write, source and all.
      const handAt = minutesAgo(5);
      await tx
        .update(stops)
        .set({ departedAt: handAt, departedSource: 'dispatcher' })
        .where(eq(stops.id, lane.stopId));

      // 3. The sweep writes the departure it detected from that candidate.
      const rule = departureCentre({
        lat: candidate.lat,
        lng: candidate.lng,
        precision: candidate.precision,
        arrivedAt: candidate.arrived_at,
        departedAt: candidate.departed_at,
        arrivedSource: candidate.arrived_source,
        anchor: null,
      })!;
      const wrote = await recordDetection(
        tx as never,
        candidate,
        { departedAt: minutesAgo(1).toISOString(), rule },
        ARRIVAL_DEFAULTS,
      );
      return {
        read: candidate,
        wrote,
        handAt,
        after: await state(tx, lane.stopId),
        audit: await workerRows(tx, lane.stopId),
      };
    });

    // The read saw the stop open — the write is what found it taken.
    expect(seen.read.departed_at).toBeNull();
    expect(seen.wrote).toBe(false);
    expect(seen.after.departedAt?.toISOString()).toBe(seen.handAt.toISOString());
    expect(seen.after.departedSource).toBe('dispatcher');
    expect(seen.audit).toEqual([]);
  });

  it('a hand arrival saved after the read is kept, and never relabelled detected', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await stopOnTruck(tx, false);
      const candidate = await candidateFor(tx, lane.stopId);
      const handAt = minutesAgo(9);
      await tx
        .update(stops)
        .set({ arrivedAt: handAt, arrivedSource: 'dispatcher' })
        .where(eq(stops.id, lane.stopId));
      const wrote = await recordDetection(
        tx as never,
        candidate,
        { arrivedAt: minutesAgo(8).toISOString() },
        ARRIVAL_DEFAULTS,
      );
      return { wrote, handAt, after: await state(tx, lane.stopId), audit: await workerRows(tx, lane.stopId) };
    });

    expect(seen.wrote).toBe(false);
    expect(seen.after.arrivedAt?.toISOString()).toBe(seen.handAt.toISOString());
    expect(seen.after.arrivedSource).toBe('dispatcher');
    expect(seen.audit).toEqual([]);
  });
});

describeDb('the worker says what it recorded (§12.118)', () => {
  it('writes departed_source itself — there is no bridge to fill it in since 0025', async () => {
    const seen = await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      const [load] = await tx
        .insert(loads)
        .values({ truckId: truck.id, status: 'DISPATCHED' })
        .returning({ id: loads.id });
      const [stop] = await tx
        .insert(stops)
        .values({
          loadId: load!.id,
          type: 'DEL',
          sequence: 1,
          lat: STOP.lat,
          lng: STOP.lng,
          geocodePrecision: 'street',
          arrivedAt: minutesAgo(25),
          arrivedSource: 'detected',
        })
        .returning({ id: stops.id });
      // Parked on the stop, then three minutes driving south at 50 mph.
      for (let s = 25 * 60; s >= 4 * 60; s -= 30) {
        await makePosition(tx, truck.id, { ...STOP, speedMph: 0, recordedAt: new Date(Date.now() - s * 1000) });
      }
      const milesPerFix = (50 / 3600) * 6;
      let i = 1;
      for (let s = 180; s >= 0; s -= 6, i += 1) {
        await makePosition(tx, truck.id, {
          lat: STOP.lat - (i * milesPerFix) / 69,
          lng: STOP.lng,
          speedMph: 50,
          recordedAt: new Date(Date.now() - s * 1000),
        });
      }
      const sweep = await sweepArrivals(tx as never, silent);
      const [audit] = await workerRows(tx, stop!.id);
      return { sweep, after: await state(tx, stop!.id), audit: audit?.after as Record<string, unknown> };
    });

    expect(seen.sweep.departed).toBe(1);
    expect(seen.after.departedAt).not.toBeNull();
    expect(seen.after.departedSource).toBe('detected');
    expect(seen.audit).toMatchObject({ departedSource: 'detected', source: 'worker' });
  });
});

describeDb('a stop the dispatcher marked left is not the worker’s any more (§12.118)', () => {
  it('watches the next stop instead, and leaves the hand departure exactly as it was', async () => {
    const seen = await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      const [load] = await tx
        .insert(loads)
        .values({ truckId: truck.id, status: 'DISPATCHED' })
        .returning({ id: loads.id });
      const handAt = minutesAgo(20);
      const [first] = await tx
        .insert(stops)
        .values({
          loadId: load!.id,
          type: 'PU',
          sequence: 1,
          lat: STOP.lat,
          lng: STOP.lng,
          geocodePrecision: 'street',
          arrivedAt: minutesAgo(60),
          arrivedSource: 'dispatcher',
          departedAt: handAt,
          departedSource: 'dispatcher',
        })
        .returning({ id: stops.id });
      const [second] = await tx
        .insert(stops)
        .values({ loadId: load!.id, type: 'DEL', sequence: 2, lat: 41.9, lng: -87.85, geocodePrecision: 'street' })
        .returning({ id: stops.id });
      // Moving away from stop 1: what a departure looks like, if it were watched.
      for (let s = 180; s >= 0; s -= 6) {
        await makePosition(tx, truck.id, {
          lat: STOP.lat - (180 - s) / 6 / 500,
          lng: STOP.lng,
          speedMph: 50,
          recordedAt: new Date(Date.now() - s * 1000),
        });
      }
      const watched = (await arrivalCandidates(tx as never)).filter((c) => c.truck_id === truck.id);
      await sweepArrivals(tx as never, silent);
      return {
        watched: watched.map((c) => c.stop_id),
        second: second!.id,
        handAt,
        first: await state(tx, first!.id),
        audit: await workerRows(tx, first!.id),
      };
    });

    expect(seen.watched).toEqual([seen.second]);
    expect(seen.first.departedAt?.toISOString()).toBe(seen.handAt.toISOString());
    expect(seen.first.departedSource).toBe('dispatcher');
    expect(seen.audit).toEqual([]);
  });
});
