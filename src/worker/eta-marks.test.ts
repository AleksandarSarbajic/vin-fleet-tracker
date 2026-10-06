import { describe, expect, it, vi } from 'vitest';
import { asc, eq, sql } from 'drizzle-orm';
import { etaMarks, loads, positions, stops } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import { makePosition, makeRoutableLane } from '@/test/fleet';
import { haversineMiles } from '@/lib/status';
import type { Tx } from '@/server/audit';
import { logEtaMarks, runEtaLog, runEtaSettle, settleEtaMarks } from './eta-marks';

/**
 * §12.112. The prediction log against the real database, always rolled back.
 *
 * The rules that matter: a distance is recorded once, the first time, and
 * only if the truck was first seen beyond it; and nothing that goes wrong in
 * here can reach the poll.
 */

const STOP = { lat: 41.525, lng: -88.0817 };
/** A point `miles` due south of the stop (a degree of latitude is ~69.09 mi). */
const south = (miles: number) => ({ lat: STOP.lat - miles / 69.09, lng: STOP.lng });

const quiet = () => ({ warn: vi.fn(), info: vi.fn() });

/** A lane whose truck was last seen `miles` out, a minute ago. */
async function laneAt(tx: Tx, miles: number) {
  return makeRoutableLane(tx, { from: south(miles), to: STOP });
}

let tick = 0;
/** A newer fix: each call is a second later than the last, all after the lane's own. */
async function moveTo(tx: Tx, truckId: string, miles: number, speedMph = 60) {
  tick += 1;
  await makePosition(tx, truckId, {
    ...south(miles),
    speedMph,
    recordedAt: new Date(Date.now() - 50_000 + tick * 100),
  });
}

async function marksFor(tx: Tx, stopId: string) {
  return tx
    .select()
    .from(etaMarks)
    .where(eq(etaMarks.stopId, stopId))
    // `logged_at` is the transaction's instant, the same for every row here.
    .orderBy(asc(etaMarks.destLat), sql`mark_miles desc nulls first`);
}

describe('the fixture geometry', () => {
  it('puts the truck where the tests say it is', () => {
    expect(haversineMiles(south(205), STOP)).toBeCloseTo(205, 0);
  });
});

describeDb('the ETA prediction log', () => {
  it('records the first sighting, then each distance the first time it is crossed', async () => {
    const { rows, truckNumber } = await rolledBack(async (tx) => {
      const lane = await laneAt(tx, 205);
      await logEtaMarks(tx);
      await moveTo(tx, lane.truck.id, 150);
      await logEtaMarks(tx);
      await moveTo(tx, lane.truck.id, 40);
      await logEtaMarks(tx);
      return { rows: await marksFor(tx, lane.stopId), truckNumber: lane.truck.truckNumber };
    });

    expect(rows.map((r) => r.markMiles)).toEqual([null, 200, 100, 50]);
    const [first, at200] = rows;
    expect(first!.straightMiles).toBeCloseTo(205, 0);
    // A lane nobody has routed shows the straight line — and the log says so.
    expect(at200!.basis).toBe('straight-line');
    expect(at200!.etaUtc.getTime()).toBeGreaterThan(at200!.fixRecordedAt.getTime());
    expect(at200!.truckNumber).toBe(truckNumber);
    expect(at200!.settledAt).toBeNull();
  });

  it('logs nothing new when nothing has been crossed', async () => {
    const count = await rolledBack(async (tx) => {
      const lane = await laneAt(tx, 205);
      for (let i = 0; i < 3; i += 1) await logEtaMarks(tx);
      await moveTo(tx, lane.truck.id, 201);
      await logEtaMarks(tx);
      return (await marksFor(tx, lane.stopId)).length;
    });
    expect(count).toBe(1);
  });

  it('never records a distance the truck was already inside when first seen', async () => {
    const rows = await rolledBack(async (tx) => {
      const lane = await laneAt(tx, 80);
      await logEtaMarks(tx);
      await moveTo(tx, lane.truck.id, 30);
      await logEtaMarks(tx);
      return marksFor(tx, lane.stopId);
    });
    // No 400, 200 or 100: the board never showed a prediction from out there.
    expect(rows.map((r) => r.markMiles)).toEqual([null, 50]);
  });

  it('does not log a distance again when the truck drives away and comes back', async () => {
    const rows = await rolledBack(async (tx) => {
      const lane = await laneAt(tx, 60);
      await logEtaMarks(tx);
      await moveTo(tx, lane.truck.id, 45);
      await logEtaMarks(tx);
      await moveTo(tx, lane.truck.id, 58);
      await logEtaMarks(tx);
      await moveTo(tx, lane.truck.id, 44);
      await logEtaMarks(tx);
      return marksFor(tx, lane.stopId);
    });
    expect(rows.map((r) => r.markMiles)).toEqual([null, 50]);
  });

  it('starts again for a stop edited to a new destination — a new trip', async () => {
    const rows = await rolledBack(async (tx) => {
      const lane = await laneAt(tx, 60);
      await logEtaMarks(tx);
      await tx
        .update(stops)
        .set({ lat: STOP.lat + 0.5 })
        .where(eq(stops.id, lane.stopId));
      await logEtaMarks(tx);
      return marksFor(tx, lane.stopId);
    });
    expect(rows.map((r) => r.markMiles)).toEqual([null, null]);
    expect(rows[0]!.destKey).not.toBe(rows[1]!.destKey);
  });

  it('treats a point re-spelled as a different float as the same trip', async () => {
    const rows = await rolledBack(async (tx) => {
      const lane = await laneAt(tx, 60);
      await logEtaMarks(tx);
      // The same point, one ulp-ish away: what a round trip through text can do.
      await tx
        .update(stops)
        .set({ lat: STOP.lat + 1e-12, lng: STOP.lng - 1e-12 })
        .where(eq(stops.id, lane.stopId));
      await logEtaMarks(tx);
      await moveTo(tx, lane.truck.id, 45);
      await logEtaMarks(tx);
      return marksFor(tx, lane.stopId);
    });
    // One trip: one first-seen row, and the 50 mark against it.
    expect(rows.map((r) => r.markMiles)).toEqual([null, 50]);
    expect(new Set(rows.map((r) => r.destKey)).size).toBe(1);
  });
});

describeDb('a failure in the log never reaches the poll', () => {
  /** Makes every insert into eta_marks fail, for this transaction only. */
  async function breakInserts(tx: Tx, body = `raise exception 'eta_marks insert refused (test)'`) {
    await tx.execute(
      sql.raw(`create function pg_temp.refuse_eta_marks() returns trigger language plpgsql as $$
        begin ${body}; return new; end $$`),
    );
    await tx.execute(
      sql.raw(`create trigger refuse_eta_marks before insert on eta_marks
        for each row execute function pg_temp.refuse_eta_marks()`),
    );
  }

  it('catches a failed insert, warns once, and leaves the rest of the poll written', async () => {
    const logger = quiet();
    const seen = await rolledBack(async (tx) => {
      const lane = await laneAt(tx, 205);
      await breakInserts(tx);
      const result = await runEtaLog(tx, logger);
      // The poll's own writes, made before the log, are still there.
      const fixes = await tx.select().from(positions).where(eq(positions.truckId, lane.truck.id));
      return { result, fixes: fixes.length, rows: (await marksFor(tx, lane.stopId)).length };
    });

    expect(seen.result).toEqual({ considered: 0, firstSeen: 0, marks: 0 });
    expect(seen.fixes).toBe(1);
    expect(seen.rows).toBe(0);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [message, fields] = logger.warn.mock.calls[0]!;
    expect(message).toBe('eta mark log failed');
    expect(String((fields as { error: string }).error)).toContain('eta_marks insert refused');
  });

  it('rolls back the whole batch: one bad row leaves none of its poll behind', async () => {
    const rows = await rolledBack(async (tx) => {
      const near = await laneAt(tx, 60);
      const far = await laneAt(tx, 205);
      await logEtaMarks(tx);
      await moveTo(tx, near.truck.id, 40);
      await moveTo(tx, far.truck.id, 150);
      // Refuse only the 50-mile row; the 200 and 100 rows share its statement.
      await breakInserts(
        tx,
        `if new.mark_miles = 50 then raise exception 'eta_marks insert refused (test)'; end if`,
      );
      await runEtaLog(tx, quiet());
      const afterFailure = [
        ...(await marksFor(tx, near.stopId)),
        ...(await marksFor(tx, far.stopId)),
      ].map((r) => r.markMiles);
      // The next poll, once the fault is gone, records them — nothing was lost for good.
      await tx.execute(sql`drop trigger refuse_eta_marks on eta_marks`);
      await runEtaLog(tx, quiet());
      const afterRecovery = [
        ...(await marksFor(tx, near.stopId)),
        ...(await marksFor(tx, far.stopId)),
      ].map((r) => r.markMiles);
      return { afterFailure, afterRecovery };
    });

    expect(rows.afterFailure).toEqual([null, null]);
    // 150 mi has crossed 200 and not yet 100.
    expect(rows.afterRecovery).toEqual([null, 50, null, 200]);
  });

  it('gives up within its own timeout rather than holding the poll', async () => {
    const logger = quiet();
    const elapsed = await rolledBack(async (tx) => {
      await laneAt(tx, 205);
      await breakInserts(tx, 'perform pg_sleep(30)');
      const started = Date.now();
      await runEtaLog(tx, logger);
      return Date.now() - started;
    });
    expect(elapsed).toBeLessThan(6_000);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  }, 15_000);
});

describeDb('settling the log, before the prune', () => {
  it('fills in the arrival and the minutes stopped after each prediction', async () => {
    const rows = await rolledBack(async (tx) => {
      const lane = await laneAt(tx, 60);
      await logEtaMarks(tx);
      const t0 = Date.now() - 50_000;
      // Cross 50 at t0 + 1s, then a 30-minute stop, then on to the stop.
      await makePosition(tx, lane.truck.id, { ...south(45), speedMph: 60, recordedAt: new Date(t0 + 1_000) });
      await logEtaMarks(tx);
      const at = (min: number) => new Date(t0 + 1_000 + min * 60_000);
      await makePosition(tx, lane.truck.id, { ...south(35), speedMph: 0, recordedAt: at(10) });
      await makePosition(tx, lane.truck.id, { ...south(35), speedMph: 0, recordedAt: at(40) });
      await makePosition(tx, lane.truck.id, { ...south(34), speedMph: 60, recordedAt: at(41) });
      await makePosition(tx, lane.truck.id, { ...south(1), speedMph: 60, recordedAt: at(74) });
      await tx
        .update(stops)
        .set({ arrivedAt: at(75), arrivedSource: 'detected' })
        .where(eq(stops.id, lane.stopId));
      const result = await settleEtaMarks(tx);
      return { result, rows: await marksFor(tx, lane.stopId), arrived: at(75) };
    });

    expect(rows.result.arrived).toBe(1);
    const at50 = rows.rows.find((r) => r.markMiles === 50)!;
    expect(at50.settleOutcome).toBe('arrived');
    expect(at50.arrivedAt?.getTime()).toBe(rows.arrived.getTime());
    expect(at50.arrivedSource).toBe('detected');
    expect(at50.stoppedMinutes).toBeCloseTo(30, 5);
  });

  it('never gives an old destination the new one’s arrival, after an edit mid-trip', async () => {
    const out = await rolledBack(async (tx) => {
      const lane = await laneAt(tx, 60);
      await logEtaMarks(tx);
      await moveTo(tx, lane.truck.id, 45);
      await logEtaMarks(tx); // old point: first seen, 50
      const oldKey = (await marksFor(tx, lane.stopId))[0]!.destKey;
      // The dispatcher points the stop somewhere new (§12.97's "next trip").
      const moved = { lat: STOP.lat + 0.5, lng: STOP.lng };
      await tx.update(stops).set(moved).where(eq(stops.id, lane.stopId));
      await logEtaMarks(tx); // new point: first seen
      await tx
        .update(stops)
        .set({ arrivedAt: new Date(), arrivedSource: 'detected' })
        .where(eq(stops.id, lane.stopId));
      const result = await settleEtaMarks(tx);
      return { result, rows: await marksFor(tx, lane.stopId), oldKey };
    });

    const old = out.rows.filter((r) => r.destKey === out.oldKey);
    const fresh = out.rows.filter((r) => r.destKey !== out.oldKey);
    expect(old.map((r) => r.markMiles)).toEqual([null, 50]);
    expect(fresh.map((r) => r.markMiles)).toEqual([null]);
    for (const r of old) {
      expect(r.settleOutcome).toBe('destination-changed');
      expect(r.arrivedAt).toBeNull();
    }
    expect(fresh[0]!.settleOutcome).toBe('arrived');
    expect(fresh[0]!.arrivedAt).not.toBeNull();
    expect(out.result).toMatchObject({ arrived: 1, destinationChanged: 1 });
  });

  it('settles a point re-spelled as a different float as the same destination', async () => {
    const rows = await rolledBack(async (tx) => {
      const lane = await laneAt(tx, 60);
      await logEtaMarks(tx);
      await tx
        .update(stops)
        .set({ lat: STOP.lat + 1e-12, arrivedAt: new Date(), arrivedSource: 'detected' })
        .where(eq(stops.id, lane.stopId));
      await settleEtaMarks(tx);
      return marksFor(tx, lane.stopId);
    });
    expect(rows[0]!.settleOutcome).toBe('arrived');
  });

  it('closes out a load that ended without an arrival, and leaves an open one alone', async () => {
    const rows = await rolledBack(async (tx) => {
      const closed = await laneAt(tx, 60);
      const open = await laneAt(tx, 70);
      await logEtaMarks(tx);
      await tx.update(loads).set({ status: 'DELIVERED' }).where(eq(loads.id, closed.loadId));
      await settleEtaMarks(tx);
      return {
        closed: await marksFor(tx, closed.stopId),
        open: await marksFor(tx, open.stopId),
      };
    });
    expect(rows.closed[0]!.settleOutcome).toBe('closed-without-arrival');
    expect(rows.open[0]!.settledAt).toBeNull();
  });

  it('never throws from the hourly wrapper, so the prune after it still runs', async () => {
    const logger = quiet();
    const out = await rolledBack(async (tx) => {
      await laneAt(tx, 60);
      await logEtaMarks(tx);
      await tx.execute(sql`alter table eta_marks add constraint refuse_settle check (settled_at is null)`);
      await tx.update(loads).set({ status: 'DELIVERED' });
      return runEtaSettle(tx, logger);
    });
    expect(out).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('eta mark settle failed', expect.any(Object));
  });
});
