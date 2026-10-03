import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { loads, positions, stops, trucks } from '@/db/schema';
import { dispatchTime } from '@/lib/clear-stop';
import { isTerminal, type LoadStatus } from '@/lib/loads';
import {
  REOPEN_AUDIT_SOURCE,
  REOPEN_WINDOW_MS,
  lateDepartures,
  planAnchors,
  readClose,
  type AnchorPlan,
  type CloseRecord,
  type OtherOpenLoad,
  type RecentlyClosed,
  type ReopenRequest,
  type ReopenStop,
} from '@/lib/reopen-load';
import { writeAudit, type Db, type Tx, type Writer } from './audit';

/**
 * §12.107 — Reopen load. The rules are `lib/reopen-load.ts`; this reads what
 * they need and writes what they decide, in one transaction.
 *
 * Reads `audit_log`, which the history page deliberately does not (§12.15):
 * the close's record is the only place its time, its author, the status
 * before it and the cleared anchors are kept. This is a write path checking
 * its own precondition, not a display of the log.
 */

export class ReopenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReopenError';
  }
}

const TERMINAL_SQL = sql`('DELIVERED', 'TONU', 'CANCELLED')`;

/** The newest close of each load, by load id. */
async function newestCloses(db: Writer, loadIds: readonly string[]): Promise<Map<string, CloseRecord>> {
  if (loadIds.length === 0) return new Map();
  const ids = sql.join(loadIds.map((id) => sql`${id}`), sql`, `);
  const rows = (await db.execute(sql`
    select a.id, a.entity, a.before, a.after,
           to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
           p.full_name as actor_name,
           case when a.entity = 'load' then a.entity_id::text else a.after->>'loadId' end as load_id
      from audit_log a
      left join profiles p on p.id = a.actor_user_id
     where a.after->>'loadStatus' in ${TERMINAL_SQL}
       and ((a.entity = 'load' and a.entity_id::text in (${ids}))
         or (a.entity = 'stop' and a.after->>'loadId' in (${ids})))
     order by a.created_at desc, a.id desc
  `)) as unknown as {
    id: string;
    entity: string;
    before: unknown;
    after: unknown;
    created_at: string;
    actor_name: string | null;
    load_id: string;
  }[];
  const found = new Map<string, CloseRecord>();
  for (const row of rows) {
    if (found.has(row.load_id)) continue;
    const close = readClose({
      id: row.id,
      entity: row.entity,
      createdAt: row.created_at,
      actorName: row.actor_name,
      before: row.before,
      after: row.after,
    });
    if (close) found.set(row.load_id, close);
  }
  return found;
}

async function loadStops(db: Writer, loadId: string, lock: boolean): Promise<ReopenStop[]> {
  const query = db
    .select({
      stopId: stops.id,
      type: stops.type,
      city: stops.city,
      state: stops.state,
      lat: stops.lat,
      lng: stops.lng,
      precision: stops.geocodePrecision,
      arrivedAt: stops.arrivedAt,
      arrivedSource: stops.arrivedSource,
      departedAt: stops.departedAt,
      anchorLat: stops.arrivalAnchorLat,
      anchorLng: stops.arrivalAnchorLng,
      anchorAt: stops.arrivalAnchorAt,
    })
    .from(stops)
    .where(eq(stops.loadId, loadId))
    .orderBy(asc(stops.sequence));
  const rows = lock ? await query.for('update') : await query;
  return rows.map((r) => ({
    stopId: r.stopId,
    place:
      r.city && r.state ? `${r.city}, ${r.state}` : (r.city ?? (r.type === 'PU' ? 'The pickup' : 'The delivery')),
    lat: r.lat,
    lng: r.lng,
    precision: r.precision,
    arrivedAt: r.arrivedAt?.toISOString() ?? null,
    arrivedSource: r.arrivedSource,
    departedAt: r.departedAt?.toISOString() ?? null,
    anchor:
      r.anchorLat !== null && r.anchorLng !== null && r.anchorAt !== null
        ? { lat: r.anchorLat, lng: r.anchorLng, recordedAtUtc: r.anchorAt.toISOString() }
        : null,
  }));
}

async function newestPosition(db: Writer, truckId: string): Promise<{ lat: number; lng: number } | null> {
  const [row] = await db
    .select({ lat: positions.lat, lng: positions.lng })
    .from(positions)
    .where(eq(positions.truckId, truckId))
    .orderBy(desc(positions.recordedAt))
    .limit(1);
  return row ?? null;
}

async function otherOpenLoads(db: Writer, truckId: string, loadId: string): Promise<OtherOpenLoad[]> {
  const rows = await db
    .select({ loadId: loads.id, loadNumber: loads.loadNumber, createdAt: loads.createdAt })
    .from(loads)
    .where(
      and(eq(loads.truckId, truckId), ne(loads.id, loadId), sql`${loads.status} not in ${TERMINAL_SQL}`),
    )
    .orderBy(asc(loads.createdAt));
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/** What reopening one load would do: the confirm step's facts, and the write's. */
export interface ReopenAssessment {
  plan: AnchorPlan;
  late: { stopId: string; place: string }[];
  others: OtherOpenLoad[];
}

async function assess(
  db: Writer,
  input: { truckId: string; loadId: string; close: CloseRecord; lock: boolean },
): Promise<ReopenAssessment> {
  const stopRows = await loadStops(db, input.loadId, input.lock);
  const plan = planAnchors(stopRows, input.close);
  return {
    plan,
    late: lateDepartures(stopRows, plan, await newestPosition(db, input.truckId)),
    others: await otherOpenLoads(db, input.truckId, input.loadId),
  };
}

/* ---------------------------- recently closed ---------------------------- */

/**
 * The truck's loads closed in the last 7 days, newest close first, each with
 * what reopening it would do. Empty when there are none — the section is then
 * not drawn. A load whose close left no audit entry cannot be dated and is not
 * offered.
 */
export async function recentlyClosed(
  db: Db | Tx,
  truckId: string,
  now = new Date(),
): Promise<RecentlyClosed[]> {
  const closed = await db
    .select({ id: loads.id, loadNumber: loads.loadNumber })
    .from(loads)
    .where(and(eq(loads.truckId, truckId), sql`${loads.status} in ${TERMINAL_SQL}`));
  const closes = await newestCloses(
    db,
    closed.map((l) => l.id),
  );
  const recent = closed
    .map((l) => ({ ...l, close: closes.get(l.id) }))
    .filter(
      (l): l is typeof l & { close: CloseRecord } =>
        l.close !== undefined && now.getTime() - new Date(l.close.closedAt).getTime() <= REOPEN_WINDOW_MS,
    )
    .sort((a, b) => b.close.closedAt.localeCompare(a.close.closedAt));

  const out: RecentlyClosed[] = [];
  for (const load of recent) {
    const facts = await assess(db, { truckId, loadId: load.id, close: load.close, lock: false });
    const { closeAuditId, closedAt, closedByName, closedStatus, statusBefore } = load.close;
    out.push({
      loadId: load.id,
      loadNumber: load.loadNumber,
      close: { closeAuditId, closedAt, closedByName, closedStatus, statusBefore },
      others: facts.others,
      restored: facts.plan.restored.map(({ stopId, place }) => ({ stopId, place })),
      missing: facts.plan.missing,
      late: facts.late,
    });
  }
  return out;
}

/* --------------------------------- reopen -------------------------------- */

export interface ReopenResult {
  loadId: string;
  status: LoadStatus;
  anchorsRestored: number;
}

/**
 * One transaction: the load's status, the anchors its close cleared, and the
 * audit entry — or none of it.
 *
 * Two dispatchers cannot reopen it twice. The load row is locked, and the
 * write goes ahead only while the load is still closed AND the close the
 * dispatcher saw is still its newest: the second click finds it open and is
 * told who reopened it; a load closed again since is refused, not reopened
 * from a close nobody looked at.
 *
 * `arrived_at`, `departed_at`, `arrived_source`, the address and every
 * geocode column are never written.
 */
export async function reopenLoad(
  db: Db | Writer,
  input: { actorUserId: string | null; request: ReopenRequest; dispatchTz: string; now?: Date },
): Promise<ReopenResult> {
  const { truckId, loadId } = input.request;
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [load] = await tx
      .select({ truckId: loads.truckId, loadNumber: loads.loadNumber, status: loads.status })
      .from(loads)
      .where(eq(loads.id, loadId))
      .for('update')
      .limit(1);
    if (!load) throw new ReopenError('That load no longer exists. Nothing was changed.');
    if (load.truckId !== truckId) {
      throw new ReopenError('That load is no longer on this truck. Nothing was changed.');
    }

    if (!isTerminal(load.status)) {
      const [reopened] = (await tx.execute(sql`
        select p.full_name as name,
               to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at
          from audit_log a left join profiles p on p.id = a.actor_user_id
         where a.entity = 'load' and a.entity_id = ${loadId}
           and a.after->>'source' = ${REOPEN_AUDIT_SOURCE}
         order by a.created_at desc limit 1`)) as unknown as { name: string | null; at: string }[];
      throw new ReopenError(
        reopened
          ? `Already reopened${reopened.name ? ` by ${reopened.name}` : ''} at ${dispatchTime(reopened.at, input.dispatchTz, now)}. Nothing was changed.`
          : 'That load is already open. Nothing was changed.',
      );
    }

    const close = (await newestCloses(tx, [loadId])).get(loadId);
    if (!close) {
      throw new ReopenError('There is no record of this close, so it cannot be reopened here.');
    }
    if (close.closeAuditId !== input.request.closeAuditId) {
      throw new ReopenError('This load was closed again since you opened this. Nothing was changed.');
    }
    if (now.getTime() - new Date(close.closedAt).getTime() > REOPEN_WINDOW_MS) {
      throw new ReopenError('This load was closed more than 7 days ago. Nothing was changed.');
    }

    const [truck] = await tx
      .select({ active: trucks.active })
      .from(trucks)
      .where(eq(trucks.id, truckId))
      .limit(1);
    if (!truck?.active) {
      throw new ReopenError('This truck is inactive. Nothing was changed.');
    }

    // Recorded, or chosen when the record cannot say. Never a guess.
    const status = close.statusBefore ?? input.request.status ?? null;
    if (status === null) {
      throw new ReopenError('Choose the status the load goes back to. Nothing was changed.');
    }

    const facts = await assess(tx, { truckId, loadId, close, lock: true });

    await tx.update(loads).set({ status }).where(eq(loads.id, loadId));
    for (const r of facts.plan.restored) {
      await tx
        .update(stops)
        .set({
          arrivalAnchorLat: r.anchor.lat,
          arrivalAnchorLng: r.anchor.lng,
          arrivalAnchorAt: sql`${r.anchor.recordedAtUtc}::timestamptz`,
        })
        .where(eq(stops.id, r.stopId));
    }

    await writeAudit(tx, {
      actorUserId: input.actorUserId,
      entity: 'load',
      entityId: loadId,
      before: {
        truckId,
        loadNumber: load.loadNumber,
        loadStatus: load.status,
        closeAuditId: close.closeAuditId,
      },
      after: {
        truckId,
        loadStatus: status,
        statusFrom: close.statusBefore === null ? 'chosen' : 'close-record',
        source: REOPEN_AUDIT_SOURCE,
        reopenOf: close.closeAuditId,
        anchorsRestored: facts.plan.restored.map((r) => ({ stopId: r.stopId, ...r.anchor })),
        anchorsMissing: facts.plan.missing.map((m) => m.stopId),
        lateDepartureWarned: facts.late.map((l) => l.stopId),
        otherOpenLoads: facts.others.map((o) => o.loadId),
      },
    });

    return { loadId, status, anchorsRestored: facts.plan.restored.length };
  });
}
