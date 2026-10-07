import { sql } from 'drizzle-orm';
import { LoadForEdit } from '@/lib/load-read';
import type { Db, Tx } from './audit';
import { loadVersionSql } from './load-version';

/**
 * §12.117. One load as the edit modal will need it: the load, the truck's
 * open assignment, every stop in sequence order with its live override, and
 * the version of exactly that.
 *
 * ONE statement, so the rows and the version come from the same snapshot. A
 * version read a moment after the rows could describe a change the rows do
 * not show, and the save's check would then pass when it should refuse.
 *
 * Instants as ISO strings from `to_char`, never driver Dates (§12.21's rule
 * for the fleet row), and parsed rather than cast, so a drift between this
 * query and its type fails here.
 */

// §12.119. The shape lives in lib so the modal can check what it is given
// without importing this file, which holds the query.
export { LoadForEdit } from '@/lib/load-read';


const iso = (column: string) =>
  sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

/** The load, or null when there is no such load. */
export async function loadForEdit(db: Db | Tx, loadId: string): Promise<LoadForEdit | null> {
  const rows = (await db.execute(sql`
    select json_build_object(
      'loadId', l.id,
      'truckId', l.truck_id,
      'loadNumber', l.load_number,
      'status', l.status,
      'assignment', (
        select json_build_object('id', a.id, 'driverId', a.driver_id)
        from assignments a
        where a.truck_id = l.truck_id and a.ended_at is null
      ),
      'stops', coalesce((
        select json_agg(json_build_object(
                 'stopId', s.id,
                 'sequence', s.sequence,
                 'type', s.type,
                 'addressLine', s.address_line,
                 'city', s.city,
                 'state', s.state,
                 'zip', s.zip,
                 'apptStartUtc', ${iso('s.appointment_start_utc')},
                 'apptEndUtc', ${iso('s.appointment_end_utc')},
                 'apptTz', s.appointment_tz,
                 'apptType', s.appointment_type,
                 'dispatcherNote', s.dispatcher_note,
                 'arrivedAt', ${iso('s.arrived_at')},
                 'arrivedSource', s.arrived_source,
                 'departedAt', ${iso('s.departed_at')},
                 'departedSource', s.departed_source,
                 'precision', s.geocode_precision,
                 'accuracyMiles', s.geocode_accuracy_miles,
                 'override', (
                   select json_build_object(
                            'id', o.id,
                            'forcedStatus', o.forced_status,
                            'reason', o.reason,
                            'reasonNote', o.reason_note,
                            'expiresAtUtc', ${iso('o.expires_at')})
                   from overrides o
                   where o.stop_id = s.id and o.cleared_at is null
                 )
               ) order by s.sequence)
        from stops s
        where s.load_id = l.id
      ), '[]'::json),
      'version', ${loadVersionSql(sql`l.id`)}
    ) as load
    from loads l
    where l.id = ${loadId}::uuid
  `)) as unknown as { load: unknown }[];

  const row = rows[0];
  return row ? LoadForEdit.parse(row.load) : null;
}
