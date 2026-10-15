import { describe, expect, it, vi } from 'vitest';
import { asc, eq, sql } from 'drizzle-orm';
import { etaMarks, etaStatusChanges, loads, overrides, stops } from '@/db/schema';
import { describeDb, rolledBack, rolledBackAlone } from '@/test/db';
import { assign, makeDriver, makeFullFleetRow, makePosition, makeTruck } from '@/test/fleet';
import { destinationKey } from '@/lib/eta-marks';
import { STATUSES, STATUS_DEFAULTS, haversineMiles } from '@/lib/status';
import type { Tx } from '@/server/audit';
import { LATEST_POSITION_SQL, applyStatus, parseFleetRows } from '@/server/fleet-query';
import { runEtaLog } from './eta-marks';
import { STATUS_LOG_CAP, logStatusChanges, runStatusLog } from './status-changes';

/**
 * §12.126. The status change log against the real database, always rolled
 * back.
 *
 * The rules that matter: what is logged is what the board shows (the board's
 * own code, compared here against the board's own code); a row only on a
 * change; the sequence is stop + truck + destination; the cap never drops the
 * first row in a status; and nothing that goes wrong in here can reach the
 * poll or the ETA log beside it.
 */

const TZ = 'America/Chicago';
const MIN = 60_000;
const HOUR = 60 * MIN;
const STOP = { lat: 41.525, lng: -88.0817 };
/** A point `miles` due south of the stop (a degree of latitude is ~69.09 mi). */
const south = (miles: number) => ({ lat: STOP.lat - miles / 69.09, lng: STOP.lng });
const at = (now: Date, ms: number) => new Date(now.getTime() + ms);

const quiet = () => ({ warn: vi.fn(), info: vi.fn() });

interface StopOptions {
  /** Straight-line miles from the stop to the truck's fix. */
  miles?: number;
  /** How long before `now` the fix was recorded. */
  fixAgoMs?: number;
  driver?: boolean;
  coords?: boolean;
  precision?: 'street' | 'block' | 'zip';
  /** Window start relative to `now`; an hour ago unless given. */
  startInMs?: number;
  /** Window end (the deadline) relative to `now`; null for no appointment. */
  dueInMs?: number | null;
  arrived?: boolean;
}

let seq = 0;

/** One truck, one fix, one open load, one stop: everything the board reads. */
async function truckWithStop(tx: Tx, now: Date, o: StopOptions = {}) {
  const truck = await makeTruck(tx);
  if (o.driver ?? true) await assign(tx, truck.id, (await makeDriver(tx)).id);
  await makePosition(tx, truck.id, {
    ...south(o.miles ?? 60),
    speedMph: 55,
    recordedAt: at(now, -(o.fixAgoMs ?? MIN)),
    formattedLocation: 'Halsted Street, Chicago, IL, 60607',
  });
  seq += 1;
  const [load] = await tx
    .insert(loads)
    .values({ truckId: truck.id, loadNumber: `VT-STATUS-${seq}`, status: 'DISPATCHED' })
    .returning({ id: loads.id });
  const due = o.dueInMs === undefined ? 5 * HOUR : o.dueInMs;
  const [stop] = await tx
    .insert(stops)
    .values({
      loadId: load!.id,
      type: 'DEL',
      sequence: 1,
      addressLine: '1 Vitest Fixture Street',
      city: 'Joliet',
      state: 'IL',
      zip: '60433',
      ...((o.coords ?? true)
        ? {
            lat: STOP.lat,
            lng: STOP.lng,
            geocodePrecision: o.precision ?? 'street',
            geocodeAccuracyMiles: 0.1,
            geocodedAt: now,
          }
        : {}),
      ...(due === null
        ? {}
        : {
            appointmentStartUtc: at(now, o.startInMs ?? -HOUR),
            appointmentEndUtc: at(now, due),
            appointmentTz: TZ,
            appointmentType: 'APPT' as const,
          }),
      ...(o.arrived ? { arrivedAt: at(now, -5 * MIN), arrivedSource: 'detected' as const } : {}),
    })
    .returning({ id: stops.id });
  return { truck, loadId: load!.id, stopId: stop!.id };
}

/** The deadline moved: the window now ends at `end` (and opened an hour before `now`). */
async function dueAt(tx: Tx, stopId: string, now: Date, end: Date) {
  await tx
    .update(stops)
    .set({ appointmentStartUtc: at(now, -HOUR), appointmentEndUtc: end })
    .where(eq(stops.id, stopId));
}

/** What the console shows at `now`, computed the way server/fleet.ts does. */
async function board(tx: Tx, now: Date) {
  return applyStatus(
    parseFleetRows(await tx.execute(LATEST_POSITION_SQL)),
    { ...STATUS_DEFAULTS, dispatchTz: TZ },
    now,
  );
}

async function etaOf(tx: Tx, now: Date, truckId: string): Promise<Date> {
  const row = (await board(tx, now)).find((r) => r.id === truckId);
  return new Date(row!.etaUtc!);
}

/** In the order written: the identity, not `logged_at`, which one transaction shares. */
async function logFor(tx: Tx, stopId: string) {
  return tx
    .select()
    .from(etaStatusChanges)
    .where(eq(etaStatusChanges.stopId, stopId))
    .orderBy(asc(etaStatusChanges.id));
}

const pairs = (rows: { status: string; computed: string }[]) =>
  rows.map((r) => `${r.status}/${r.computed}`);

describe('the fixture geometry', () => {
  it('puts the truck where the tests say it is', () => {
    expect(haversineMiles(south(60), STOP)).toBeCloseTo(60, 0);
  });
});

describeDb('the status change log', () => {
  it('logs what the board shows: every field agrees with applyStatus over the fleet query', async () => {
    const seen = await rolledBack(async (tx) => {
      const now = new Date();
      await truckWithStop(tx, now); // ON_TIME
      await truckWithStop(tx, now, { dueInMs: 100 * MIN }); // AT_RISK
      await truckWithStop(tx, now, { dueInMs: 60 * MIN }); // LATE, by the ETA
      await truckWithStop(tx, now, { driver: false }); // UNASSIGNED
      await truckWithStop(tx, now, { fixAgoMs: 2 * HOUR }); // STALE_GPS
      await truckWithStop(tx, now, { coords: false, dueInMs: -10 * MIN }); // LATE, by the clock
      await truckWithStop(tx, now, { arrived: true }); // ARRIVED
      await truckWithStop(tx, now, { dueInMs: null }); // NO_APPT
      await truckWithStop(tx, now, { startInMs: 49 * HOUR, dueInMs: 50 * HOUR }); // TOMORROW
      await truckWithStop(tx, now, { dueInMs: 100 * MIN, precision: 'zip' }); // no AT_RISK on a ZIP
      await makeFullFleetRow(tx); // a live override, a cached route
      // A truck with no load: on the board, never in the log.
      await makeTruck(tx);

      const result = await logStatusChanges(tx, TZ, now);
      const expected = await board(tx, now);
      const logged = await tx.select().from(etaStatusChanges);
      return { result, expected, logged };
    });

    const withStop = seen.expected.filter((r) => r.nextStop !== null);
    expect(seen.result).toEqual({
      considered: withStop.length,
      firstSeen: withStop.length,
      changes: 0,
      capped: [],
      pastCapWritten: 0,
    });
    expect(seen.logged).toHaveLength(withStop.length);
    // The fixture reaches every status, and the override shows over its own.
    expect(new Set(seen.logged.map((r) => r.status))).toEqual(new Set(STATUSES));
    expect(seen.logged.some((r) => r.overrideLive && r.status !== r.computed)).toBe(true);

    for (const b of withStop) {
      const row = seen.logged.find((r) => r.truckId === b.id);
      const stop = b.nextStop!;
      expect(row, `truck ${b.truckNumber}`).toBeDefined();
      expect({
        stopId: row!.stopId,
        truckNumber: row!.truckNumber,
        destKey: row!.destKey,
        status: row!.status,
        computed: row!.computed,
        overrideLive: row!.overrideLive,
        prevStatus: row!.prevStatus,
        prevComputed: row!.prevComputed,
        fixRecordedAt: row!.fixRecordedAt?.toISOString() ?? null,
        fixLat: row!.fixLat,
        fixLng: row!.fixLng,
        etaUtc: row!.etaUtc?.toISOString() ?? null,
        milesRemaining: row!.milesRemaining,
        deadlineUtc: row!.deadlineUtc?.toISOString() ?? null,
        precision: row!.precision,
        distanceBasis: row!.distanceBasis,
        apptType: row!.apptType,
      }).toEqual({
        stopId: stop.stopId,
        truckNumber: b.truckNumber,
        destKey:
          stop.lat !== null && stop.lng !== null ? destinationKey(stop.lat, stop.lng) : null,
        status: b.status,
        computed: b.computed,
        overrideLive: b.override !== null,
        prevStatus: null,
        prevComputed: null,
        fixRecordedAt: b.recordedAt,
        fixLat: b.lat,
        fixLng: b.lng,
        etaUtc: b.etaUtc,
        milesRemaining: b.milesRemaining,
        deadlineUtc: b.deadlineUtc,
        precision: b.etaPrecision,
        distanceBasis: b.etaUtc === null ? null : b.distanceBasis,
        apptType: stop.apptType,
      });
    }
  });

  it('writes one row for two polls with no change, not two', async () => {
    const seen = await rolledBack(async (tx) => {
      const now = new Date();
      const lane = await truckWithStop(tx, now);
      const first = await logStatusChanges(tx, TZ, now);
      const second = await logStatusChanges(tx, TZ, at(now, MIN));
      return { first, second, rows: await logFor(tx, lane.stopId) };
    });
    expect(pairs(seen.rows)).toEqual(['ON_TIME/ON_TIME']);
    expect(seen.first).toMatchObject({ considered: 1, firstSeen: 1, changes: 0 });
    expect(seen.second).toMatchObject({ considered: 1, firstSeen: 0, changes: 0 });
  });

  it('writes a row per change, ON_TIME → AT_RISK → LATE → ON_TIME, each naming the one before', async () => {
    const rows = await rolledBack(async (tx) => {
      const now = new Date();
      const lane = await truckWithStop(tx, now);
      const eta = await etaOf(tx, now, lane.truck.id);
      await logStatusChanges(tx, TZ, now);
      await dueAt(tx, lane.stopId, now, at(eta, 20 * MIN));
      await logStatusChanges(tx, TZ, now);
      await dueAt(tx, lane.stopId, now, at(eta, -20 * MIN));
      await logStatusChanges(tx, TZ, now);
      await logStatusChanges(tx, TZ, now); // still LATE: nothing
      // The truck moves on: a newer fix, ten miles out, puts it back on time.
      await makePosition(tx, lane.truck.id, { ...south(10), speedMph: 60, recordedAt: now });
      await logStatusChanges(tx, TZ, now);
      return logFor(tx, lane.stopId);
    });
    expect(pairs(rows)).toEqual([
      'ON_TIME/ON_TIME',
      'AT_RISK/AT_RISK',
      'LATE/LATE',
      'ON_TIME/ON_TIME',
    ]);
    expect(rows.map((r) => r.prevStatus)).toEqual([null, 'ON_TIME', 'AT_RISK', 'LATE']);
    expect(rows.map((r) => r.prevComputed)).toEqual([null, 'ON_TIME', 'AT_RISK', 'LATE']);
    // The last row carries the fix it was read from.
    expect(rows[3]!.milesRemaining).toBeLessThan(rows[2]!.milesRemaining!);
  });

  it('logs an override going live and expiring: the status changes, computed does not', async () => {
    const rows = await rolledBack(async (tx) => {
      const now = new Date();
      const lane = await truckWithStop(tx, now);
      await logStatusChanges(tx, TZ, now);
      await tx.insert(overrides).values({
        stopId: lane.stopId,
        forcedStatus: 'LATE',
        reason: 'RECEIVER_CONFIRMED_DETENTION',
        expiresAt: at(now, 10 * MIN),
      });
      await logStatusChanges(tx, TZ, now);
      await logStatusChanges(tx, TZ, at(now, 5 * MIN)); // still live: nothing
      // Expiry is on read (§9.5): eleven minutes on, the board shows its own.
      await logStatusChanges(tx, TZ, at(now, 11 * MIN));
      return logFor(tx, lane.stopId);
    });
    expect(pairs(rows)).toEqual(['ON_TIME/ON_TIME', 'LATE/ON_TIME', 'ON_TIME/ON_TIME']);
    expect(rows.map((r) => r.overrideLive)).toEqual([false, true, false]);
    expect(rows.map((r) => r.prevStatus)).toEqual([null, 'ON_TIME', 'LATE']);
  });

  it('starts a new sequence for a stop edited to a new destination', async () => {
    const rows = await rolledBack(async (tx) => {
      const now = new Date();
      const lane = await truckWithStop(tx, now);
      await logStatusChanges(tx, TZ, now);
      await tx
        .update(stops)
        .set({ lat: STOP.lat + 0.5 })
        .where(eq(stops.id, lane.stopId));
      await logStatusChanges(tx, TZ, now);
      return logFor(tx, lane.stopId);
    });
    // Same status, new trip: a first row, not "no change".
    expect(pairs(rows)).toEqual(['ON_TIME/ON_TIME', 'ON_TIME/ON_TIME']);
    expect(rows[0]!.destKey).toBe(destinationKey(STOP.lat, STOP.lng));
    expect(rows[1]!.destKey).toBe(destinationKey(STOP.lat + 0.5, STOP.lng));
    expect(rows[1]!.prevStatus).toBeNull();
    expect(rows[1]!.prevComputed).toBeNull();
  });

  it('starts a new sequence when the load moves to another truck', async () => {
    const seen = await rolledBack(async (tx) => {
      const now = new Date();
      const lane = await truckWithStop(tx, now);
      await logStatusChanges(tx, TZ, now);
      // A truck with a driver and a fix, and no load of its own to compete.
      const other = await makeTruck(tx);
      await assign(tx, other.id, (await makeDriver(tx)).id);
      await makePosition(tx, other.id, { ...south(60), speedMph: 55, recordedAt: at(now, -MIN) });
      await tx.update(loads).set({ truckId: other.id }).where(eq(loads.id, lane.loadId));
      await logStatusChanges(tx, TZ, now);
      return { rows: await logFor(tx, lane.stopId), first: lane.truck.id, second: other.id };
    });
    expect(seen.rows.map((r) => r.truckId)).toEqual([seen.first, seen.second]);
    expect(seen.rows[1]!.prevStatus).toBeNull();
  });

  it('logs a stop with no coordinates once, with a null destination, late by the clock', async () => {
    const rows = await rolledBack(async (tx) => {
      const now = new Date();
      const lane = await truckWithStop(tx, now, { coords: false, dueInMs: -10 * MIN });
      await logStatusChanges(tx, TZ, now);
      // Null is compared as a value: the second poll finds the first row.
      await logStatusChanges(tx, TZ, at(now, MIN));
      return logFor(tx, lane.stopId);
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      destKey: null,
      status: 'LATE',
      computed: 'LATE',
      etaUtc: null,
      milesRemaining: null,
      distanceBasis: null,
      precision: null,
    });
  });

  it(
    'caps a flapping sequence at 100 rows and names what it drops, but still logs its first LATE',
    async () => {
      const seen = await rolledBack(async (tx) => {
        const now = new Date();
        const lane = await truckWithStop(tx, now);
        const eta = await etaOf(tx, now, lane.truck.id);
        const onTime = at(eta, 2 * HOUR);
        const atRisk = at(eta, 20 * MIN);
        await logStatusChanges(tx, TZ, now);
        // 99 flips: the first-seen row and 99 changes are the 100 rows.
        for (let i = 1; i < STATUS_LOG_CAP; i += 1) {
          await dueAt(tx, lane.stopId, now, i % 2 === 1 ? atRisk : onTime);
          await logStatusChanges(tx, TZ, now);
        }
        const full = (await logFor(tx, lane.stopId)).length;
        // The 100th flip, back to ON_TIME: it would be the 101st row.
        await dueAt(tx, lane.stopId, now, onTime);
        const dropped = await logStatusChanges(tx, TZ, now);
        // The board unchanged: the log is still behind it, and says so again.
        const stillBehind = await logStatusChanges(tx, TZ, now);
        // The 101st flip, to AT_RISK: what the newest row already says.
        await dueAt(tx, lane.stopId, now, atRisk);
        const caughtUp = await logStatusChanges(tx, TZ, now);
        const afterCap = (await logFor(tx, lane.stopId)).length;
        // Then LATE, for the first time.
        await dueAt(tx, lane.stopId, now, at(eta, -20 * MIN));
        const late = await logStatusChanges(tx, TZ, now);
        await dueAt(tx, lane.stopId, now, onTime);
        const backOnTime = await logStatusChanges(tx, TZ, now);
        const rows = await logFor(tx, lane.stopId);
        return { lane, full, dropped, stillBehind, caughtUp, afterCap, late, backOnTime, rows };
      });

      const named = [{ truckNumber: seen.lane.truck.truckNumber, stopId: seen.lane.stopId }];
      expect(seen.full).toBe(STATUS_LOG_CAP);
      expect(seen.dropped).toEqual({
        considered: 1,
        firstSeen: 0,
        changes: 0,
        capped: named,
        pastCapWritten: 0,
      });
      expect(seen.stillBehind.capped).toEqual(named);
      expect(seen.caughtUp).toMatchObject({ changes: 0, capped: [] });
      expect(seen.afterCap).toBe(STATUS_LOG_CAP);
      expect(seen.late).toEqual({
        considered: 1,
        firstSeen: 0,
        changes: 1,
        capped: [],
        pastCapWritten: 1,
      });
      // ON_TIME again has been shown before: dropped, and named.
      expect(seen.backOnTime.capped).toEqual(named);
      expect(seen.rows).toHaveLength(STATUS_LOG_CAP + 1);
      const last = seen.rows[seen.rows.length - 1]!;
      expect(last).toMatchObject({ status: 'LATE', computed: 'LATE', prevStatus: 'AT_RISK' });
    },
    60_000,
  );

  it('names the truck and the stop, and nothing about the driver, the load or the address', async () => {
    const seen = await rolledBack(async (tx) => {
      const fixture = await makeFullFleetRow(tx);
      await logStatusChanges(tx, TZ);
      const [load] = await tx.select().from(loads).where(eq(loads.id, fixture.loadId));
      const rows = await logFor(tx, fixture.stopId);
      return { rows, driver: fixture.driver.name, dispatcher: fixture.dispatcher.name, load: load! };
    });
    expect(seen.rows).toHaveLength(1);
    const text = JSON.stringify(seen.rows);
    for (const secret of [
      seen.driver,
      seen.dispatcher,
      seen.load.loadNumber!,
      '1 Vitest Fixture Street',
      'Joliet',
      '60433',
      'Halsted',
      'fixture',
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});

describeDb('the table', () => {
  const constraint = async (tx: Tx, name: string) =>
    ((await tx.execute<{ def: string }>(sql`
      select pg_get_constraintdef(oid) as def from pg_constraint where conname = ${name}`)) as unknown as {
      def: string;
    }[])[0]!.def;

  it.each([
    'eta_status_changes_status_known',
    'eta_status_changes_computed_known',
    'eta_status_changes_prev_status_known',
    'eta_status_changes_prev_computed_known',
  ])('%s is exactly the STATUSES list in lib/status.ts', async (name) => {
    const def = await rolledBack((tx) => constraint(tx, name));
    expect([...def.matchAll(/'([A-Z_]+)'::text/g)].map((m) => m[1])).toEqual([...STATUSES]);
  });

  it('refuses a status outside the list, and half a previous row', async () => {
    const refusal = async (values: Record<string, unknown>) =>
      rolledBack(async (tx) => {
        const lane = await truckWithStop(tx, new Date());
        try {
          await tx.execute(sql`savepoint probe`);
          await tx.insert(etaStatusChanges).values({
            stopId: lane.stopId,
            truckId: lane.truck.id,
            status: 'ON_TIME',
            computed: 'ON_TIME',
            overrideLive: false,
            ...values,
          });
          return 'NOT REFUSED';
        } catch (error) {
          await tx.execute(sql`rollback to savepoint probe`);
          const cause = (error as { cause?: unknown }).cause;
          return cause instanceof Error ? cause.message : String(error);
        }
      });
    expect(await refusal({ status: 'LATEISH' })).toContain('eta_status_changes_status_known');
    expect(await refusal({ prevStatus: 'LATE' })).toContain('eta_status_changes_prev_whole');
    expect(await refusal({ destKey: '41.5:-88.1' })).toContain('eta_status_changes_dest_key_shape');
    expect(await refusal({ prevStatus: 'LATE', prevComputed: 'LATE' })).toBe('NOT REFUSED');
  });

  it('is deny-by-default: RLS on, a deny-all policy, nothing granted on the table or its sequence', async () => {
    const out = await rolledBack(
      async (tx) =>
        ((await tx.execute<Record<string, unknown>>(sql`
          select c.relrowsecurity as rls,
            (select count(*)::int from pg_policies p
              where p.tablename = 'eta_status_changes' and p.qual = 'false') as policies,
            has_table_privilege('anon', 'public.eta_status_changes', 'select,insert,update,delete') as anon,
            has_table_privilege('authenticated', 'public.eta_status_changes', 'select,insert,update,delete') as authed,
            has_sequence_privilege('anon', 'public.eta_status_changes_id_seq', 'usage,select,update') as anon_seq,
            has_sequence_privilege('authenticated', 'public.eta_status_changes_id_seq', 'usage,select,update') as authed_seq
          from pg_class c where c.relname = 'eta_status_changes'`)) as unknown as Record<string, unknown>[])[0],
    );
    expect(out).toEqual({
      rls: true,
      policies: 1,
      anon: false,
      authed: false,
      anon_seq: false,
      authed_seq: false,
    });
  });

  it('holds no column for a driver, a load number or an address', async () => {
    const columns = await rolledBack(
      async (tx) =>
        ((await tx.execute<{ name: string }>(sql`
          select column_name as name from information_schema.columns
          where table_schema = 'public' and table_name = 'eta_status_changes'
          order by ordinal_position`)) as unknown as { name: string }[]).map((c) => c.name),
    );
    expect(columns).toEqual([
      'id',
      'stop_id',
      'truck_id',
      'truck_number',
      'dest_key',
      'status',
      'computed',
      'override_live',
      'prev_status',
      'prev_computed',
      'fix_recorded_at',
      'fix_lat',
      'fix_lng',
      'eta_utc',
      'miles_remaining',
      'deadline_utc',
      'precision',
      'distance_basis',
      'appt_type',
      'logged_at',
    ]);
  });
});

describeDb('a failure in the status log never reaches the poll', () => {
  /** Makes every insert into `table` fail, for this transaction only. */
  async function breakInserts(tx: Tx, table: string, body = `raise exception '${table} insert refused (test)'`) {
    await tx.execute(
      sql.raw(`create function pg_temp.refuse_${table}() returns trigger language plpgsql as $$
        begin ${body}; return new; end $$`),
    );
    await tx.execute(
      sql.raw(`create trigger refuse_${table} before insert on ${table}
        for each row execute function pg_temp.refuse_${table}()`),
    );
  }

  /** The poll's two log steps, in the worker's order (index.ts). */
  async function bothLogs(tx: Tx, logger: ReturnType<typeof quiet>) {
    const eta = await runEtaLog(tx, logger);
    const status = await runStatusLog(tx, logger, TZ);
    return { eta, status };
  }

  it('catches a failed insert, warns once, and the ETA marks of the same poll are still written', async () => {
    const logger = quiet();
    const seen = await rolledBackAlone(async (tx) => {
      const lane = await truckWithStop(tx, new Date());
      await breakInserts(tx, 'eta_status_changes');
      const result = await bothLogs(tx, logger);
      const marks = await tx.select().from(etaMarks).where(eq(etaMarks.stopId, lane.stopId));
      return { result, marks: marks.length, rows: (await logFor(tx, lane.stopId)).length };
    });

    expect(seen.result.status).toEqual({
      considered: 0,
      firstSeen: 0,
      changes: 0,
      capped: [],
      pastCapWritten: 0,
    });
    expect(seen.result.eta).toMatchObject({ considered: 1, firstSeen: 1 });
    expect(seen.marks).toBe(1);
    expect(seen.rows).toBe(0);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [message, fields] = logger.warn.mock.calls[0]!;
    expect(message).toBe('status change log failed');
    expect(String((fields as { error: string }).error)).toContain('eta_status_changes insert refused');
  });

  it('and a failed ETA log does not lose the status rows', async () => {
    const logger = quiet();
    const seen = await rolledBackAlone(async (tx) => {
      const lane = await truckWithStop(tx, new Date());
      await breakInserts(tx, 'eta_marks');
      const result = await bothLogs(tx, logger);
      const marks = await tx.select().from(etaMarks).where(eq(etaMarks.stopId, lane.stopId));
      return { result, marks: marks.length, rows: (await logFor(tx, lane.stopId)).length };
    });
    expect(seen.marks).toBe(0);
    expect(seen.rows).toBe(1);
    expect(seen.result.status).toMatchObject({ considered: 1, firstSeen: 1 });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]![0]).toBe('eta mark log failed');
  });

  it('gives up within its own timeout rather than holding the poll', async () => {
    const logger = quiet();
    const elapsed = await rolledBackAlone(async (tx) => {
      await truckWithStop(tx, new Date());
      await breakInserts(tx, 'eta_status_changes', 'perform pg_sleep(30)');
      const started = Date.now();
      await runStatusLog(tx, logger, TZ);
      return Date.now() - started;
    });
    expect(elapsed).toBeLessThan(6_000);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(String((logger.warn.mock.calls[0]![1] as { error: string }).error)).toContain(
      'statement timeout',
    );
  }, 15_000);
});
