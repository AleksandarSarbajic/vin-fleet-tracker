import { sql, type SQL } from 'drizzle-orm';
import type { Db, Tx } from './audit';

/**
 * §12.117. The version of a load, as the edit modal saw it.
 *
 * An md5 of everything a PERSON edits about the load: its number, status and
 * truck; the truck's open assignment (which assignment, which driver); and,
 * for every stop in sequence order, its id, sequence, type, address,
 * appointment, note, a dispatcher's arrival and departure (§12.118), and the
 * id of its live override.
 *
 * What the worker writes is left out on purpose: a detected arrival, a
 * detected departure, coordinates. A truck reaching its stop while the modal is open
 * must not refuse the dispatcher's save — the rules that care about an
 * arrival (the reached-stop question, removing a stop) re-read it under the
 * lock and ask or refuse by themselves.
 *
 * ONE expression, in SQL, used in three places: the fleet query (so the row
 * the modal opens from carries the version of exactly what it shows), the
 * load read, and the save's check under the lock. Computed by the database
 * each time, so there is no second implementation for the three to drift
 * between.
 *
 * Instants are epoch seconds, never `timestamptz::text`: the text form
 * depends on the session's TimeZone, and the pooler and the direct connection
 * need not agree on it.
 */
export function loadVersionSql(loadId: SQL): SQL {
  return sql`(
    select md5(jsonb_build_object(
      'load', jsonb_build_array(lv.id, lv.load_number, lv.status, lv.truck_id),
      'assignment', (
        select jsonb_build_array(av.id, av.driver_id)
        from assignments av
        where av.truck_id = lv.truck_id and av.ended_at is null
      ),
      'stops', coalesce((
        select jsonb_agg(jsonb_build_array(
                 sv.id, sv.sequence, sv.type, sv.address_line, sv.city, sv.state, sv.zip,
                 extract(epoch from sv.appointment_start_utc),
                 extract(epoch from sv.appointment_end_utc),
                 sv.appointment_tz, sv.appointment_type, sv.dispatcher_note,
                 case when sv.arrived_source = 'dispatcher'
                      then extract(epoch from sv.arrived_at) end,
                 case when sv.departed_source = 'dispatcher'
                      then extract(epoch from sv.departed_at) end,
                 (select ov.id from overrides ov
                   where ov.stop_id = sv.id and ov.cleared_at is null)
               ) order by sv.sequence)
        from stops sv
        where sv.load_id = lv.id
      ), '[]'::jsonb)
    )::text)
    from loads lv
    where lv.id = ${loadId}
  )`;
}

/** The version as it stands, or null for a load that does not exist. */
export async function readLoadVersion(db: Db | Tx, loadId: string): Promise<string | null> {
  const rows = (await db.execute(
    sql`select ${loadVersionSql(sql`${loadId}::uuid`)} as version`,
  )) as unknown as { version: string | null }[];
  return rows[0]?.version ?? null;
}
