import { expect, it } from 'vitest';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { assignments, auditLog, loads, overrides, stops, trucks } from '@/db/schema';
import { commitDb, describeDb, rolledBack } from '@/test/db';
import { assign, makeDriver, makeTruck } from '@/test/fleet';
import { localDateOf, springForward, YEAR } from '@/test/dst';
import { AppointmentTimeError } from '@/lib/appointment';
import { LoadEdit, type LoadEditInput } from '@/lib/load-edit';
import type { Tx } from './audit';
import { LATEST_POSITION_SQL, parseFleetRows } from './fleet-query';
import { loadForEdit } from './load-read';
import { readLoadVersion } from './load-version';
import { applyReassignment, previewReassignment } from './reassign';
import { recentlyClosed, reopenLoad } from './reopen-load';
import {
  AtStopError,
  clearOverrideAt,
  ReachedStopError,
  saveLoadEdit,
  StaleLoadError,
  StopEditError,
  STALE_LOAD_MESSAGE,
} from './stop-edit';

/**
 * §12.117. The load-shaped save against the real database, always rolled
 * back: several stops in one transaction, the version check, removals and
 * renumbering, and a close Reopen can still read.
 *
 * No address in these fixtures is geocoded: the stops are written with an
 * address the save sees as unchanged, or with none (`empty-address`, which
 * never calls out). The geocoder has its own suite.
 */

const TZ = 'America/Chicago';
const DISPATCH = { dispatchTz: TZ, actorUserId: null };
const at = (hours: number) => new Date(Date.now() + hours * 3_600_000);

const forced = {
  action: 'set' as const,
  forcedStatus: 'LATE' as const,
  reason: 'DRIVER_REPORTED_DELAY' as const,
  reasonNote: null,
  expiry: 'PLUS_4H' as const,
  customExpiry: null,
};

interface Leg {
  city: string;
  arrived?: boolean;
  departed?: boolean;
  hoursAhead?: number;
}

/** A truck with a driver, holding one open load with these stops, in order. */
async function loadWith(tx: Tx, legs: Leg[]) {
  const truck = await makeTruck(tx);
  const driver = await makeDriver(tx);
  await assign(tx, truck.id, driver.id);
  const [load] = await tx
    .insert(loads)
    .values({ truckId: truck.id, loadNumber: 'VT-MULTI', status: 'DISPATCHED' })
    .returning({ id: loads.id });
  const stopIds: string[] = [];
  for (const [i, leg] of legs.entries()) {
    const reached = leg.arrived || leg.departed;
    const [row] = await tx
      .insert(stops)
      .values({
        loadId: load!.id,
        type: i === 0 ? 'PU' : 'DEL',
        sequence: i + 1,
        city: leg.city,
        state: 'IL',
        appointmentStartUtc: at(leg.hoursAhead ?? 4 + i * 6),
        appointmentTz: TZ,
        appointmentType: 'APPT',
        ...(reached ? { arrivedAt: at(-3), arrivedSource: 'detected' as const } : {}),
        ...(leg.departed ? { departedAt: at(-2), departedSource: 'detected' as const } : {}),
      })
      .returning({ id: stops.id });
    stopIds.push(row!.id);
  }
  return { truck, driver, loadId: load!.id, stopIds };
}

/** A stop as the modal would send it back, untouched unless overridden. */
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

const newStop = (city: string, over: Record<string, unknown> = {}) => ({
  stopId: null,
  stopType: 'DEL' as const,
  addressLine: null,
  city,
  state: 'IL',
  zip: null,
  appointment: null,
  ...over,
});

/**
 * The hour that does not exist at the facility, derived for this year:
 * the local date of the spring-forward, and the hour the clock skips.
 */
function skippedHour() {
  const change = springForward(TZ, YEAR);
  const date = localDateOf(TZ, change);
  const before = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(
      new Date(change.getTime() - 60_000),
    ),
  );
  return { type: 'APPT' as const, date, time: { h: before + 1, min: 30 }, tz: TZ, windowMinutes: null };
}

async function save(tx: Tx, input: LoadEditInput) {
  return saveLoadEdit(tx as never, { ...DISPATCH, edit: LoadEdit.parse(input) });
}

/** The save's outcome, or the error it threw. */
const attempt = (tx: Tx, input: LoadEditInput) =>
  save(tx, input).then(
    (result) => ({ result, error: null }),
    (error: unknown) => ({ result: null, error }),
  );

async function stopsOf(tx: Tx, loadId: string) {
  return tx
    .select({ id: stops.id, sequence: stops.sequence, city: stops.city })
    .from(stops)
    .where(eq(stops.loadId, loadId))
    .orderBy(asc(stops.sequence));
}

async function auditRows(tx: Tx) {
  const [row] = await tx.select({ n: count() }).from(auditLog);
  return row!.n;
}

async function openDriver(tx: Tx, truckId: string) {
  const [row] = await tx
    .select({ driverId: assignments.driverId })
    .from(assignments)
    .where(and(eq(assignments.truckId, truckId), isNull(assignments.endedAt)));
  return row?.driverId ?? null;
}

describeDb('one save writes several stops (§12.117)', () => {
  it('updates one stop and appends two, in order, with one audit row each under one saveId', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await loadWith(tx, [{ city: 'Melrose Park' }]);
      const version = await readLoadVersion(tx, lane.loadId);
      const result = await save(tx, {
        loadId: lane.loadId,
        truckId: lane.truck.id,
        version: version!,
        loadStatus: 'DISPATCHED',
        stops: [
          await draftOf(tx, lane.stopIds[0]!, { dispatcherNote: 'dock B' }),
          newStop('Joliet'),
          newStop('Fargo'),
        ],
      });
      const audit = await tx
        .select({ entityId: auditLog.entityId, after: auditLog.after })
        .from(auditLog)
        .where(eq(auditLog.entity, 'stop'));
      return { lane, result, rows: await stopsOf(tx, lane.loadId), audit };
    });

    expect(seen.rows.map((r) => [r.sequence, r.city])).toEqual([
      [1, 'Melrose Park'],
      [2, 'Joliet'],
      [3, 'Fargo'],
    ]);
    expect(seen.result.stops.map((s) => s.stopId)).toEqual(seen.rows.map((r) => r.id));
    expect(seen.audit).toHaveLength(3);
    const afters = seen.audit.map((a) => a.after as Record<string, unknown>);
    expect(new Set(afters.map((a) => a['saveId']))).toEqual(new Set([seen.result.saveId]));
    expect(afters.map((a) => a['sequence']).sort()).toEqual([1, 2, 3]);
    // The shape a single stop's save has always written (Reopen reads it).
    for (const after of afters) {
      expect(after).toMatchObject({ loadId: seen.lane.loadId, loadStatus: 'DISPATCHED', source: 'edit-modal' });
    }
  });

  it('renumbers after a removal, so the timeline never skips a number, and logs the removal', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await loadWith(tx, [{ city: 'A' }, { city: 'B' }, { city: 'C' }]);
      const version = await readLoadVersion(tx, lane.loadId);
      await save(tx, {
        loadId: lane.loadId,
        truckId: lane.truck.id,
        version: version!,
        loadStatus: 'DISPATCHED',
        stops: [await draftOf(tx, lane.stopIds[0]!)],
        removedStopIds: [lane.stopIds[1]!],
      });
      const [removal] = await tx
        .select({ after: auditLog.after, before: auditLog.before })
        .from(auditLog)
        .where(eq(auditLog.entityId, lane.stopIds[1]!));
      return { lane, rows: await stopsOf(tx, lane.loadId), removal };
    });

    expect(seen.rows.map((r) => [r.sequence, r.city])).toEqual([
      [1, 'A'],
      [2, 'C'],
    ]);
    expect(seen.removal?.after).toMatchObject({ removed: true, loadId: seen.lane.loadId });
    expect(seen.removal?.before).toMatchObject({ city: 'B', sequence: 2 });
  });

  it('refuses to remove a stop the truck reached — before the modal opened, or after — and writes nothing', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await loadWith(tx, [{ city: 'A', arrived: true }, { city: 'B' }, { city: 'C' }]);
      const version = await readLoadVersion(tx, lane.loadId);
      const removeArrived = await attempt(tx, {
        loadId: lane.loadId,
        truckId: lane.truck.id,
        version: version!,
        loadStatus: 'DISPATCHED',
        stops: [await draftOf(tx, lane.stopIds[1]!)],
        removedStopIds: [lane.stopIds[0]!],
      });

      // The worker reaches stop 2 while the modal is open. The version does
      // not move (§12.117), so the removal is refused by the rule, not the check.
      await tx
        .update(stops)
        .set({ arrivedAt: new Date(), arrivedSource: 'detected' })
        .where(eq(stops.id, lane.stopIds[1]!));
      const removeJustReached = await attempt(tx, {
        loadId: lane.loadId,
        truckId: lane.truck.id,
        version: version!,
        loadStatus: 'DISPATCHED',
        stops: [await draftOf(tx, lane.stopIds[2]!)],
        removedStopIds: [lane.stopIds[1]!],
      });
      return {
        removeArrived,
        removeJustReached,
        rows: await stopsOf(tx, lane.loadId),
        audit: await auditRows(tx),
      };
    });

    for (const outcome of [seen.removeArrived, seen.removeJustReached]) {
      expect(outcome.error).toBeInstanceOf(StopEditError);
      expect((outcome.error as StopEditError).message).toMatch(/reached this stop/);
    }
    expect(seen.rows).toHaveLength(3);
    expect(seen.audit).toBe(0);
  });

  it('removes a middle stop and appends one in the same save, numbered 1, 2, 3 again', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await loadWith(tx, [{ city: 'A' }, { city: 'B' }, { city: 'C' }]);
      const version = await readLoadVersion(tx, lane.loadId);
      await save(tx, {
        loadId: lane.loadId,
        truckId: lane.truck.id,
        version: version!,
        loadStatus: 'DISPATCHED',
        stops: [await draftOf(tx, lane.stopIds[0]!), newStop('D')],
        removedStopIds: [lane.stopIds[1]!],
      });
      return stopsOf(tx, lane.loadId);
    });

    expect(seen.map((r) => [r.sequence, r.city])).toEqual([
      [1, 'A'],
      [2, 'C'],
      [3, 'D'],
    ]);
  });

  /**
   * At least one stop holds by construction: a save names at least one stop,
   * and a stop it names cannot also be removed (the schema refuses that). So
   * the only way to remove every stored stop is while adding another.
   */
  it('keeps a load at one stop or more, and at ten or fewer', async () => {
    const seen = await rolledBack(async (tx) => {
      const two = await loadWith(tx, [{ city: 'A' }, { city: 'B' }]);
      const namedAndRemoved = LoadEdit.safeParse({
        loadId: two.loadId,
        truckId: two.truck.id,
        version: '0'.repeat(32),
        loadStatus: 'DISPATCHED',
        stops: [await draftOf(tx, two.stopIds[0]!)],
        removedStopIds: two.stopIds,
      });
      const v2 = await readLoadVersion(tx, two.loadId);
      const replaced = await attempt(tx, {
        loadId: two.loadId,
        truckId: two.truck.id,
        version: v2!,
        loadStatus: 'DISPATCHED',
        stops: [newStop('C')],
        removedStopIds: two.stopIds,
      });

      const nine = await loadWith(
        tx,
        Array.from({ length: 9 }, (_, i) => ({ city: `S${i + 1}` })),
      );
      const v9 = await readLoadVersion(tx, nine.loadId);
      const eleven = await attempt(tx, {
        loadId: nine.loadId,
        truckId: nine.truck.id,
        version: v9!,
        loadStatus: 'DISPATCHED',
        stops: [newStop('S10'), newStop('S11')],
      });
      return {
        namedAndRemoved,
        replaced,
        two: await stopsOf(tx, two.loadId),
        eleven,
        nine: await stopsOf(tx, nine.loadId),
      };
    });

    expect(seen.namedAndRemoved.success).toBe(false);
    expect(seen.replaced.error).toBeNull();
    expect(seen.two.map((r) => [r.sequence, r.city])).toEqual([[1, 'C']]);
    expect((seen.eleven.error as StopEditError).message).toMatch(/at most 10 stops/);
    expect(seen.nine).toHaveLength(9);
  });

  it('sets an override only on the truck’s next stop (§12.116 D2)', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await loadWith(tx, [{ city: 'A' }, { city: 'B' }]);
      const version = await readLoadVersion(tx, lane.loadId);
      const onSecond = await attempt(tx, {
        loadId: lane.loadId,
        truckId: lane.truck.id,
        version: version!,
        loadStatus: 'DISPATCHED',
        stops: [await draftOf(tx, lane.stopIds[1]!, { override: forced })],
      });
      const onFirst = await attempt(tx, {
        loadId: lane.loadId,
        truckId: lane.truck.id,
        version: version!,
        loadStatus: 'DISPATCHED',
        stops: [await draftOf(tx, lane.stopIds[0]!, { override: forced })],
      });
      const live = await tx
        .select({ stopId: overrides.stopId })
        .from(overrides)
        .where(isNull(overrides.clearedAt));
      return { lane, onSecond, onFirst, live };
    });

    expect(seen.onSecond.error).toBeInstanceOf(AtStopError);
    expect((seen.onSecond.error as AtStopError).message).toMatch(/next stop/);
    expect(seen.onFirst.error).toBeNull();
    expect(seen.live.map((o) => o.stopId)).toEqual([seen.lane.stopIds[0]]);
  });

  it('refuses an arrival at stop 2 while stop 1 has not been left (§12.116 D5)', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await loadWith(tx, [{ city: 'A', arrived: true }, { city: 'B' }]);
      const version = await readLoadVersion(tx, lane.loadId);
      const now = localDateOf(TZ, new Date());
      const hm = new Intl.DateTimeFormat('en-GB', {
        timeZone: TZ,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .format(new Date(Date.now() - 10 * 60_000))
        .split(':')
        .map(Number);
      const outcome = await attempt(tx, {
        loadId: lane.loadId,
        truckId: lane.truck.id,
        version: version!,
        loadStatus: 'DISPATCHED',
        stops: [
          await draftOf(tx, lane.stopIds[1]!, {
            arrivedAt: { date: now, time: { h: hm[0]!, min: hm[1]! }, tz: TZ },
          }),
        ],
      });
      const [second] = await tx.select({ arrivedAt: stops.arrivedAt }).from(stops).where(eq(stops.id, lane.stopIds[1]!));
      return { outcome, second };
    });

    expect(seen.outcome.error).toBeInstanceOf(AtStopError);
    expect((seen.outcome.error as AtStopError).field).toBe('stops.0.arrivedAt.time');
    expect((seen.outcome.error as AtStopError).message).toMatch(/Stop 1 hasn't been left yet/);
    expect(seen.second?.arrivedAt).toBeNull();
  });

  /** A wall time `minutesAgo` before now, at the stops' zone. */
  const wallAgo = (minutesAgo: number) => {
    const instant = new Date(Date.now() - minutesAgo * 60_000);
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
  };

  it('counts a departure marked on stop 1 in the same save (§12.119)', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await loadWith(tx, [{ city: 'A', arrived: true }, { city: 'B' }]);
      const version = await readLoadVersion(tx, lane.loadId);
      const outcome = await attempt(tx, {
        loadId: lane.loadId,
        truckId: lane.truck.id,
        version: version!,
        loadStatus: 'DISPATCHED',
        stops: [
          await draftOf(tx, lane.stopIds[0]!, { departedAt: wallAgo(20) }),
          await draftOf(tx, lane.stopIds[1]!, { arrivedAt: wallAgo(10) }),
        ],
      });
      const rows = await tx
        .select({ departed: stops.departedSource, arrived: stops.arrivedSource })
        .from(stops)
        .where(eq(stops.loadId, lane.loadId))
        .orderBy(asc(stops.sequence));
      return { outcome, rows };
    });

    expect(seen.outcome.error).toBeNull();
    expect(seen.rows).toEqual([
      { departed: 'dispatcher', arrived: 'detected' },
      { departed: null, arrived: 'dispatcher' },
    ]);
  });

  it('and not a departure cleared on stop 1 in the same save (§12.119)', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await loadWith(tx, [{ city: 'A', departed: true }, { city: 'B' }]);
      // `draftOf` sends no appointment, and a stop the truck left keeps its
      // own (D4): give stop 1 none, so the only question is D5.
      await tx
        .update(stops)
        .set({ appointmentStartUtc: null, appointmentEndUtc: null, appointmentTz: null })
        .where(eq(stops.id, lane.stopIds[0]!));
      const version = await readLoadVersion(tx, lane.loadId);
      const outcome = await attempt(tx, {
        loadId: lane.loadId,
        truckId: lane.truck.id,
        version: version!,
        loadStatus: 'DISPATCHED',
        stops: [
          await draftOf(tx, lane.stopIds[0]!, { departedAt: null }),
          await draftOf(tx, lane.stopIds[1]!, { arrivedAt: wallAgo(10) }),
        ],
      });
      const rows = await tx
        .select({ departedAt: stops.departedAt, arrivedAt: stops.arrivedAt })
        .from(stops)
        .where(eq(stops.loadId, lane.loadId))
        .orderBy(asc(stops.sequence));
      return { outcome, rows };
    });

    expect(seen.outcome.error).toBeInstanceOf(AtStopError);
    expect((seen.outcome.error as AtStopError).field).toBe('stops.1.arrivedAt.time');
    expect((seen.outcome.error as AtStopError).message).toMatch(/Stop 1 hasn't been left yet/);
    // The whole save rolled back: stop 1 is still left, stop 2 not reached.
    expect(seen.rows[0]!.departedAt).not.toBeNull();
    expect(seen.rows[1]!.arrivedAt).toBeNull();
  });

  it('offers the next trip only once every stop is reached (§12.116 D3)', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await loadWith(tx, [{ city: 'A', arrived: true }, { city: 'B' }]);
      const version = await readLoadVersion(tx, lane.loadId);
      const nextTrip = await attempt(tx, {
        loadId: lane.loadId,
        truckId: lane.truck.id,
        version: version!,
        loadStatus: 'DISPATCHED',
        reachedStop: 'next-trip',
        stops: [await draftOf(tx, lane.stopIds[0]!, { city: 'Somewhere Else' })],
      });
      const [load] = await tx.select({ status: loads.status }).from(loads).where(eq(loads.id, lane.loadId));
      return { nextTrip, status: load!.status };
    });

    expect((seen.nextTrip.error as StopEditError).message).toMatch(/every stop on this load has been reached/);
    expect(seen.status).toBe('DISPATCHED');
  });

  it('asks the reached-stop question for a load number change when any stop was reached', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await loadWith(tx, [{ city: 'A', departed: true }, { city: 'B' }]);
      const version = await readLoadVersion(tx, lane.loadId);
      const outcome = await attempt(tx, {
        loadId: lane.loadId,
        truckId: lane.truck.id,
        version: version!,
        loadNumber: 'NEW-1',
        loadStatus: 'DISPATCHED',
        stops: [await draftOf(tx, lane.stopIds[1]!)],
      });
      return { outcome, reachedStopId: lane.stopIds[0]! };
    });
    expect(seen.outcome.error).toBeInstanceOf(ReachedStopError);
    // §12.119. The reached stop is stop 1, which this save does not send.
    const error = seen.outcome.error as ReachedStopError;
    expect(error.stopId).toBe(seen.reachedStopId);
    expect(error.stopIndex).toBeNull();
  });

  it('names the reached stop it asks about, and its place in the request (§12.119)', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await loadWith(tx, [{ city: 'A', departed: true }, { city: 'B', arrived: true }]);
      const version = await readLoadVersion(tx, lane.loadId);
      const [arrived] = await tx
        .select({ arrivedAt: stops.arrivedAt })
        .from(stops)
        .where(eq(stops.id, lane.stopIds[1]!));
      const outcome = await attempt(tx, {
        loadId: lane.loadId,
        truckId: lane.truck.id,
        version: version!,
        loadStatus: 'DISPATCHED',
        stops: [
          await draftOf(tx, lane.stopIds[0]!),
          await draftOf(tx, lane.stopIds[1]!, { city: 'Somewhere Else' }),
        ],
      });
      return { outcome, stopId: lane.stopIds[1]!, arrivedAt: arrived!.arrivedAt!.toISOString() };
    });
    expect(seen.outcome.error).toBeInstanceOf(ReachedStopError);
    const error = seen.outcome.error as ReachedStopError;
    expect(error.stopId).toBe(seen.stopId);
    expect(error.stopIndex).toBe(1);
    expect(error.arrivedAt).toBe(seen.arrivedAt);
  });
});

describeDb('the version check (§12.117)', () => {
  it('refuses a save over a load someone else changed, and writes nothing', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await loadWith(tx, [{ city: 'A' }]);
      const opened = await readLoadVersion(tx, lane.loadId);
      // Another dispatcher saves a new load number first.
      await save(tx, {
        loadId: lane.loadId,
        truckId: lane.truck.id,
        version: opened!,
        loadNumber: 'THEIRS',
        loadStatus: 'DISPATCHED',
        stops: [await draftOf(tx, lane.stopIds[0]!)],
      });
      const auditBefore = await auditRows(tx);
      const mine = await attempt(tx, {
        loadId: lane.loadId,
        truckId: lane.truck.id,
        version: opened!,
        loadNumber: 'MINE',
        loadStatus: 'DISPATCHED',
        stops: [await draftOf(tx, lane.stopIds[0]!, { dispatcherNote: 'mine' })],
      });
      const [load] = await tx.select({ n: loads.loadNumber }).from(loads).where(eq(loads.id, lane.loadId));
      const [stop] = await tx.select({ note: stops.dispatcherNote }).from(stops).where(eq(stops.id, lane.stopIds[0]!));
      return { mine, number: load!.n, note: stop!.note, auditGrew: (await auditRows(tx)) - auditBefore };
    });

    expect(seen.mine.error).toBeInstanceOf(StaleLoadError);
    expect((seen.mine.error as StaleLoadError).message).toBe(
      'This load was changed since you opened it. Nothing was saved.',
    );
    expect(STALE_LOAD_MESSAGE).toBe('This load was changed since you opened it. Nothing was saved.');
    expect(seen.number).toBe('THEIRS');
    expect(seen.note).toBeNull();
    expect(seen.auditGrew).toBe(0);
  });

  it('is not refused by a worker arrival or departure alone', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await loadWith(tx, [{ city: 'A' }, { city: 'B' }]);
      const opened = await readLoadVersion(tx, lane.loadId);
      // The sweep's own writes: detected arrival, then departure.
      await tx
        .update(stops)
        .set({ arrivedAt: at(-1), arrivedSource: 'detected', departedAt: at(-0.5), departedSource: 'detected' })
        .where(eq(stops.id, lane.stopIds[0]!));
      const after = await readLoadVersion(tx, lane.loadId);
      const saved = await attempt(tx, {
        loadId: lane.loadId,
        truckId: lane.truck.id,
        version: opened!,
        loadStatus: 'LOADED',
        stops: [await draftOf(tx, lane.stopIds[1]!, { dispatcherNote: 'call first' })],
      });
      return { opened, after, saved };
    });

    expect(seen.after).toBe(seen.opened);
    expect(seen.saved.error).toBeNull();
  });

  it('is refused by a reassignment made elsewhere, and that reassignment stands', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await loadWith(tx, [{ city: 'A' }]);
      const opened = await readLoadVersion(tx, lane.loadId);
      // On the assignment board, someone puts another driver on this truck.
      const other = await makeDriver(tx);
      const preview = await previewReassignment(tx, { truckId: lane.truck.id, driverId: other.id });
      await applyReassignment(tx, {
        truckId: lane.truck.id,
        driverId: other.id,
        actorUserId: null,
        previewToken: preview.token,
      });
      // The modal, opened before that, re-sends the driver it showed.
      const mine = await attempt(tx, {
        loadId: lane.loadId,
        truckId: lane.truck.id,
        version: opened!,
        driverId: lane.driver.id,
        loadStatus: 'DISPATCHED',
        stops: [await draftOf(tx, lane.stopIds[0]!)],
      });
      return { mine, driver: await openDriver(tx, lane.truck.id), other: other.id };
    });

    expect(seen.mine.error).toBeInstanceOf(StaleLoadError);
    expect(seen.driver).toBe(seen.other);
  });

  it('is the same version from the fleet row, the load read and the save’s own check', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await loadWith(tx, [{ city: 'A' }, { city: 'B' }]);
      const row = parseFleetRows(await tx.execute(LATEST_POSITION_SQL)).find(
        (r) => r.id === lane.truck.id,
      );
      const read = await loadForEdit(tx, lane.loadId);
      return { row: row?.nextStop?.loadVersion, read, direct: await readLoadVersion(tx, lane.loadId), lane };
    });

    expect(seen.row).toMatch(/^[0-9a-f]{32}$/);
    expect(seen.read?.version).toBe(seen.row);
    expect(seen.direct).toBe(seen.row);
    expect(seen.read?.stops.map((s) => s.stopId)).toEqual(seen.lane.stopIds);
    expect(seen.read?.assignment?.driverId).toBe(seen.lane.driver.id);
  });

  it('lets the modal’s own Clear now move its version, and refuses it on a changed load', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await loadWith(tx, [{ city: 'A' }]);
      const v0 = await readLoadVersion(tx, lane.loadId);
      await save(tx, {
        loadId: lane.loadId,
        truckId: lane.truck.id,
        version: v0!,
        loadStatus: 'DISPATCHED',
        stops: [await draftOf(tx, lane.stopIds[0]!, { override: forced })],
      });
      const v1 = await readLoadVersion(tx, lane.loadId);
      const stale = await clearOverrideAt(tx as never, {
        actorUserId: null,
        stopId: lane.stopIds[0]!,
        version: v0!,
      }).catch((error: unknown) => error);
      const cleared = await clearOverrideAt(tx as never, {
        actorUserId: null,
        stopId: lane.stopIds[0]!,
        version: v1!,
      });
      // The version it returned is the one the modal's next save carries.
      const next = await attempt(tx, {
        loadId: lane.loadId,
        truckId: lane.truck.id,
        version: cleared.loadVersion,
        loadStatus: 'LOADED',
        stops: [await draftOf(tx, lane.stopIds[0]!)],
      });
      return { stale, cleared, next };
    });

    expect(seen.stale).toBeInstanceOf(StaleLoadError);
    expect(seen.cleared.cleared).toBe(true);
    expect(seen.next.error).toBeNull();
  });
});

describeDb('one transaction (§12.117)', () => {
  it('breaks after the first write and leaves nothing behind — load, stops, driver, override, audit', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await loadWith(tx, [{ city: 'A' }, { city: 'B' }]);
      const other = await makeDriver(tx);
      const opened = await readLoadVersion(tx, lane.loadId);
      const auditBefore = await auditRows(tx);

      const outcome = await attempt(tx, {
        loadId: lane.loadId,
        truckId: lane.truck.id,
        version: opened!,
        // Written first: the assignment, the load, stop 1 and its override…
        driverId: other.id,
        loadNumber: 'NEVER',
        loadStatus: 'LOADED',
        stops: [
          await draftOf(tx, lane.stopIds[0]!, { dispatcherNote: 'never', override: forced }),
          // …then stop 2 cannot be resolved, and the whole save goes.
          await draftOf(tx, lane.stopIds[1]!, { appointment: skippedHour() }),
          newStop('Never Appended'),
        ],
      });

      return {
        outcome,
        version: await readLoadVersion(tx, lane.loadId),
        opened,
        rows: await stopsOf(tx, lane.loadId),
        driver: await openDriver(tx, lane.truck.id),
        lane,
        auditGrew: (await auditRows(tx)) - auditBefore,
        liveOverrides: (await tx.select({ n: count() }).from(overrides).where(isNull(overrides.clearedAt)))[0]!.n,
      };
    });

    expect(seen.outcome.error).toBeInstanceOf(AtStopError);
    expect((seen.outcome.error as AtStopError).error).toBeInstanceOf(AppointmentTimeError);
    expect((seen.outcome.error as AtStopError).field).toBe('stops.1.appointment.time');
    // The version covers the load, its stops, the assignment and overrides.
    expect(seen.version).toBe(seen.opened);
    expect(seen.rows.map((r) => r.city)).toEqual(['A', 'B']);
    expect(seen.driver).toBe(seen.lane.driver.id);
    expect(seen.liveOverrides).toBe(0);
    expect(seen.auditGrew).toBe(0);
  });

  it('breaks a new load after its first stop and leaves the previous load open', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await loadWith(tx, [{ city: 'A', departed: true }]);
      const auditBefore = await auditRows(tx);
      const outcome = await attempt(tx, {
        loadId: null,
        truckId: lane.truck.id,
        loadNumber: 'NEW',
        loadStatus: 'DISPATCHED',
        closePrevious: [{ loadId: lane.loadId, status: 'DELIVERED' }],
        stops: [newStop('First'), newStop('Second', { appointment: skippedHour() })],
      });
      const loadsOnTruck = await tx
        .select({ id: loads.id, status: loads.status })
        .from(loads)
        .where(eq(loads.truckId, lane.truck.id));
      return { outcome, loadsOnTruck, auditGrew: (await auditRows(tx)) - auditBefore };
    });

    expect(seen.outcome.error).toBeInstanceOf(AtStopError);
    expect(seen.loadsOnTruck.map((l) => l.status)).toEqual(['DISPATCHED']);
    expect(seen.auditGrew).toBe(0);
  });
});

describeDb('a new load with a pickup and a delivery, in one save (§12.119, stage 4b)', () => {
  it('creates the load and both stops, in order, with one audit row each under one saveId', async () => {
    const seen = await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      const result = await save(tx, {
        loadId: null,
        truckId: truck.id,
        loadNumber: 'VT-NEW-2',
        loadStatus: 'DISPATCHED',
        stops: [newStop('Melrose Park', { stopType: 'PU' }), newStop('Joliet')],
      });
      const [load] = await tx
        .select({ id: loads.id, loadNumber: loads.loadNumber, status: loads.status })
        .from(loads)
        .where(eq(loads.truckId, truck.id));
      const rows = await tx
        .select({ id: stops.id, sequence: stops.sequence, type: stops.type, city: stops.city })
        .from(stops)
        .where(eq(stops.loadId, load!.id))
        .orderBy(asc(stops.sequence));
      const audit = await tx
        .select({ entity: auditLog.entity, entityId: auditLog.entityId, after: auditLog.after })
        .from(auditLog);
      return { result, load: load!, rows, audit };
    });

    expect(seen.load).toMatchObject({ loadNumber: 'VT-NEW-2', status: 'DISPATCHED' });
    expect(seen.rows.map((r) => [r.sequence, r.type, r.city])).toEqual([
      [1, 'PU', 'Melrose Park'],
      [2, 'DEL', 'Joliet'],
    ]);
    expect(seen.result.stops.map((s) => s.stopId)).toEqual(seen.rows.map((r) => r.id));

    const stopRows = seen.audit.filter((a) => a.entity === 'stop');
    expect(stopRows.map((a) => a.entityId).sort()).toEqual(seen.rows.map((r) => r.id).sort());
    // Every row the save wrote carries its one saveId.
    const saveIds = seen.audit.map((a) => (a.after as Record<string, unknown> | null)?.['saveId']);
    expect(new Set(saveIds)).toEqual(new Set([seen.result.saveId]));
    for (const row of stopRows) {
      expect(row.after).toMatchObject({ loadId: seen.load.id, source: 'edit-modal' });
    }
  });

  it('breaks at the delivery and leaves nothing behind — no load, no stop, no audit row', async () => {
    const seen = await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      const auditBefore = await auditRows(tx);
      const outcome = await attempt(tx, {
        loadId: null,
        truckId: truck.id,
        loadNumber: 'NEVER',
        loadStatus: 'DISPATCHED',
        // The pickup is written first; the delivery's skipped hour throws.
        stops: [
          newStop('Melrose Park', { stopType: 'PU' }),
          newStop('Joliet', { appointment: skippedHour() }),
        ],
      });
      const onTruck = await tx.select({ id: loads.id }).from(loads).where(eq(loads.truckId, truck.id));
      const [stopCount] = await tx.select({ n: count() }).from(stops);
      return { outcome, onTruck, stopCount: stopCount!.n, auditGrew: (await auditRows(tx)) - auditBefore };
    });

    expect(seen.outcome.error).toBeInstanceOf(AtStopError);
    expect((seen.outcome.error as AtStopError).field).toBe('stops.1.appointment.time');
    expect(seen.onTruck).toEqual([]);
    expect(seen.stopCount).toBe(0);
    expect(seen.auditGrew).toBe(0);
  });
});

/**
 * §12.117, for real: two connections. The rows are COMMITTED — a lock is
 * only a lock between transactions — in `fleet_commit`, never the shared test
 * database (src/test/db.ts `commitDb`), and deleted again at the end.
 *
 * The worker's arrival is written and held open; the save that removes the
 * same stop starts and must WAIT on the stop's row lock; the worker commits;
 * the save, now reading the arrived stop under its lock, refuses. Without
 * `for update` the save would read the stop as unreached and delete it once
 * the worker let go — removing a stop the truck had reached.
 */
describeDb('a removal racing the worker’s arrival (§12.117)', () => {
  it('waits on the stop’s row lock, then refuses the removal and writes nothing', async () => {
    const db = commitDb();
    const truck = await makeTruck(db as never);
    const [load] = await db
      .insert(loads)
      .values({ truckId: truck.id, loadNumber: 'VT-RACE', status: 'DISPATCHED' })
      .returning({ id: loads.id });
    const [first, second] = await db
      .insert(stops)
      .values([
        { loadId: load!.id, type: 'PU', sequence: 1, city: 'A', state: 'IL' },
        { loadId: load!.id, type: 'DEL', sequence: 2, city: 'B', state: 'IL' },
      ])
      .returning({ id: stops.id });

    try {
      const version = await readLoadVersion(db as never, load!.id);
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let arrivalWritten!: () => void;
      const written = new Promise<void>((resolve) => {
        arrivalWritten = resolve;
      });

      // 1. The worker writes stop 2's arrival and holds its transaction open.
      const worker = db.transaction(async (w) => {
        await w
          .update(stops)
          .set({ arrivedAt: new Date(), arrivedSource: 'detected' })
          .where(eq(stops.id, second!.id));
        arrivalWritten();
        await held;
      });
      await written;

      // 2. The save removing stop 2 starts, and blocks on the lock.
      const saving = saveLoadEdit(db as never, {
        ...DISPATCH,
        edit: LoadEdit.parse({
          loadId: load!.id,
          truckId: truck.id,
          version: version!,
          loadStatus: 'DISPATCHED',
          stops: [
            { stopId: first!.id, stopType: 'PU', addressLine: null, city: 'A', state: 'IL', zip: null, appointment: null },
          ],
          removedStopIds: [second!.id],
        }),
      }).then(
        () => null,
        (error: unknown) => error,
      );
      await waitForLockWait(db);

      // 3. The worker commits; the save goes on and reads the arrival.
      release();
      await worker;
      const error = await saving;

      expect(error).toBeInstanceOf(StopEditError);
      expect((error as StopEditError).message).toMatch(/reached this stop/);
      const left = await db.select({ id: stops.id }).from(stops).where(eq(stops.loadId, load!.id));
      expect(left).toHaveLength(2);
      const [audit] = await db.select({ n: count() }).from(auditLog);
      expect(audit!.n).toBe(0);
    } finally {
      await db.delete(stops).where(eq(stops.loadId, load!.id));
      await db.delete(loads).where(eq(loads.id, load!.id));
      await db.delete(trucks).where(eq(trucks.id, truck.id));
    }
  });
});

/** Until some backend is waiting on a lock — the save, queued behind the worker. */
async function waitForLockWait(db: ReturnType<typeof commitDb>) {
  for (let i = 0; i < 100; i += 1) {
    const rows = (await db.execute(
      sql`select count(*)::int as n from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'`,
    )) as unknown as { n: number }[];
    if (rows[0]!.n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('The save never waited on the lock.');
}

describeDb('Reopen reads a close made by a multi-stop save (§12.107)', () => {
  it('finds the close, and reopens the load to the status it had', async () => {
    const seen = await rolledBack(async (tx) => {
      // Both reached, neither left: a departed stop's appointment is locked
      // (§12.116 D4), and this draft sends none.
      const lane = await loadWith(tx, [{ city: 'A', arrived: true }, { city: 'B', arrived: true }]);
      const version = await readLoadVersion(tx, lane.loadId);
      await save(tx, {
        loadId: lane.loadId,
        truckId: lane.truck.id,
        version: version!,
        loadStatus: 'DELIVERED',
        stops: [await draftOf(tx, lane.stopIds[0]!), await draftOf(tx, lane.stopIds[1]!)],
      });
      const offered = await recentlyClosed(tx, lane.truck.id);
      const reopened = await reopenLoad(tx as never, {
        actorUserId: null,
        dispatchTz: TZ,
        request: {
          truckId: lane.truck.id,
          loadId: lane.loadId,
          closeAuditId: offered[0]!.close.closeAuditId,
        },
      });
      return { lane, offered, reopened };
    });

    expect(seen.offered.map((l) => l.loadId)).toEqual([seen.lane.loadId]);
    expect(seen.offered[0]!.close).toMatchObject({ closedStatus: 'DELIVERED', statusBefore: 'DISPATCHED' });
    expect(seen.reopened).toMatchObject({ loadId: seen.lane.loadId, status: 'DISPATCHED' });
  });
});
