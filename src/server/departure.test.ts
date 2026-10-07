import { expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { auditLog, loads, stops } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import { makeTruck } from '@/test/fleet';
import { localDateOf, springForward, YEAR } from '@/test/dst';
import { STATUS_DEFAULTS } from '@/lib/status';
import { LoadEdit, type LoadEditInput } from '@/lib/load-edit';
import type { Tx } from './audit';
import { LATEST_POSITION_SQL, applyStatus, parseFleetRows } from './fleet-query';
import { readLoadVersion } from './load-version';
import { AtStopError, saveLoadEdit, StopEditError } from './stop-edit';

/**
 * §12.118. The departure a dispatcher marks: the rules it is held to, what it
 * does to the board, and what it never does to a record the worker made.
 */

const TZ = 'America/Chicago';
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

/** An instant as the modal sends it: a wall time at the stop, and the zone. */
function wall(instant: Date) {
  const [h, min] = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(instant)
    .split(':')
    .map(Number);
  return { date: localDateOf(TZ, instant), time: { h: h!, min: min! }, tz: TZ };
}

interface Leg {
  city: string;
  arrived?: 'detected' | 'dispatcher';
  departed?: 'detected' | 'dispatcher';
}

async function loadWith(tx: Tx, legs: Leg[]) {
  const truck = await makeTruck(tx);
  const [load] = await tx
    .insert(loads)
    .values({ truckId: truck.id, loadNumber: 'VT-DEP', status: 'DISPATCHED' })
    .returning({ id: loads.id });
  const ids: string[] = [];
  for (const [i, leg] of legs.entries()) {
    const [row] = await tx
      .insert(stops)
      .values({
        loadId: load!.id,
        type: i === 0 ? 'PU' : 'DEL',
        sequence: i + 1,
        city: leg.city,
        state: 'IL',
        ...(leg.arrived ? { arrivedAt: minutesAgo(90), arrivedSource: leg.arrived } : {}),
        ...(leg.departed ? { departedAt: minutesAgo(60), departedSource: leg.departed } : {}),
      })
      .returning({ id: stops.id });
    ids.push(row!.id);
  }
  return { truckId: truck.id, loadId: load!.id, stopIds: ids };
}

async function draftOf(tx: Tx, stopId: string, over: Record<string, unknown> = {}) {
  const [s] = await tx.select().from(stops).where(eq(stops.id, stopId));
  return {
    stopId,
    stopType: s!.type,
    addressLine: s!.addressLine,
    city: s!.city,
    state: s!.state,
    zip: s!.zip,
    appointment: null,
    ...over,
  };
}

async function save(tx: Tx, lane: { truckId: string; loadId: string }, stopsIn: unknown[]) {
  const input: LoadEditInput = {
    loadId: lane.loadId,
    truckId: lane.truckId,
    version: (await readLoadVersion(tx, lane.loadId))!,
    loadStatus: 'DISPATCHED',
    stops: stopsIn as LoadEditInput['stops'],
  };
  return saveLoadEdit(tx as never, { actorUserId: null, dispatchTz: TZ, edit: LoadEdit.parse(input) });
}

const attempt = (...args: Parameters<typeof save>) =>
  save(...args).then(
    () => null,
    (error: unknown) => error,
  );

async function departureOf(tx: Tx, stopId: string) {
  const [row] = await tx
    .select({
      arrivedAt: stops.arrivedAt,
      departedAt: stops.departedAt,
      departedSource: stops.departedSource,
    })
    .from(stops)
    .where(eq(stops.id, stopId));
  return row!;
}

async function boardFor(tx: Tx, truckId: string) {
  const rows = applyStatus(parseFleetRows(await tx.execute(LATEST_POSITION_SQL)), { ...STATUS_DEFAULTS, dispatchTz: TZ }, new Date());
  return rows.find((r) => r.id === truckId)!;
}

describeDb('a hand departure moves the board on (§12.118)', () => {
  it('on a two-stop load, the delivery becomes the next stop', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await loadWith(tx, [{ city: 'Melrose Park', arrived: 'detected' }, { city: 'Joliet' }]);
      const before = await boardFor(tx, lane.truckId);
      await save(tx, lane, [await draftOf(tx, lane.stopIds[0]!, { departedAt: wall(minutesAgo(10)) })]);
      const [audit] = await tx
        .select({ after: auditLog.after })
        .from(auditLog)
        .where(and(eq(auditLog.entityId, lane.stopIds[0]!), sql`${auditLog.after} ? 'departedAt'`));
      return {
        lane,
        before: before.nextStop?.stopId,
        after: (await boardFor(tx, lane.truckId)).nextStop?.stopId,
        stop: await departureOf(tx, lane.stopIds[0]!),
        audit: audit?.after as Record<string, unknown>,
      };
    });

    expect(seen.before).toBe(seen.lane.stopIds[0]);
    expect(seen.after).toBe(seen.lane.stopIds[1]);
    expect(seen.stop.departedSource).toBe('dispatcher');
    expect(seen.audit).toMatchObject({ departedSource: 'dispatcher', source: 'edit-modal' });
  });

  it('on a one-stop load, arrival and departure in one save leave no next stop', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await loadWith(tx, [{ city: 'Joliet' }]);
      await save(tx, lane, [
        await draftOf(tx, lane.stopIds[0]!, {
          arrivedAt: wall(minutesAgo(40)),
          departedAt: wall(minutesAgo(15)),
        }),
      ]);
      return { board: await boardFor(tx, lane.truckId), stop: await departureOf(tx, lane.stopIds[0]!) };
    });

    expect(seen.board.nextStop).toBeNull();
    // The load is still open: Clear stop closes it, as after a detected departure.
    expect(seen.board.openLoadCount).toBe(1);
    expect(seen.stop.departedSource).toBe('dispatcher');
  });
});

describeDb('what a hand departure is held to (§12.118)', () => {
  it('needs the arrival it leaves from', async () => {
    const error = await rolledBack(async (tx) => {
      const lane = await loadWith(tx, [{ city: 'Joliet' }]);
      return attempt(tx, lane, [await draftOf(tx, lane.stopIds[0]!, { departedAt: wall(minutesAgo(5)) })]);
    });
    expect(error).toBeInstanceOf(AtStopError);
    expect((error as AtStopError).field).toBe('stops.0.departedAt.time');
    expect((error as AtStopError).message).toMatch(/Mark the arrival first/);
  });

  it('is never before the arrival, nor in the future', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await loadWith(tx, [{ city: 'Joliet', arrived: 'detected' }]);
      const early = await attempt(tx, lane, [
        await draftOf(tx, lane.stopIds[0]!, { departedAt: wall(minutesAgo(120)) }),
      ]);
      const future = await attempt(tx, lane, [
        await draftOf(tx, lane.stopIds[0]!, { departedAt: wall(new Date(Date.now() + 30 * 60_000)) }),
      ]);
      return { early, future, stop: await departureOf(tx, lane.stopIds[0]!) };
    });
    expect((seen.early as AtStopError).message).toMatch(/before the truck arrived/);
    expect((seen.future as AtStopError).message).toMatch(/in the future/);
    expect(seen.stop.departedAt).toBeNull();
  });

  it('refuses the hour the clocks skip, on its own field', async () => {
    const error = await rolledBack(async (tx) => {
      const lane = await loadWith(tx, [{ city: 'Joliet', arrived: 'detected' }]);
      const change = springForward(TZ, YEAR);
      const before = Number(
        new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(
          new Date(change.getTime() - 60_000),
        ),
      );
      return attempt(tx, lane, [
        await draftOf(tx, lane.stopIds[0]!, {
          departedAt: { date: localDateOf(TZ, change), time: { h: before + 1, min: 30 }, tz: TZ },
        }),
      ]);
    });
    expect((error as AtStopError).field).toBe('stops.0.departedAt.time');
  });

  it('goes with the arrival: unticking the arrival clears the departure and its source', async () => {
    const stop = await rolledBack(async (tx) => {
      const lane = await loadWith(tx, [{ city: 'Joliet', arrived: 'dispatcher', departed: 'dispatcher' }]);
      await save(tx, lane, [await draftOf(tx, lane.stopIds[0]!, { arrivedAt: null })]);
      return departureOf(tx, lane.stopIds[0]!);
    });
    expect(stop).toEqual({ arrivedAt: null, departedAt: null, departedSource: null });
  });

  it('leaves a detected departure detected when an unrelated save re-sends it', async () => {
    const stop = await rolledBack(async (tx) => {
      const lane = await loadWith(tx, [{ city: 'Joliet', arrived: 'detected', departed: 'detected' }]);
      const [row] = await tx.select({ at: stops.departedAt }).from(stops).where(eq(stops.id, lane.stopIds[0]!));
      // The same minute, as the control returns it, with a note beside it.
      await save(tx, lane, [
        await draftOf(tx, lane.stopIds[0]!, { departedAt: wall(row!.at!), dispatcherNote: 'call first' }),
      ]);
      return departureOf(tx, lane.stopIds[0]!);
    });
    expect(stop.departedSource).toBe('detected');
  });

  it('moves the load version; a detected departure does not', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await loadWith(tx, [{ city: 'A', arrived: 'detected' }, { city: 'B', arrived: 'detected' }]);
      const v0 = await readLoadVersion(tx, lane.loadId);
      await tx
        .update(stops)
        .set({ departedAt: minutesAgo(30), departedSource: 'detected' })
        .where(eq(stops.id, lane.stopIds[0]!));
      const v1 = await readLoadVersion(tx, lane.loadId);
      await tx
        .update(stops)
        .set({ departedAt: minutesAgo(20), departedSource: 'dispatcher' })
        .where(eq(stops.id, lane.stopIds[1]!));
      return { v0, v1, v2: await readLoadVersion(tx, lane.loadId) };
    });
    expect(seen.v1).toBe(seen.v0);
    expect(seen.v2).not.toBe(seen.v1);
  });
});

describeDb('a stop the truck has left keeps its record (§12.116 D4)', () => {
  it('refuses a new address, type or appointment, and still takes a note', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await loadWith(tx, [{ city: 'A', arrived: 'detected', departed: 'detected' }, { city: 'B' }]);
      const moved = await attempt(tx, lane, [await draftOf(tx, lane.stopIds[0]!, { city: 'Somewhere Else' })]);
      const retyped = await attempt(tx, lane, [await draftOf(tx, lane.stopIds[0]!, { stopType: 'DEL' })]);
      const noted = await attempt(tx, lane, [await draftOf(tx, lane.stopIds[0]!, { dispatcherNote: 'sealed' })]);
      const [row] = await tx.select({ city: stops.city, note: stops.dispatcherNote }).from(stops).where(eq(stops.id, lane.stopIds[0]!));
      return { moved, retyped, noted, row: row! };
    });
    for (const error of [seen.moved, seen.retyped]) {
      expect(error).toBeInstanceOf(AtStopError);
      expect(((error as AtStopError).error as StopEditError).message).toMatch(/has left this stop/);
    }
    expect(seen.noted).toBeNull();
    expect(seen.row).toEqual({ city: 'A', note: 'sealed' });
  });
});
