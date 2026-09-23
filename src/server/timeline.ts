import { sql } from 'drizzle-orm';
import type { Db, Tx } from './audit';

/**
 * §14 feature 15 — the per-truck timeline. **Interpretation**: turn 5 listed
 * it and drew no screen.
 *
 * ## The line this does not cross
 *
 * §12.15 defers **History**, the **audit-log view** and **override review**
 * to v2, and says the `History` button in §9.4's detail panel needs hiding
 * until then, because it would "promise a reversal path that does not exist."
 * A timeline sits right beside all three, so the boundary is drawn here
 * rather than left to a component:
 *
 *   - **Read-only, and nothing to press.** No undo, no reversal, no "restore
 *     this". That is History, and History is deferred.
 *   - **`audit_log` is not read.** Not once, not for a name. It is written on
 *     every edit and nothing reads it back (§12.15), and the first thing that
 *     does should be the audit view, designed as one.
 *   - **Overrides are included, but only the ones on THIS truck's stops.**
 *     `4c`'s deferred "override review" is a fleet-wide weekly screen for
 *     judging whether overrides are being used honestly. This is "why does
 *     this truck say ARRIVED when it is on the interstate", which the row
 *     already half-answers with the forced glyph and which a dispatcher
 *     currently has to open the edit modal to finish.
 *
 * ## What counts as this truck's timeline
 *
 * Every stop on every load the truck is holding that is not finished, plus
 * the loads it finished in the last 24 hours. A dispatcher asking "what has
 * 101 done today and what is left" means both halves, and a timeline that
 * dropped the morning's delivery the moment it was marked DELIVERED would
 * answer only the second.
 */

export interface TimelineOverride {
  forcedStatus: string;
  reason: string;
  reasonNote: string | null;
  setAt: string;
  expiresAt: string;
  clearedAt: string | null;
  setByName: string | null;
}

export interface TimelineStop {
  stopId: string;
  loadId: string;
  loadNumber: string | null;
  loadStatus: string;
  loadCreatedAt: string;
  sequence: number;
  type: 'PU' | 'DEL';
  addressLine: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  apptStartUtc: string | null;
  apptEndUtc: string | null;
  apptTz: string | null;
  apptType: 'APPT' | 'FCFS';
  arrivedAt: string | null;
  arrivedSource: 'detected' | 'dispatcher' | null;
  departedAt: string | null;
  dispatcherNote: string | null;
  noteAt: string | null;
  overrides: TimelineOverride[];
}

/** Loads that are over as far as the board is concerned. */
const FINISHED = ['DELIVERED', 'TONU', 'CANCELLED'] as const;

export async function loadTruckTimeline(
  db: Db | Tx,
  truckId: string,
  now = new Date(),
): Promise<TimelineStop[]> {
  const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();

  const rows = (await db.execute(sql`
    with relevant as (
      select l.id
      from loads l
      where l.truck_id = ${truckId}::uuid
        and (
          l.status not in ${sql.raw(`('${FINISHED.join("','")}')`)}
          or exists (
            select 1 from stops s
            where s.load_id = l.id
              and greatest(
                coalesce(s.departed_at, 'epoch'::timestamptz),
                coalesce(s.arrived_at, 'epoch'::timestamptz)
              ) >= ${since}
          )
        )
    )
    select s.id           as stop_id,
           l.id           as load_id,
           l.load_number  as load_number,
           l.status::text as load_status,
           l.created_at   as load_created_at,
           s.sequence, s.type::text as type,
           s.address_line, s.city, s.state, s.zip,
           s.appointment_start_utc, s.appointment_end_utc,
           s.appointment_tz, s.appointment_type::text as appointment_type,
           s.arrived_at, s.arrived_source::text as arrived_source,
           s.departed_at, s.dispatcher_note, s.note_at,
           /*
            * The overrides for this stop, newest first, as JSON rather than
            * as a second query or a join that multiplies the stop rows. A
            * stop with three overrides must stay one stop.
            */
           coalesce((
             select json_agg(json_build_object(
                      'forcedStatus', o.forced_status::text,
                      'reason',       o.reason::text,
                      'reasonNote',   o.reason_note,
                      'setAt',        o.set_at,
                      'expiresAt',    o.expires_at,
                      'clearedAt',    o.cleared_at,
                      'setByName',    p.full_name
                    ) order by o.set_at desc)
             from overrides o
             left join profiles p on p.id = o.set_by
             where o.stop_id = s.id
           ), '[]'::json) as overrides
    from stops s
    join loads l on l.id = s.load_id
    join relevant r on r.id = l.id
    order by l.created_at asc, l.id asc, s.sequence asc
  `)) as unknown as Record<string, unknown>[];

  const iso = (value: unknown): string | null =>
    value instanceof Date ? value.toISOString() : ((value as string | null) ?? null);

  return rows.map((r) => ({
    stopId: r['stop_id'] as string,
    loadId: r['load_id'] as string,
    loadNumber: (r['load_number'] as string | null) ?? null,
    loadStatus: r['load_status'] as string,
    loadCreatedAt: iso(r['load_created_at']) ?? '',
    sequence: Number(r['sequence']),
    type: r['type'] as 'PU' | 'DEL',
    addressLine: (r['address_line'] as string | null) ?? null,
    city: (r['city'] as string | null) ?? null,
    state: (r['state'] as string | null) ?? null,
    zip: (r['zip'] as string | null) ?? null,
    apptStartUtc: iso(r['appointment_start_utc']),
    apptEndUtc: iso(r['appointment_end_utc']),
    apptTz: (r['appointment_tz'] as string | null) ?? null,
    apptType: r['appointment_type'] as 'APPT' | 'FCFS',
    arrivedAt: iso(r['arrived_at']),
    arrivedSource: (r['arrived_source'] as 'detected' | 'dispatcher' | null) ?? null,
    departedAt: iso(r['departed_at']),
    dispatcherNote: (r['dispatcher_note'] as string | null) ?? null,
    noteAt: iso(r['note_at']),
    overrides: ((r['overrides'] as TimelineOverride[] | null) ?? []).map((o) => ({
      ...o,
      setAt: iso(o.setAt) ?? '',
      expiresAt: iso(o.expiresAt) ?? '',
      clearedAt: iso(o.clearedAt),
    })),
  }));
}
