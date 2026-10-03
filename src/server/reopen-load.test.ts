import { expect, it } from 'vitest';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { auditLog, loads, stops, trucks } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import { assign, makeDispatcher, makeDriver, makePosition, makeTruck } from '@/test/fleet';
import { REOPEN_AUDIT_SOURCE } from '@/lib/reopen-load';
import { StopEdit } from '@/lib/stop-edit';
import { clearStop } from './clear-stop';
import { recentlyClosed, reopenLoad, ReopenError } from './reopen-load';
import { saveStopEdit } from './stop-edit';
import { writeAudit, type Tx } from './audit';

/**
 * §12.107 — Reopen load against the real database, inside transactions that
 * always roll back. Loads are closed the real way (Clear stop, the edit
 * modal), so the close entries read here are the ones production writes.
 */

const TZ = 'America/Chicago';
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
/** A ZIP centre and a street point, both in Fargo; the truck parks on the first. */
const ZIP = { lat: 46.9217, lng: -96.8311 };
const STREET = { lat: 46.8772, lng: -96.7898 };

interface Leg {
  seq: number;
  precision?: 'street' | 'block' | 'zip' | null;
  arrivedAt?: Date;
  source?: 'detected' | 'dispatcher';
  departedAt?: Date;
  anchor?: { lat: number; lng: number; at: Date };
}

async function addLoad(tx: Tx, truckId: string, loadNumber: string | null, legs: Leg[], status = 'AT_RECEIVER') {
  const [load] = await tx
    .insert(loads)
    .values({ truckId, loadNumber, status: status as 'AT_RECEIVER' })
    .returning({ id: loads.id });
  const stopIds: string[] = [];
  for (const leg of legs) {
    const precision = leg.precision === undefined ? 'zip' : leg.precision;
    const point = precision === 'street' ? STREET : ZIP;
    const [row] = await tx
      .insert(stops)
      .values({
        loadId: load!.id,
        type: leg.seq === 1 && legs.length > 1 ? 'PU' : 'DEL',
        sequence: leg.seq,
        city: 'Fargo',
        state: 'ND',
        zip: '58102',
        lat: precision === null ? null : point.lat,
        lng: precision === null ? null : point.lng,
        geocodePrecision: precision,
        geocodedAt: precision === null ? null : hoursAgo(48),
        arrivedAt: leg.arrivedAt ?? null,
        arrivedSource: leg.arrivedAt ? (leg.source ?? 'dispatcher') : null,
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

async function world(tx: Tx, at: { lat: number; lng: number } = ZIP) {
  const truck = await makeTruck(tx);
  await assign(tx, truck.id, (await makeDriver(tx)).id);
  const dispatcher = await makeDispatcher(tx, 'Dee Dispatcher');
  await makePosition(tx, truck.id, { ...at, speedMph: 0, recordedAt: hoursAgo(0.1) });
  return { truck, dispatcher };
}

const stopRows = (tx: Tx, loadId: string) =>
  tx.select().from(stops).where(eq(stops.loadId, loadId)).orderBy(asc(stops.sequence));
const statusOf = async (tx: Tx, loadId: string) =>
  (await tx.select({ s: loads.status }).from(loads).where(eq(loads.id, loadId)))[0]!.s;
const reopenEntries = (tx: Tx, loadId: string) =>
  tx
    .select({ actor: auditLog.actorUserId, before: auditLog.before, after: auditLog.after })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entity, 'load'),
        eq(auditLog.entityId, loadId),
        sql`${auditLog.after}->>'source' = ${REOPEN_AUDIT_SOURCE}`,
      ),
    );
async function closeIdOf(tx: Tx, loadId: string): Promise<string> {
  const [row] = await tx
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(and(eq(auditLog.entityId, loadId), sql`${auditLog.after}->>'source' = 'operator-clear-stop'`))
    .orderBy(desc(auditLog.createdAt))
    .limit(1);
  return row!.id;
}

/** Closes with Clear stop and reopens what it closed; returns everything a test reads. */
async function closeAndReopen(tx: Tx, legs: Leg[], options: { at?: { lat: number; lng: number } } = {}) {
  const { truck, dispatcher } = await world(tx, options.at);
  const { loadId, stopIds } = await addLoad(tx, truck.id, 'LD-1', legs);
  const before = await stopRows(tx, loadId);
  await clearStop(tx, { actorUserId: dispatcher.id, request: { truckId: truck.id, loadId, status: 'DELIVERED' } });
  const closed = await stopRows(tx, loadId);
  const listed = await recentlyClosed(tx as never, truck.id);
  const result = await reopenLoad(tx, {
    actorUserId: dispatcher.id,
    request: { truckId: truck.id, loadId, closeAuditId: await closeIdOf(tx, loadId) },
    dispatchTz: TZ,
  });
  return {
    truck,
    dispatcher,
    loadId,
    stopIds,
    before,
    closed,
    listed,
    result,
    after: await stopRows(tx, loadId),
    status: await statusOf(tx, loadId),
    audit: await reopenEntries(tx, loadId),
  };
}

/** Everything about a stop except the anchor, which is the only thing a reopen may write. */
const withoutAnchor = (rows: Awaited<ReturnType<typeof stopRows>>) =>
  rows.map(({ arrivalAnchorLat: _a, arrivalAnchorLng: _b, arrivalAnchorAt: _c, ...rest }) => rest);

describeDb('Reopen load (§12.107)', () => {
  it('returns the load to the status before the close, and changes nothing else', async () => {
    const seen = await rolledBack((tx) =>
      closeAndReopen(tx, [{ seq: 1, arrivedAt: hoursAgo(2), source: 'detected', departedAt: hoursAgo(1), precision: 'street' }]),
    );
    expect(seen.status).toBe('AT_RECEIVER');
    expect(seen.result.status).toBe('AT_RECEIVER');
    // Arrival, departure, source, address and geocode: identical, column for column.
    expect(seen.after).toEqual(seen.before);
    expect(seen.audit).toHaveLength(1);
    const entry = seen.audit[0]!;
    expect(entry.actor).toBe(seen.dispatcher.id);
    expect(entry.before).toMatchObject({ loadStatus: 'DELIVERED', closeAuditId: expect.any(String) });
    expect(entry.after).toMatchObject({
      loadStatus: 'AT_RECEIVER',
      source: REOPEN_AUDIT_SOURCE,
      statusFrom: 'close-record',
      anchorsRestored: [],
      anchorsMissing: [],
      lateDepartureWarned: [],
      otherOpenLoads: [],
    });
    expect((entry.after as { reopenOf: string }).reopenOf).toBe((entry.before as { closeAuditId: string }).closeAuditId);
  });

  it('restores the anchor of a hand-marked, undeparted ZIP stop from the close entry', async () => {
    const anchorAt = hoursAgo(1);
    const seen = await rolledBack((tx) =>
      closeAndReopen(tx, [{ seq: 1, arrivedAt: hoursAgo(1), anchor: { ...ZIP, at: anchorAt } }]),
    );
    expect(seen.closed[0]!.arrivalAnchorAt).toBeNull(); // Clear stop cleared it…
    expect(seen.after[0]!.arrivalAnchorLat).toBe(ZIP.lat); // …and it is back, exactly.
    expect(seen.after[0]!.arrivalAnchorLng).toBe(ZIP.lng);
    expect(seen.after[0]!.arrivalAnchorAt?.toISOString()).toBe(anchorAt.toISOString());
    expect(withoutAnchor(seen.after)).toEqual(withoutAnchor(seen.before));
    expect(seen.listed[0]!.restored).toEqual([{ stopId: seen.stopIds[0], place: 'Fargo, ND' }]);
    expect((seen.audit[0]!.after as { anchorsRestored: unknown[] }).anchorsRestored).toEqual([
      { stopId: seen.stopIds[0], lat: ZIP.lat, lng: ZIP.lng, recordedAtUtc: anchorAt.toISOString() },
    ]);
  });

  it('restores an unlocated stop’s anchor too', async () => {
    const seen = await rolledBack((tx) =>
      closeAndReopen(tx, [{ seq: 1, precision: null, arrivedAt: hoursAgo(1), anchor: { ...ZIP, at: hoursAgo(1) } }]),
    );
    expect(seen.after[0]!.arrivalAnchorLat).toBe(ZIP.lat);
  });

  it('with no anchor in the close entry: reopens, leaves it empty, and says so', async () => {
    const seen = await rolledBack((tx) => closeAndReopen(tx, [{ seq: 1, arrivedAt: hoursAgo(1) }]));
    expect(seen.status).toBe('AT_RECEIVER');
    expect(seen.after[0]!.arrivalAnchorAt).toBeNull();
    expect(seen.listed[0]!.missing).toEqual([{ stopId: seen.stopIds[0], place: 'Fargo, ND' }]);
    expect((seen.audit[0]!.after as { anchorsMissing: string[] }).anchorsMissing).toEqual([seen.stopIds[0]]);
  });

  it('does not restore the anchor of a stop that already departed', async () => {
    const seen = await rolledBack((tx) =>
      closeAndReopen(tx, [
        { seq: 1, arrivedAt: hoursAgo(3), departedAt: hoursAgo(2), anchor: { ...ZIP, at: hoursAgo(3) } },
      ]),
    );
    expect(seen.after[0]!.arrivalAnchorAt).toBeNull();
    expect(seen.after[0]!.departedAt).toEqual(seen.before[0]!.departedAt);
    expect(seen.listed[0]!.restored).toEqual([]);
    expect(seen.listed[0]!.missing).toEqual([]);
  });

  it('does not restore the anchor of a street stop: its departure is measured from the stop', async () => {
    const seen = await rolledBack((tx) =>
      closeAndReopen(
        tx,
        [{ seq: 1, precision: 'street', arrivedAt: hoursAgo(1), anchor: { ...STREET, at: hoursAgo(1) } }],
        { at: STREET },
      ),
    );
    expect(seen.after[0]!.arrivalAnchorAt).toBeNull();
    expect(seen.listed[0]!.restored).toEqual([]);
    expect(seen.listed[0]!.missing).toEqual([]);
  });

  it('warns when the truck has driven away: the departure will be recorded late', async () => {
    // Parked 40 miles south of the anchor.
    const seen = await rolledBack((tx) =>
      closeAndReopen(tx, [{ seq: 1, arrivedAt: hoursAgo(3), anchor: { ...ZIP, at: hoursAgo(3) } }], {
        at: { lat: ZIP.lat - 0.6, lng: ZIP.lng },
      }),
    );
    expect(seen.listed[0]!.late).toEqual([{ stopId: seen.stopIds[0], place: 'Fargo, ND' }]);
    expect((seen.audit[0]!.after as { lateDepartureWarned: string[] }).lateDepartureWarned).toEqual([seen.stopIds[0]]);
    // Warned, not acted on: no departure is written by the reopen.
    expect(seen.after[0]!.departedAt).toBeNull();
  });

  it('no late warning while the truck is still at the stop', async () => {
    const seen = await rolledBack((tx) =>
      closeAndReopen(tx, [{ seq: 1, arrivedAt: hoursAgo(1), anchor: { ...ZIP, at: hoursAgo(1) } }]),
    );
    expect(seen.listed[0]!.late).toEqual([]);
  });

  it('a load closed in the edit modal kept its anchor, and goes back to its recorded status', async () => {
    const seen = await rolledBack(async (tx) => {
      const { truck, dispatcher } = await world(tx);
      const arrived = new Date(Math.floor(hoursAgo(1).getTime() / 60_000) * 60_000);
      const { loadId, stopIds } = await addLoad(tx, truck.id, 'EDIT-1', [
        { seq: 1, arrivedAt: arrived, anchor: { ...ZIP, at: arrived } },
      ]);
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', {
          timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
        })
          .formatToParts(arrived)
          .map((p) => [p.type, p.value]),
      );
      await saveStopEdit(tx as never, {
        actorUserId: dispatcher.id,
        dispatchTz: TZ,
        edit: StopEdit.parse({
          stopId: stopIds[0],
          truckId: truck.id,
          loadNumber: 'EDIT-1',
          loadStatus: 'DELIVERED',
          stopType: 'DEL',
          addressLine: null,
          city: 'Fargo',
          state: 'ND',
          zip: '58102',
          appointment: null,
          dispatcherNote: null,
          arrivedAt: {
            date: { y: Number(parts['year']), m: Number(parts['month']), d: Number(parts['day']) },
            time: { h: Number(parts['hour']), min: Number(parts['minute']) },
            tz: TZ,
          },
        }),
      });
      const closed = await stopRows(tx, loadId);
      const listed = await recentlyClosed(tx as never, truck.id);
      await reopenLoad(tx, {
        actorUserId: dispatcher.id,
        request: { truckId: truck.id, loadId, closeAuditId: listed[0]!.close.closeAuditId },
        dispatchTz: TZ,
      });
      return { closed, listed, status: await statusOf(tx, loadId), after: await stopRows(tx, loadId) };
    });
    expect(seen.closed[0]!.arrivalAnchorAt).not.toBeNull();
    expect(seen.listed[0]!.close.statusBefore).toBe('AT_RECEIVER');
    expect(seen.listed[0]!.restored).toEqual([]);
    expect(seen.listed[0]!.missing).toEqual([]);
    expect(seen.status).toBe('AT_RECEIVER');
    expect(seen.after).toEqual(seen.closed.map((s) => ({ ...s })));
  });

  it('cannot be reopened twice: the second is told who reopened it', async () => {
    const message = await rolledBack(async (tx) => {
      const { truck, dispatcher, loadId } = await closeAndReopen(tx, [{ seq: 1 }]);
      const [first] = await reopenEntries(tx, loadId);
      return reopenLoad(tx, {
        actorUserId: dispatcher.id,
        request: { truckId: truck.id, loadId, closeAuditId: (first!.before as { closeAuditId: string }).closeAuditId },
        dispatchTz: TZ,
      }).then(
        () => 'reopened twice',
        (e: unknown) => (e instanceof ReopenError ? e.message : String(e)),
      );
    });
    expect(message).toMatch(/^Already reopened by Dee Dispatcher at .+\. Nothing was changed\.$/);
  });

  it('refuses a close nobody looked at: closed again since', async () => {
    const message = await rolledBack(async (tx) => {
      const { truck, dispatcher, loadId } = await closeAndReopen(tx, [{ seq: 1 }]);
      const [first] = await reopenEntries(tx, loadId);
      const stale = (first!.before as { closeAuditId: string }).closeAuditId;
      /*
       * One test transaction gives every row the same now(), so the second
       * close would tie the first on created_at. In production each close is
       * its own transaction and its own time; here the first is made earlier.
       */
      await tx.execute(sql`update audit_log set created_at = created_at - interval '1 minute' where entity_id = ${loadId}`);
      await clearStop(tx, { actorUserId: dispatcher.id, request: { truckId: truck.id, loadId, status: 'CANCELLED' } });
      return reopenLoad(tx, {
        actorUserId: dispatcher.id,
        request: { truckId: truck.id, loadId, closeAuditId: stale },
        dispatchTz: TZ,
      }).then(
        () => 'reopened',
        (e: unknown) => (e instanceof ReopenError ? e.message : String(e)),
      );
    });
    expect(message).toBe('This load was closed again since you opened this. Nothing was changed.');
  });

  it('refuses a close older than 7 days, and does not list it', async () => {
    const seen = await rolledBack(async (tx) => {
      const { truck, dispatcher } = await world(tx);
      const { loadId } = await addLoad(tx, truck.id, 'OLD-1', [{ seq: 1 }]);
      await clearStop(tx, { actorUserId: dispatcher.id, request: { truckId: truck.id, loadId, status: 'DELIVERED' } });
      const later = new Date(Date.now() + 7 * 86_400_000 + 60_000);
      return {
        listed: await recentlyClosed(tx as never, truck.id, later),
        message: await reopenLoad(tx, {
          actorUserId: dispatcher.id,
          request: { truckId: truck.id, loadId, closeAuditId: await closeIdOf(tx, loadId) },
          dispatchTz: TZ,
          now: later,
        }).then(
          () => 'reopened',
          (e: unknown) => (e instanceof ReopenError ? e.message : String(e)),
        ),
        status: await statusOf(tx, loadId),
      };
    });
    expect(seen.listed).toEqual([]);
    expect(seen.message).toBe('This load was closed more than 7 days ago. Nothing was changed.');
    expect(seen.status).toBe('DELIVERED');
  });

  it('refuses an inactive truck', async () => {
    const message = await rolledBack(async (tx) => {
      const { truck, dispatcher } = await world(tx);
      const { loadId } = await addLoad(tx, truck.id, 'INACT-1', [{ seq: 1 }]);
      await clearStop(tx, { actorUserId: dispatcher.id, request: { truckId: truck.id, loadId, status: 'DELIVERED' } });
      await tx.update(trucks).set({ active: false }).where(eq(trucks.id, truck.id));
      return reopenLoad(tx, {
        actorUserId: dispatcher.id,
        request: { truckId: truck.id, loadId, closeAuditId: await closeIdOf(tx, loadId) },
        dispatchTz: TZ,
      }).then(
        () => 'reopened',
        (e: unknown) => (e instanceof ReopenError ? e.message : String(e)),
      );
    });
    expect(message).toBe('This truck is inactive. Nothing was changed.');
  });

  it('when the close does not say the status before, the dispatcher must choose one', async () => {
    const seen = await rolledBack(async (tx) => {
      const { truck, dispatcher } = await world(tx);
      // A load the edit modal created already closed: its entry has no "before".
      const { loadId, stopIds } = await addLoad(tx, truck.id, 'NOSTAT-1', [{ seq: 1 }], 'DELIVERED');
      await writeAudit(tx, {
        actorUserId: dispatcher.id,
        entity: 'stop',
        entityId: stopIds[0]!,
        before: null,
        after: { loadId, loadStatus: 'DELIVERED', source: 'edit-modal' },
      });
      const listed = await recentlyClosed(tx as never, truck.id);
      const closeAuditId = listed[0]!.close.closeAuditId;
      const refused = await reopenLoad(tx, {
        actorUserId: dispatcher.id,
        request: { truckId: truck.id, loadId, closeAuditId },
        dispatchTz: TZ,
      }).then(
        () => 'reopened',
        (e: unknown) => (e instanceof ReopenError ? e.message : String(e)),
      );
      await reopenLoad(tx, {
        actorUserId: dispatcher.id,
        request: { truckId: truck.id, loadId, closeAuditId, status: 'LOADED' },
        dispatchTz: TZ,
      });
      return { listed, refused, status: await statusOf(tx, loadId), audit: await reopenEntries(tx, loadId) };
    });
    expect(seen.listed[0]!.close.statusBefore).toBeNull();
    expect(seen.refused).toBe('Choose the status the load goes back to. Nothing was changed.');
    expect(seen.status).toBe('LOADED');
    expect(seen.audit[0]!.after).toMatchObject({ loadStatus: 'LOADED', statusFrom: 'chosen' });
  });

  it('the +1 load case and a load entered after the close are named, and not changed', async () => {
    const seen = await rolledBack(async (tx) => {
      const { truck, dispatcher } = await world(tx);
      const older = await addLoad(tx, truck.id, 'OPEN-OLD', [{ seq: 1 }], 'DISPATCHED');
      await tx.update(loads).set({ createdAt: hoursAgo(5) }).where(eq(loads.id, older.loadId));
      const { loadId } = await addLoad(tx, truck.id, 'CLOSED-1', [{ seq: 1 }]);
      await clearStop(tx, { actorUserId: dispatcher.id, request: { truckId: truck.id, loadId, status: 'DELIVERED' } });
      // Entered after the close, as Next trip does.
      const newer = await addLoad(tx, truck.id, 'NEXT-1', [{ seq: 1 }], 'DISPATCHED');
      await tx.update(loads).set({ createdAt: new Date(Date.now() + 1_000) }).where(eq(loads.id, newer.loadId));
      const listed = await recentlyClosed(tx as never, truck.id);
      await reopenLoad(tx, {
        actorUserId: dispatcher.id,
        request: { truckId: truck.id, loadId, closeAuditId: listed[0]!.close.closeAuditId },
        dispatchTz: TZ,
      });
      return {
        listed,
        statuses: await tx.select({ n: loads.loadNumber, s: loads.status }).from(loads).where(eq(loads.truckId, truck.id)).orderBy(asc(loads.loadNumber)),
        audit: await reopenEntries(tx, loadId),
        ids: { older: older.loadId, newer: newer.loadId },
      };
    });
    expect(seen.listed[0]!.others.map((o) => o.loadNumber)).toEqual(['OPEN-OLD', 'NEXT-1']);
    expect(seen.statuses).toEqual([
      { n: 'CLOSED-1', s: 'AT_RECEIVER' },
      { n: 'NEXT-1', s: 'DISPATCHED' },
      { n: 'OPEN-OLD', s: 'DISPATCHED' },
    ]);
    expect((seen.audit[0]!.after as { otherOpenLoads: string[] }).otherOpenLoads).toEqual([seen.ids.older, seen.ids.newer]);
  });

  it('lists nothing for a truck with no load closed in the last 7 days', async () => {
    const listed = await rolledBack(async (tx) => {
      const { truck } = await world(tx);
      await addLoad(tx, truck.id, 'OPEN-1', [{ seq: 1 }], 'DISPATCHED');
      return recentlyClosed(tx as never, truck.id);
    });
    expect(listed).toEqual([]);
  });

  /**
   * Rollback. A trigger raises on the reopen's audit insert — after the
   * status and the anchors have been written, and it says so. Afterwards the
   * load is still closed, the anchor still empty, and there is no entry.
   */
  it('fails on the audit row after writing, and leaves the load closed and its anchors empty', async () => {
    const seen = await rolledBack(async (tx) => {
      const { truck, dispatcher } = await world(tx);
      const { loadId } = await addLoad(tx, truck.id, 'BREAK-1', [
        { seq: 1, arrivedAt: hoursAgo(1), anchor: { ...ZIP, at: hoursAgo(1) } },
      ]);
      await clearStop(tx, { actorUserId: dispatcher.id, request: { truckId: truck.id, loadId, status: 'DELIVERED' } });
      const closeAuditId = await closeIdOf(tx, loadId);
      const closed = await stopRows(tx, loadId);
      await tx.execute(
        sql.raw(`
        create function pg_temp.reopen_break() returns trigger language plpgsql as $$
        begin
          if new.after->>'source' = '${REOPEN_AUDIT_SOURCE}' then
            raise exception 'broken on purpose: load is %, anchor %',
              (select status from loads where id = new.entity_id),
              (select arrival_anchor_lat from stops where load_id = new.entity_id limit 1);
          end if;
          return new;
        end $$;
        create trigger reopen_break before insert on audit_log
          for each row execute function pg_temp.reopen_break();
      `),
      );
      const failure = await reopenLoad(tx, {
        actorUserId: dispatcher.id,
        request: { truckId: truck.id, loadId, closeAuditId },
        dispatchTz: TZ,
      }).then(
        () => null,
        (e: unknown) => (e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? '')}` : String(e)),
      );
      const contained = await tx.execute(sql`select 1`).then(
        () => true,
        () => false,
      );
      if (!contained) return { failure, contained } as const;
      return {
        contained: true as const,
        failure,
        status: await statusOf(tx, loadId),
        closed,
        after: await stopRows(tx, loadId),
        audit: await reopenEntries(tx, loadId),
      };
    });
    // It failed with the status and the anchor already written…
    expect(seen.failure).toContain(`broken on purpose: load is AT_RECEIVER, anchor ${ZIP.lat}`);
    expect(seen.contained, 'the failure escaped reopenLoad: not one transaction').toBe(true);
    if (!seen.contained) return;
    // …and none of it happened.
    expect(seen.status).toBe('DELIVERED');
    expect(seen.after).toEqual(seen.closed);
    expect(seen.after[0]!.arrivalAnchorAt).toBeNull();
    expect(seen.audit).toEqual([]);
  });
});
