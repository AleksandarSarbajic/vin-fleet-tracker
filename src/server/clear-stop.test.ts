import { expect, it } from 'vitest';
import { and, asc, eq, sql } from 'drizzle-orm';
import { assignments, auditLog, geocodeCache, loads, stops, trucks } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import {
  assign,
  makeDispatcher,
  makeDriver,
  makePosition,
  makeTruck,
} from '@/test/fleet';
import { normalizeAddress } from '@/lib/address';
import { openLoadChoices, timelineSentence } from '@/lib/clear-stop';
import { STATUS_DEFAULTS } from '@/lib/status';
import { StopEdit } from '@/lib/stop-edit';
import { timelineStay } from '@/lib/timeline';
import { sweepArrivals } from '@/worker/arrival';
import { clearStop, ClearStopError } from './clear-stop';
import { CHAIN_VERSION } from './geocode';
import { LATEST_POSITION_SQL, applyStatus, parseFleetRows } from './fleet-query';
import { ReachedStopError } from './stop-edit';
import { saveStopEdit } from '@/test/stop-save';
import { loadTruckTimeline } from './timeline';
import type { Tx } from './audit';

/**
 * §12.88 — Clear stop against the real database, inside transactions that
 * always roll back. `clearStop` opens its own transaction; nested in the
 * test's, that is a savepoint, so "nothing changed" below is the same
 * all-or-nothing the route gets from a real transaction.
 */

const TZ = 'America/Chicago';
const config = { ...STATUS_DEFAULTS, dispatchTz: TZ };
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

/**
 * The Fargo address §12.76 found: Census answers `4551 37TH AVE N`, a
 * different road, so the street match is REFUSED and the stop sits on the
 * 58102 ZIP centre with that refusal cached. Clearing must leave both alone —
 * a correct address re-geocoded here would land on the wrong road.
 */
const FARGO = {
  addressLine: '4551 37th St N',
  city: 'Fargo',
  state: 'ND',
  zip: '58102',
  lat: 46.9217,
  lng: -96.8311,
  accuracyMiles: 3.2,
  refused: '4551 37TH AVE N, FARGO, ND, 58102',
};

interface Leg {
  seq: number;
  arrivedAt?: Date;
  source?: 'detected' | 'dispatcher';
  departedAt?: Date;
  anchor?: { lat: number; lng: number; at: Date };
}

async function addLoad(tx: Tx, truckId: string, loadNumber: string | null, legs: Leg[]) {
  const [load] = await tx
    .insert(loads)
    .values({ truckId, loadNumber, status: 'DISPATCHED' })
    .returning({ id: loads.id });
  const stopIds: string[] = [];
  for (const leg of legs) {
    const [row] = await tx
      .insert(stops)
      .values({
        loadId: load!.id,
        type: leg.seq === 1 && legs.length > 1 ? 'PU' : 'DEL',
        sequence: leg.seq,
        addressLine: FARGO.addressLine,
        city: FARGO.city,
        state: FARGO.state,
        zip: FARGO.zip,
        lat: FARGO.lat,
        lng: FARGO.lng,
        geocodePrecision: 'zip',
        geocodeAccuracyMiles: FARGO.accuracyMiles,
        geocodeConfidence: 'census:zip',
        geocodedAddress: '58102',
        geocodedAt: hoursAgo(48),
        arrivedAt: leg.arrivedAt ?? null,
        arrivedSource: leg.arrivedAt ? (leg.source ?? 'detected') : null,
        departedAt: leg.departedAt ?? null,
        arrivalAnchorLat: leg.anchor?.lat ?? null,
        arrivalAnchorLng: leg.anchor?.lng ?? null,
        arrivalAnchorAt: leg.anchor?.at ?? null,
      })
      .returning({ id: stops.id });
    stopIds.push(row!.id);
  }
  return { loadId: load!.id, stopIds };
}

/** A truck, its driver, a position at the stop, and the Fargo refusal cached. */
async function world(tx: Tx) {
  const truck = await makeTruck(tx);
  const driver = await makeDriver(tx);
  await assign(tx, truck.id, driver.id);
  const dispatcher = await makeDispatcher(tx);
  await makePosition(tx, truck.id, {
    lat: FARGO.lat,
    lng: FARGO.lng,
    speedMph: 0,
    recordedAt: hoursAgo(0.1),
  });
  await tx.insert(geocodeCache).values({
    normalizedAddress: normalizeAddress(FARGO),
    lat: FARGO.lat,
    lng: FARGO.lng,
    precision: 'zip',
    accuracyMiles: FARGO.accuracyMiles,
    confidence: 'census:zip',
    matchedAddress: '58102',
    refusedMatch: FARGO.refused,
    provider: 'census',
  });
  return { truck, driver, dispatcher };
}

const stopRows = (tx: Tx, loadId: string) =>
  tx.select().from(stops).where(eq(stops.loadId, loadId)).orderBy(asc(stops.sequence));

const loadStatus = async (tx: Tx, loadId: string) =>
  (await tx.select({ s: loads.status }).from(loads).where(eq(loads.id, loadId)))[0]!.s;

const auditFor = (tx: Tx, loadId: string) =>
  tx
    .select({
      actor: auditLog.actorUserId,
      before: auditLog.before,
      after: auditLog.after,
    })
    .from(auditLog)
    .where(and(eq(auditLog.entity, 'load'), eq(auditLog.entityId, loadId)));

async function fleetRow(tx: Tx, truckId: string) {
  const rows = applyStatus(
    parseFleetRows(await tx.execute(LATEST_POSITION_SQL)),
    config,
    new Date(),
  );
  return rows.find((r) => r.id === truckId)!;
}

/** The message and its cause, since drizzle wraps what Postgres raised. */
const said = (error: unknown) =>
  error instanceof Error
    ? `${error.message} ${String((error as { cause?: unknown }).cause ?? '')}`
    : String(error);

describeDb('Clear stop (§12.88)', () => {
  it('closes the load, clears the anchor, and keeps the arrival record', async () => {
    const seen = await rolledBack(async (tx) => {
      const { truck, dispatcher } = await world(tx);
      const anchorAt = hoursAgo(1);
      const { loadId } = await addLoad(tx, truck.id, 'LD-4551', [
        {
          seq: 1,
          arrivedAt: hoursAgo(1),
          source: 'dispatcher',
          anchor: { lat: FARGO.lat + 0.001, lng: FARGO.lng, at: anchorAt },
        },
      ]);
      const stopsBefore = await stopRows(tx, loadId);
      const cacheBefore = await tx.select().from(geocodeCache);
      const rowBefore = await fleetRow(tx, truck.id);

      const result = await clearStop(tx, {
        actorUserId: dispatcher.id,
        request: { truckId: truck.id, loadId, status: 'DELIVERED' },
      });

      return {
        result,
        rowBefore,
        stopsBefore,
        stopsAfter: await stopRows(tx, loadId),
        cacheBefore,
        cacheAfter: await tx.select().from(geocodeCache),
        status: await loadStatus(tx, loadId),
        assignment: (
          await tx
            .select({ ended: assignments.endedAt })
            .from(assignments)
            .where(eq(assignments.truckId, truck.id))
        )[0],
        active: (
          await tx
            .select({ a: trucks.active })
            .from(trucks)
            .where(eq(trucks.id, truck.id))
        )[0]!.a,
        row: await fleetRow(tx, truck.id),
        audit: await auditFor(tx, loadId),
        dispatcherId: dispatcher.id,
        truckId: truck.id,
        anchorAt,
      };
    });

    expect(seen.rowBefore.nextStop?.loadNumber).toBe('LD-4551');
    expect(seen.result).toMatchObject({ status: 'DELIVERED', anchorsCleared: 1 });
    expect(seen.status).toBe('DELIVERED');

    // The record stays; only the anchor goes.
    const [before] = seen.stopsBefore;
    const [after] = seen.stopsAfter;
    expect(after!.arrivedAt).toEqual(before!.arrivedAt);
    expect(after!.arrivedSource).toBe('dispatcher');
    expect(after!.departedAt).toEqual(before!.departedAt);
    expect([
      after!.arrivalAnchorLat,
      after!.arrivalAnchorLng,
      after!.arrivalAnchorAt,
    ]).toEqual([null, null, null]);

    // Nothing else on the stop moved — the address and its geocode above all.
    const {
      arrivalAnchorLat: _a,
      arrivalAnchorLng: _b,
      arrivalAnchorAt: _c,
      ...restAfter
    } = after!;
    const {
      arrivalAnchorLat: _d,
      arrivalAnchorLng: _e,
      arrivalAnchorAt: _f,
      ...restBefore
    } = before!;
    expect(restAfter).toEqual(restBefore);
    expect(seen.cacheAfter).toEqual(seen.cacheBefore);
    expect(seen.cacheAfter[0]!.refusedMatch).toBe(FARGO.refused);

    // Not touched: the driver, the active flag.
    expect(seen.assignment!.ended).toBeNull();
    expect(seen.active).toBe(true);

    // The row reads like any truck with no open load.
    expect(seen.row.nextStop).toBeNull();
    expect(seen.row.openLoadCount).toBe(0);
    expect(seen.row.status).toBe('NO_APPT');

    // One audit row, on the load, with the before state and the choice.
    expect(seen.audit).toHaveLength(1);
    const entry = seen.audit[0]!;
    expect(entry.actor).toBe(seen.dispatcherId);
    expect(entry.after).toMatchObject({
      source: 'operator-clear-stop',
      loadStatus: 'DELIVERED',
      truckId: seen.truckId,
    });
    expect(entry.before).toEqual({
      truckId: seen.truckId,
      loadNumber: 'LD-4551',
      loadStatus: 'DISPATCHED',
      stops: [
        {
          stopId: before!.id,
          sequence: 1,
          type: 'DEL',
          city: 'Fargo',
          state: 'ND',
          arrivedAt: before!.arrivedAt!.toISOString(),
          arrivedSource: 'dispatcher',
          departedAt: null,
          arrivalAnchor: {
            lat: FARGO.lat + 0.001,
            lng: FARGO.lng,
            recordedAtUtc: seen.anchorAt.toISOString(),
          },
        },
      ],
    });
  });

  it('closes every stop of a multi-stop load with it, and records each', async () => {
    const seen = await rolledBack(async (tx) => {
      const { truck, dispatcher } = await world(tx);
      const { loadId } = await addLoad(tx, truck.id, 'PU-DEL', [
        { seq: 1, arrivedAt: hoursAgo(9), departedAt: hoursAgo(8) },
        { seq: 2 },
      ]);
      const stopsBefore = await stopRows(tx, loadId);
      await clearStop(tx, {
        actorUserId: dispatcher.id,
        request: { truckId: truck.id, loadId, status: 'CANCELLED' },
      });
      return {
        stopsBefore,
        stopsAfter: await stopRows(tx, loadId),
        row: await fleetRow(tx, truck.id),
        audit: await auditFor(tx, loadId),
        status: await loadStatus(tx, loadId),
      };
    });

    expect(seen.status).toBe('CANCELLED');
    expect(seen.stopsAfter).toEqual(seen.stopsBefore);
    expect(seen.row.nextStop).toBeNull();
    const before = seen.audit[0]!.before as {
      stops: { sequence: number; type: string }[];
    };
    expect(before.stops.map((s) => [s.sequence, s.type])).toEqual([
      [1, 'PU'],
      [2, 'DEL'],
    ]);
    expect(seen.audit[0]!.after).toMatchObject({
      loadStatus: 'CANCELLED',
      anchorsCleared: [],
    });
  });

  it('on a "+1 load" truck closes only the load it was given', async () => {
    const seen = await rolledBack(async (tx) => {
      const { truck, dispatcher } = await world(tx);
      const keep = await addLoad(tx, truck.id, 'KEEP-1', [{ seq: 1 }]);
      const close = await addLoad(tx, truck.id, 'CLOSE-2', [
        { seq: 1, arrivedAt: hoursAgo(2) },
      ]);
      const rowBefore = await fleetRow(tx, truck.id);
      await clearStop(tx, {
        actorUserId: dispatcher.id,
        request: { truckId: truck.id, loadId: close.loadId, status: 'DELIVERED' },
      });
      return {
        rowBefore,
        row: await fleetRow(tx, truck.id),
        kept: await loadStatus(tx, keep.loadId),
        closed: await loadStatus(tx, close.loadId),
      };
    });

    expect(seen.rowBefore.openLoadCount).toBe(2);
    expect(seen.closed).toBe('DELIVERED');
    expect(seen.kept).toBe('DISPATCHED');
    expect(seen.row.openLoadCount).toBe(1);
    expect(seen.row.nextStop?.loadNumber).toBe('KEEP-1');
  });

  it('refuses a load that is closed, gone, or on another truck — and writes nothing', async () => {
    const seen = await rolledBack(async (tx) => {
      const { truck, dispatcher } = await world(tx);
      const other = await makeTruck(tx);
      const { loadId } = await addLoad(tx, truck.id, 'LD-1', [{ seq: 1 }]);
      const attempt = (request: Parameters<typeof clearStop>[1]['request']) =>
        clearStop(tx, { actorUserId: dispatcher.id, request }).then(
          () => 'cleared',
          (error: unknown) =>
            error instanceof ClearStopError ? error.message : said(error),
        );

      const wrongTruck = await attempt({
        truckId: other.id,
        loadId,
        status: 'DELIVERED',
      });
      const missing = await attempt({
        truckId: truck.id,
        loadId: '00000000-0000-4000-8000-000000000000',
        status: 'DELIVERED',
      });
      await tx.update(loads).set({ status: 'DELIVERED' }).where(eq(loads.id, loadId));
      const closed = await attempt({ truckId: truck.id, loadId, status: 'CANCELLED' });
      return {
        wrongTruck,
        missing,
        closed,
        status: await loadStatus(tx, loadId),
        audit: await auditFor(tx, loadId),
      };
    });

    expect(seen.wrongTruck).toMatch(/no longer on this truck/);
    expect(seen.missing).toMatch(/no longer exists/);
    expect(seen.closed).toBe('That load is already Delivered. Nothing was changed.');
    expect(seen.status).toBe('DELIVERED');
    expect(seen.audit).toEqual([]);
  });

  /**
   * Broken on purpose. A trigger raises from inside the transaction AFTER the
   * load's status has been written — and says so: the exception carries the
   * load's status as the failing statement saw it, so the test proves the
   * close had happened when it failed rather than assuming the order.
   *
   * Two places: the anchor update (the load is closed, nothing else yet) and
   * the audit insert (the load is closed AND the anchors are cleared).
   */
  it.each([
    ['on the anchor update', 'stops', 'update', 'new.load_id'],
    ['on the audit row', 'audit_log', 'insert', 'new.entity_id'],
  ] as const)(
    'fails %s after the load has closed, and leaves the load, its stops and its arrival untouched',
    async (_where, table, event, loadIdExpr) => {
      const seen = await rolledBack(async (tx) => {
        const { truck, dispatcher } = await world(tx);
        const { loadId } = await addLoad(tx, truck.id, 'BREAK-1', [
          {
            seq: 1,
            arrivedAt: hoursAgo(1),
            source: 'dispatcher',
            anchor: { lat: FARGO.lat, lng: FARGO.lng, at: hoursAgo(1) },
          },
        ]);
        const stopsBefore = await stopRows(tx, loadId);

        // Created inside the rolled-back transaction, so it dies with it.
        await tx.execute(
          sql.raw(`
          create function pg_temp.clear_stop_break() returns trigger language plpgsql as $$
          begin
            raise exception 'broken on purpose: load is %',
              (select status from loads where id = ${loadIdExpr});
          end $$;
          create trigger clear_stop_break before ${event} on ${table}
            for each row execute function pg_temp.clear_stop_break();
        `),
        );

        const failure = await clearStop(tx, {
          actorUserId: dispatcher.id,
          request: { truckId: truck.id, loadId, status: 'DELIVERED' },
        }).then(
          () => null,
          (error: unknown) => said(error),
        );

        /**
         * Asked first, because without its own transaction the failure is
         * not contained: the half-done writes and the error land in THIS
         * transaction, which Postgres then refuses to use at all — and a test
         * that only read the state afterwards would fail on "Failed query"
         * and say nothing about why.
         */
        const contained = await tx.execute(sql`select 1`).then(
          () => true,
          () => false,
        );
        if (!contained) return { failure, contained } as const;

        // The trigger is left in place: it fires on writes only, the reads
        // below are unaffected, and the rollback removes it. Dropping it took
        // an exclusive lock on a table the parallel test files write to.
        return {
          contained: true as const,
          failure,
          status: await loadStatus(tx, loadId),
          stopsBefore,
          stopsAfter: await stopRows(tx, loadId),
          audit: await auditFor(tx, loadId),
        };
      });

      // It failed, and it failed with the load already closed.
      expect(seen.failure).toContain('broken on purpose: load is DELIVERED');
      expect(
        seen.contained,
        'the failure escaped clearStop and aborted its caller: the close was not one transaction',
      ).toBe(true);
      if (!seen.contained) return;
      // …and none of it happened.
      expect(seen.status).toBe('DISPATCHED');
      expect(seen.stopsAfter).toEqual(seen.stopsBefore);
      expect(seen.stopsAfter[0]!.arrivedAt).not.toBeNull();
      expect(seen.stopsAfter[0]!.arrivalAnchorAt).not.toBeNull();
      expect(seen.audit).toEqual([]);
    },
  );

  /**
   * The confirm step and the timeline must agree, because the confirm step's
   * sentence is computed by `timelineStay` — the function the timeline query
   * filters with. Checked through the real query, before and after a real
   * clear, in all three cases.
   */
  it.each([
    ['arrived 2 h ago', [{ seq: 1, arrivedAt: 2 }], 'stays'],
    ['arrived 30 h ago', [{ seq: 1, arrivedAt: 30 }], 'leaves'],
    ['never reached', [{ seq: 1 }, { seq: 2 }], 'leaves'],
  ] as const)(
    'the confirm sentence and the timeline agree: %s',
    async (_case, legs, expected) => {
      const seen = await rolledBack(async (tx) => {
        const { truck, dispatcher } = await world(tx);
        const now = new Date();
        const { loadId } = await addLoad(
          tx,
          truck.id,
          'AGREE-1',
          legs.map((l) => ({
            seq: l.seq,
            ...('arrivedAt' in l
              ? { arrivedAt: new Date(now.getTime() - l.arrivedAt * 3_600_000) }
              : {}),
          })),
        );

        // What the confirm step reads and says, exactly as it does.
        const rows = await loadTruckTimeline(tx, truck.id, now);
        const choice = openLoadChoices(rows).find((c) => c.loadId === loadId)!;
        const stay = timelineStay(
          { status: 'DELIVERED', stops: choice.stops },
          now.getTime(),
        );
        const sentence = timelineSentence(stay, TZ);

        await clearStop(tx, {
          actorUserId: dispatcher.id,
          request: { truckId: truck.id, loadId, status: 'DELIVERED' },
        });

        const shows = async (at: Date) =>
          (await loadTruckTimeline(tx, truck.id, at)).some((s) => s.loadId === loadId);
        return {
          beforeClear: rows.some((s) => s.loadId === loadId),
          stay,
          sentence,
          now: await shows(now),
          atUntil: stay.kind === 'until' ? await shows(new Date(stay.untilUtc)) : null,
          pastUntil:
            stay.kind === 'until'
              ? await shows(new Date(Date.parse(stay.untilUtc) + 1))
              : null,
        };
      });

      // Open, it always showed.
      expect(seen.beforeClear).toBe(true);
      if (expected === 'stays') {
        expect(seen.sentence).toMatch(
          /^It stays on the timeline until .+, 24 hours after its last arrival\.$/,
        );
        expect(seen.now).toBe(true);
        expect(seen.atUntil).toBe(true);
        expect(seen.pastUntil).toBe(false);
      } else {
        expect(seen.sentence).toMatch(/^It leaves the timeline now: /);
        expect(seen.now).toBe(false);
      }
    },
  );

  /**
   * §12.85's demonstration, carried one step on: a ZIP-centre stop marked
   * arrived by hand with the truck standing there (so it is anchored), the
   * truck driving away (so the sweep records the departure from the anchor),
   * and then the load cleared. The anchor goes; the arrival and the
   * departure stay as the record.
   */
  it('on a hand-marked ZIP-centre arrival: the anchor goes, arrival and departure stay', async () => {
    const ZIP_CENTRE = { lat: 41.4142, lng: -88.0835 };
    const PARKED = { lat: 41.404141, lng: -88.131737 };
    const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
    const wall = (instant: Date) => {
      const p = Object.fromEntries(
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
          .map((part) => [part.type, part.value]),
      );
      return {
        date: { y: Number(p['year']), m: Number(p['month']), d: Number(p['day']) },
        time: { h: Number(p['hour']), min: Number(p['minute']) },
        tz: TZ,
      };
    };

    const seen = await rolledBack(async (tx) => {
      const truck = await makeTruck(tx);
      const dispatcher = await makeDispatcher(tx);
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
          geocodeAccuracyMiles: 4.4,
          geocodedAt: new Date(),
        })
        .returning({ id: stops.id });
      const stopId = stop!.id;

      // Parked where truck 128 really was, a fix every 30 s.
      for (let s = 25 * 60; s >= 4 * 60; s -= 30) {
        await makePosition(tx, truck.id, {
          ...PARKED,
          speedMph: 0,
          recordedAt: new Date(Date.now() - s * 1000),
        });
      }
      await saveStopEdit(tx as never, {
        actorUserId: dispatcher.id,
        dispatchTz: TZ,
        edit: StopEdit.parse({
          stopId,
          truckId: truck.id,
          loadNumber: 'ELWOOD-1',
          loadStatus: 'DISPATCHED',
          stopType: 'DEL',
          addressLine: '26634 S Walton Dr',
          city: 'Elwood',
          state: 'IL',
          zip: '60421',
          appointment: null,
          dispatcherNote: null,
          arrivedAt: wall(minutesAgo(25)),
        }),
      });
      const [marked] = await stopRows(tx, load!.id);

      // Three minutes south at 50 mph, a fix every 6 s; the sweep sees it leave.
      const milesPerFix = (50 / 3600) * 6;
      for (let s = 180, i = 1; s >= 0; s -= 6, i += 1) {
        await makePosition(tx, truck.id, {
          lat: PARKED.lat - (i * milesPerFix) / 69,
          lng: PARKED.lng,
          speedMph: 50,
          recordedAt: new Date(Date.now() - s * 1000),
        });
      }
      const sweep = await sweepArrivals(tx as never, { info: () => {} });
      const [departed] = await stopRows(tx, load!.id);

      await clearStop(tx, {
        actorUserId: dispatcher.id,
        request: { truckId: truck.id, loadId: load!.id, status: 'DELIVERED' },
      });
      const [cleared] = await stopRows(tx, load!.id);
      return { marked: marked!, sweep, departed: departed!, cleared: cleared! };
    });

    // Anchored where the truck stood, then departed from that anchor.
    expect(seen.marked.arrivedSource).toBe('dispatcher');
    expect(seen.marked.arrivalAnchorLat).toBeCloseTo(PARKED.lat, 6);
    expect(seen.sweep.departed).toBe(1);
    expect(seen.departed.departedAt).not.toBeNull();
    expect(seen.departed.arrivalAnchorAt).not.toBeNull();

    // Cleared: the anchor is gone…
    expect(seen.cleared.arrivalAnchorLat).toBeNull();
    expect(seen.cleared.arrivalAnchorLng).toBeNull();
    expect(seen.cleared.arrivalAnchorAt).toBeNull();
    // …and the record is exactly what it was.
    expect(seen.cleared.arrivedAt).toEqual(seen.departed.arrivedAt);
    expect(seen.cleared.arrivedSource).toBe('dispatcher');
    expect(seen.cleared.departedAt).toEqual(seen.departed.departedAt);
  });
});

/**
 * §12.92 — the save-time question's write: a NEW load saved with
 * `closePrevious` closes the previous load through `clearStop` itself, inside
 * the save's transaction. Addresses are left blank so the save does not
 * geocode — the close is what is under test, not the network.
 */
describeDb('a new load that closes the previous one (§12.92)', () => {
  const newLoad = (
    truckId: string,
    over: Partial<StopEdit> & Record<string, unknown> = {},
  ) =>
    StopEdit.parse({
      stopId: null,
      truckId,
      loadNumber: 'NEXT-1',
      loadStatus: 'DISPATCHED',
      stopType: 'DEL',
      addressLine: null,
      city: null,
      state: null,
      zip: null,
      appointment: null,
      dispatcherNote: null,
      ...over,
    });

  /**
   * The previous load as truck 124 had it: arrived and departed, both
   * detected, no anchor (an anchor belongs to a hand-marked arrival only),
   * and still open.
   */
  const previous = (tx: Tx, truckId: string) =>
    addLoad(tx, truckId, '6612193', [
      { seq: 1, arrivedAt: hoursAgo(2), source: 'detected', departedAt: hoursAgo(1) },
    ]);

  const loadsOn = (tx: Tx, truckId: string) =>
    tx
      .select({ number: loads.loadNumber, status: loads.status })
      .from(loads)
      .where(eq(loads.truckId, truckId))
      // Both loads are written in one transaction, so `created_at` (now())
      // ties and Postgres may return either first — the closed load's UPDATE
      // can move its row after the new one. The number breaks the tie.
      .orderBy(asc(loads.createdAt), asc(loads.loadNumber));

  it.each(['DELIVERED', 'CANCELLED'] as const)(
    'closes it as %s with Clear stop’s own audit row, and creates the new load',
    async (status) => {
      const seen = await rolledBack(async (tx) => {
        const { truck, dispatcher } = await world(tx);
        const { loadId } = await previous(tx, truck.id);
        const stopsBefore = await stopRows(tx, loadId);
        const result = await saveStopEdit(tx as never, {
          actorUserId: dispatcher.id,
          dispatchTz: TZ,
          edit: newLoad(truck.id, { closePrevious: [{ loadId, status }] }),
        });
        const [stopAudit] = await tx
          .select({ after: auditLog.after })
          .from(auditLog)
          .where(eq(auditLog.entityId, result.stopId));
        return {
          loads: await loadsOn(tx, truck.id),
          stopsBefore,
          stopsAfter: await stopRows(tx, loadId),
          closeAudit: await auditFor(tx, loadId),
          stopAudit: stopAudit?.after as { closedPrevious?: unknown },
          row: await fleetRow(tx, truck.id),
          dispatcher: dispatcher.id,
        };
      });

      expect(seen.loads).toEqual([
        { number: '6612193', status },
        { number: 'NEXT-1', status: 'DISPATCHED' },
      ]);
      // Clear stop's rules, because it IS Clear stop: the arrival record kept
      // as it was, and one `operator-clear-stop` row by the dispatcher.
      expect(seen.stopsAfter).toEqual(seen.stopsBefore);
      expect(seen.stopsAfter[0]!.arrivedSource).toBe('detected');
      expect(seen.closeAudit).toHaveLength(1);
      expect(seen.closeAudit[0]!.actor).toBe(seen.dispatcher);
      expect(seen.closeAudit[0]!.after).toMatchObject({
        loadStatus: status,
        source: 'operator-clear-stop',
      });
      // The new stop's own row names what it closed.
      expect(seen.stopAudit.closedPrevious).toEqual([
        { loadId: expect.any(String), status },
      ]);
      // The board: one open load, the new one, as the next stop.
      expect(seen.row.openLoadCount).toBe(1);
      expect(seen.row.nextStop?.loadNumber).toBe('NEXT-1');
    },
  );

  it('"Keep it open" — no closePrevious — closes nothing', async () => {
    const seen = await rolledBack(async (tx) => {
      const { truck, dispatcher } = await world(tx);
      const { loadId } = await previous(tx, truck.id);
      await saveStopEdit(tx as never, {
        actorUserId: dispatcher.id,
        dispatchTz: TZ,
        edit: newLoad(truck.id),
      });
      return {
        loads: await loadsOn(tx, truck.id),
        closeAudit: await auditFor(tx, loadId),
        row: await fleetRow(tx, truck.id),
      };
    });
    expect(seen.loads.map((l) => l.status)).toEqual(['DISPATCHED', 'DISPATCHED']);
    expect(seen.closeAudit).toEqual([]);
    expect(seen.row.openLoadCount).toBe(2);
  });

  it('refuses closePrevious on an edit of an existing stop, and changes nothing', async () => {
    const seen = await rolledBack(async (tx) => {
      const { truck, dispatcher } = await world(tx);
      const { loadId } = await previous(tx, truck.id);
      const other = await addLoad(tx, truck.id, 'OTHER-1', [{ seq: 1 }]);
      const failure = await saveStopEdit(tx as never, {
        actorUserId: dispatcher.id,
        dispatchTz: TZ,
        edit: newLoad(truck.id, {
          stopId: other.stopIds[0]!,
          closePrevious: [{ loadId, status: 'DELIVERED' }],
        }),
      }).then(
        () => null,
        (error: unknown) => said(error),
      );
      return { failure, status: await loadStatus(tx, loadId) };
    });
    expect(seen.failure).toMatch(/only closed when a new load is saved/);
    expect(seen.status).toBe('DISPATCHED');
  });

  it('a previous load closed elsewhere first: refused, and the new load is NOT created', async () => {
    const seen = await rolledBack(async (tx) => {
      const { truck, dispatcher } = await world(tx);
      const { loadId } = await previous(tx, truck.id);
      await clearStop(tx, {
        actorUserId: dispatcher.id,
        request: { truckId: truck.id, loadId, status: 'DELIVERED' },
      });
      const failure = await saveStopEdit(tx as never, {
        actorUserId: dispatcher.id,
        dispatchTz: TZ,
        edit: newLoad(truck.id, { closePrevious: [{ loadId, status: 'CANCELLED' }] }),
      }).then(
        () => null,
        (error: unknown) => error,
      );
      return { failure, loads: await loadsOn(tx, truck.id) };
    });
    expect(seen.failure).toBeInstanceOf(ClearStopError);
    expect((seen.failure as Error).message).toBe(
      'That load is already Delivered. Nothing was changed.',
    );
    expect(seen.loads).toEqual([{ number: '6612193', status: 'DELIVERED' }]);
  });

  /**
   * Broken on purpose, AFTER the close: a trigger raises when the new load's
   * stop is inserted — which happens after `clearStop` has closed the previous
   * load and after the new load row exists. The exception carries the
   * previous load's status as the failing statement saw it, so the test
   * proves the close HAD happened when it failed.
   */
  it('fails after the close, and leaves both untouched', async () => {
    const seen = await rolledBack(async (tx) => {
      const { truck, dispatcher } = await world(tx);
      const { loadId } = await previous(tx, truck.id);
      const stopsBefore = await stopRows(tx, loadId);
      await tx.execute(
        sql.raw(`
        create function pg_temp.new_load_break() returns trigger language plpgsql as $$
        begin
          raise exception 'broken on purpose: previous load is %',
            (select status from loads where id = '${loadId}');
        end $$;
        create trigger new_load_break before insert on stops
          for each row execute function pg_temp.new_load_break();
      `),
      );

      const failure = await saveStopEdit(tx as never, {
        actorUserId: dispatcher.id,
        dispatchTz: TZ,
        edit: newLoad(truck.id, { closePrevious: [{ loadId, status: 'DELIVERED' }] }),
      }).then(
        () => null,
        (error: unknown) => said(error),
      );

      // Without its own transaction the failure would abort THIS one too.
      const contained = await tx.execute(sql`select 1`).then(
        () => true,
        () => false,
      );
      if (!contained) return { failure, contained } as const;
      // Left in place (see above): the rollback removes it.
      return {
        contained: true as const,
        failure,
        loads: await loadsOn(tx, truck.id),
        stopsBefore,
        stopsAfter: await stopRows(tx, loadId),
        audit: await tx.select({ id: auditLog.id }).from(auditLog),
      };
    });

    // It failed, and with the previous load already closed.
    expect(seen.failure).toContain('broken on purpose: previous load is DELIVERED');
    expect(seen.contained, 'the save was not one transaction').toBe(true);
    if (!seen.contained) return;
    // …and none of it happened: still open, no new load, its stop as it was,
    // no audit row of either kind.
    expect(seen.loads).toEqual([{ number: '6612193', status: 'DISPATCHED' }]);
    expect(seen.stopsAfter).toEqual(seen.stopsBefore);
    expect(seen.stopsAfter[0]!.departedAt).not.toBeNull();
    expect(seen.audit).toEqual([]);
  });
});

/**
 * The overwritten-trips fix. A reached stop — arrived, not yet departed, the
 * only reached stop the modal can open — saved with a new city or load
 * number needs the dispatcher's answer: a correction saves as typed; the next
 * trip closes this load as Delivered through `clearStop` and creates a new
 * load, in one transaction. Truck 141 on 2026-09-28 is the case: 12120640
 * detected in at Joliet, then typed over with 200584 Des Plaines.
 *
 * Both addresses are in the geocode cache, so nothing here reaches the
 * network.
 */
describeDb('a reached stop given a new city or number', () => {
  const MOORHEAD = {
    addressLine: '1200 28th Ave S',
    city: 'Moorhead',
    state: 'MN',
    zip: '56560',
    lat: 46.8473,
    lng: -96.7553,
  };

  const cacheMoorhead = (tx: Tx) =>
    tx.insert(geocodeCache).values({
      normalizedAddress: normalizeAddress(MOORHEAD),
      lat: MOORHEAD.lat,
      lng: MOORHEAD.lng,
      precision: 'street',
      confidence: 'census:exact',
      matchedAddress: '1200 28TH AVE S, MOORHEAD, MN, 56560',
      provider: CHAIN_VERSION,
    });

  /**
   * `world()` caches Fargo under an old provider tag, which the geocoder
   * treats as a miss and re-asks the network about. The next trip geocodes
   * its new stop, so here the row has to be current.
   */
  const cacheFargoCurrent = (tx: Tx) =>
    tx
      .update(geocodeCache)
      .set({ provider: CHAIN_VERSION })
      .where(eq(geocodeCache.normalizedAddress, normalizeAddress(FARGO)));

  /** Detected in an hour ago, not departed: the modal's next stop. */
  const reachedLoad = (tx: Tx, truckId: string) =>
    addLoad(tx, truckId, '12120640', [{ seq: 1, arrivedAt: hoursAgo(1), source: 'detected' }]);

  /** The modal's save of that stop, with `over` applied. */
  const editOf = (
    truckId: string,
    stopId: string,
    over: Partial<StopEdit> & Record<string, unknown> = {},
  ) =>
    StopEdit.parse({
      stopId,
      truckId,
      loadNumber: '12120640',
      loadStatus: 'DISPATCHED',
      stopType: 'DEL',
      addressLine: FARGO.addressLine,
      city: FARGO.city,
      state: FARGO.state,
      zip: FARGO.zip,
      appointment: null,
      ...over,
    });

  const nextTrip = {
    loadNumber: '200584',
    stopType: 'PU',
    addressLine: MOORHEAD.addressLine,
    city: MOORHEAD.city,
    state: MOORHEAD.state,
    zip: MOORHEAD.zip,
  } as const;

  const loadsOn = (tx: Tx, truckId: string) =>
    tx
      .select({ id: loads.id, number: loads.loadNumber, status: loads.status })
      .from(loads)
      .where(eq(loads.truckId, truckId))
      // Both loads are written in one transaction, so `created_at` (now())
      // ties and Postgres may return either first — the closed load's UPDATE
      // can move its row after the new one. The number breaks the tie.
      .orderBy(asc(loads.createdAt), asc(loads.loadNumber));

  const allAudit = (tx: Tx) =>
    tx.select({ entity: auditLog.entity, after: auditLog.after }).from(auditLog);

  const attempt = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => error,
    );

  it.each([
    ['a new city', { city: 'Moorhead' }],
    ['a new load number', { loadNumber: '200584' }],
    ['the same city in other capitals', { city: 'FARGO' }],
  ])('refuses %s with no answer, and changes nothing', async (_, over) => {
    const seen = await rolledBack(async (tx) => {
      const { truck, dispatcher } = await world(tx);
      const { loadId, stopIds } = await reachedLoad(tx, truck.id);
      const before = await stopRows(tx, loadId);
      const failure = await attempt(
        saveStopEdit(tx as never, {
          actorUserId: dispatcher.id,
          dispatchTz: TZ,
          edit: editOf(truck.id, stopIds[0]!, over),
        }),
      );
      return {
        failure,
        arrivedAt: before[0]!.arrivedAt!.toISOString(),
        before,
        after: await stopRows(tx, loadId),
        loads: await loadsOn(tx, truck.id),
        audit: await allAudit(tx),
      };
    });
    expect(seen.failure).toBeInstanceOf(ReachedStopError);
    // The modal asks with the arrival the SERVER holds, not its own copy.
    expect((seen.failure as ReachedStopError).arrivedAt).toBe(seen.arrivedAt);
    expect(seen.after).toEqual(seen.before);
    expect(seen.loads.map((l) => [l.number, l.status])).toEqual([['12120640', 'DISPATCHED']]);
    expect(seen.audit).toEqual([]);
  });

  it('saves a stop that was NOT reached without asking', async () => {
    const seen = await rolledBack(async (tx) => {
      const { truck, dispatcher } = await world(tx);
      await cacheMoorhead(tx);
      const { loadId, stopIds } = await addLoad(tx, truck.id, '12120640', [{ seq: 1 }]);
      await saveStopEdit(tx as never, {
        actorUserId: dispatcher.id,
        dispatchTz: TZ,
        edit: editOf(truck.id, stopIds[0]!, nextTrip),
      });
      return { stops: await stopRows(tx, loadId), loads: await loadsOn(tx, truck.id) };
    });
    expect(seen.loads.map((l) => l.number)).toEqual(['200584']);
    expect(seen.stops.map((s) => s.city)).toEqual(['Moorhead']);
  });

  it('saves a reached stop without asking when neither the city nor the number moved', async () => {
    const seen = await rolledBack(async (tx) => {
      const { truck, dispatcher } = await world(tx);
      const { loadId, stopIds } = await reachedLoad(tx, truck.id);
      await saveStopEdit(tx as never, {
        actorUserId: dispatcher.id,
        dispatchTz: TZ,
        edit: editOf(truck.id, stopIds[0]!, { dispatcherNote: 'dock 4' }),
      });
      return await stopRows(tx, loadId);
    });
    expect(seen[0]!.dispatcherNote).toBe('dock 4');
    expect(seen[0]!.arrivedAt).not.toBeNull();
  });

  it('"Correction": saves as typed, on the same stop and load', async () => {
    const seen = await rolledBack(async (tx) => {
      const { truck, dispatcher } = await world(tx);
      await cacheMoorhead(tx);
      const { loadId, stopIds } = await reachedLoad(tx, truck.id);
      const result = await saveStopEdit(tx as never, {
        actorUserId: dispatcher.id,
        dispatchTz: TZ,
        edit: editOf(truck.id, stopIds[0]!, { ...nextTrip, reachedStop: 'correction' }),
      });
      return {
        result,
        loadId,
        stopId: stopIds[0]!,
        stops: await stopRows(tx, loadId),
        loads: await loadsOn(tx, truck.id),
      };
    });
    expect(seen.result.stopId).toBe(seen.stopId);
    expect(seen.result.loadId).toBe(seen.loadId);
    expect(seen.loads.map((l) => [l.number, l.status])).toEqual([['200584', 'DISPATCHED']]);
    expect(seen.stops[0]).toMatchObject({ city: 'Moorhead', type: 'PU' });
    // §12.85, unchanged: a new address is a new place, so the arrival goes.
    expect(seen.stops[0]!.arrivedAt).toBeNull();
  });

  it('"Next trip": closes this load as Delivered, keeps its stop as reached, and creates the new load unreached', async () => {
    const seen = await rolledBack(async (tx) => {
      const { truck, dispatcher } = await world(tx);
      await cacheMoorhead(tx);
      const { loadId, stopIds } = await reachedLoad(tx, truck.id);
      const before = await stopRows(tx, loadId);
      const result = await saveStopEdit(tx as never, {
        actorUserId: dispatcher.id,
        dispatchTz: TZ,
        edit: editOf(truck.id, stopIds[0]!, { ...nextTrip, reachedStop: 'next-trip' }),
      });
      const [newStop] = await tx.select().from(stops).where(eq(stops.id, result.stopId));
      const [newStopAudit] = await tx
        .select({ before: auditLog.before, after: auditLog.after })
        .from(auditLog)
        .where(eq(auditLog.entityId, result.stopId));
      return {
        loadId,
        result,
        before,
        after: await stopRows(tx, loadId),
        newStop: newStop!,
        newStopAudit: newStopAudit!,
        closeAudit: await auditFor(tx, loadId),
        loads: await loadsOn(tx, truck.id),
        row: await fleetRow(tx, truck.id),
        dispatcher: dispatcher.id,
      };
    });

    expect(seen.loads.map((l) => [l.number, l.status])).toEqual([
      ['12120640', 'DELIVERED'],
      ['200584', 'DISPATCHED'],
    ]);
    expect(seen.result.loadId).not.toBe(seen.loadId);
    // The trip that happened is still on the record, exactly as it was.
    expect(seen.after).toEqual(seen.before);
    expect(seen.after[0]!.arrivedAt).not.toBeNull();
    // The new trip starts where nothing has been reached yet.
    expect(seen.newStop).toMatchObject({
      sequence: 1,
      type: 'PU',
      city: 'Moorhead',
      lat: MOORHEAD.lat,
      lng: MOORHEAD.lng,
      arrivedAt: null,
      departedAt: null,
    });
    // Clear stop's own audit row, by the dispatcher, and the new stop's row
    // naming what it closed.
    expect(seen.closeAudit).toHaveLength(1);
    expect(seen.closeAudit[0]!.actor).toBe(seen.dispatcher);
    expect(seen.closeAudit[0]!.after).toMatchObject({
      loadStatus: 'DELIVERED',
      source: 'operator-clear-stop',
    });
    expect(seen.newStopAudit.before).toBeNull();
    expect(seen.newStopAudit.after).toMatchObject({
      nextTripAfter: { loadId: seen.loadId, status: 'DELIVERED' },
    });
    expect(seen.row.openLoadCount).toBe(1);
    expect(seen.row.nextStop?.loadNumber).toBe('200584');
  });

  it('"Next trip" with only the number changed: the new stop is located at the same address', async () => {
    const seen = await rolledBack(async (tx) => {
      const { truck, dispatcher } = await world(tx);
      await cacheFargoCurrent(tx);
      const { stopIds } = await reachedLoad(tx, truck.id);
      const result = await saveStopEdit(tx as never, {
        actorUserId: dispatcher.id,
        dispatchTz: TZ,
        edit: editOf(truck.id, stopIds[0]!, { loadNumber: '200584', reachedStop: 'next-trip' }),
      });
      return (await tx.select().from(stops).where(eq(stops.id, result.stopId)))[0]!;
    });
    expect(seen).toMatchObject({ city: 'Fargo', lat: FARGO.lat, lng: FARGO.lng, arrivedAt: null });
  });

  /**
   * Broken on purpose, AFTER the close: a trigger raises when the new stop is
   * inserted, reporting the reached load's status as the failing statement
   * saw it — so the test proves the close had happened when it failed.
   */
  it('"Next trip" that fails after the close leaves everything as it was', async () => {
    const seen = await rolledBack(async (tx) => {
      const { truck, dispatcher } = await world(tx);
      await cacheMoorhead(tx);
      const { loadId, stopIds } = await reachedLoad(tx, truck.id);
      const before = await stopRows(tx, loadId);
      await tx.execute(
        sql.raw(`
        create function pg_temp.next_trip_break() returns trigger language plpgsql as $$
        begin
          raise exception 'broken on purpose: reached load is %',
            (select status from loads where id = '${loadId}');
        end $$;
        create trigger next_trip_break before insert on stops
          for each row execute function pg_temp.next_trip_break();
      `),
      );
      const failure = await saveStopEdit(tx as never, {
        actorUserId: dispatcher.id,
        dispatchTz: TZ,
        edit: editOf(truck.id, stopIds[0]!, { ...nextTrip, reachedStop: 'next-trip' }),
      }).then(
        () => null,
        (error: unknown) => said(error),
      );
      const contained = await tx.execute(sql`select 1`).then(
        () => true,
        () => false,
      );
      if (!contained) return { failure, contained } as const;
      return {
        contained: true as const,
        failure,
        before,
        after: await stopRows(tx, loadId),
        loads: await loadsOn(tx, truck.id),
        audit: await allAudit(tx),
      };
    });
    expect(seen.failure).toContain('broken on purpose: reached load is DELIVERED');
    expect(seen.contained, 'the save was not one transaction').toBe(true);
    if (!seen.contained) return;
    expect(seen.loads.map((l) => [l.number, l.status])).toEqual([['12120640', 'DISPATCHED']]);
    expect(seen.after).toEqual(seen.before);
    expect(seen.audit).toEqual([]);
  });
});
