import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { cityState } from '@/samsara/schemas';
import type { Status } from '@/lib/status';
import { LOAD_STATUSES, type LoadStatus } from '@/lib/loads';

/**
 * The console's fleet query, its row schema, and the mapping between them.
 *
 * Deliberately free of `server-only` and of any database handle, so the query
 * and its shape can be tested directly — see fleet-query.test.ts, which runs
 * this against the real database. The previous version lived behind
 * `server-only` and could not be tested at all, which is how its row type
 * came to disagree with reality.
 */

/** One row of the console list. Everything the list and the map need. */
export interface FleetRow {
  /** Internal uuid. Never shown — the URL and the UI use truckNumber. */
  id: string;
  truckNumber: number | null;
  /** Raw Samsara name. The fallback when truckNumber is null (one truck is
   *  literally named "Truck"). */
  samsaraName: string;
  driverName: string | null;
  lat: number | null;
  lng: number | null;
  /** Already NULL on stationary trucks — the worker normalises it. */
  heading: number | null;
  speedMph: number | null;
  /** ISO 8601 UTC, or null. A STRING, not a Date — see FleetQueryRow. */
  recordedAt: string | null;
  /** Samsara's string, stored whole. Tooltip and popup show all of it. */
  formattedLocation: string | null;
  /** "New Lenox, IL" — what the Position column renders. */
  cityState: string | null;
  status: Status;
  /**
   * The next stop, by §12.13: the earliest undeparted stop across every OPEN
   * load the truck holds. Null when the truck has no load, which is an empty
   * state a dispatcher genuinely sees (§12.14).
   */
  nextStop: NextStop | null;
  /** §12.13. Above 1, the row shows which load is driving the deadline. */
  openLoadCount: number;
  /**
   * The next appointment as an ISO-8601 UTC string, lifted to the top level
   * because it is the urgency sort's secondary key (§12.4). Mirrors
   * `nextStop.apptStartUtc`.
   */
  apptAt: string | null;
}

export interface NextStop {
  stopId: string;
  loadId: string;
  /** Null until the broker's paperwork carries one (§12.21). */
  loadNumber: string | null;
  loadStatus: LoadStatus;
  type: 'PU' | 'DEL';
  addressLine: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** ISO-8601 UTC, or null for a stop with no appointment yet. */
  apptStartUtc: string | null;
  /**
   * APPT: the end of the ± window, or null for an exact time.
   * FCFS: the LATEST receiving hour — the deadline (§12.22).
   */
  apptEndUtc: string | null;
  /** The facility's IANA zone. The appointment renders in THIS zone (§7.1). */
  apptTz: string | null;
  apptType: 'APPT' | 'FCFS';
}

/**
 * Latest position per truck.
 *
 * LEFT JOIN LATERAL ... LIMIT 1, deliberately, NOT `DISTINCT ON (truck_id)`.
 * DISTINCT ON scans the whole index — O(positions). This does one index seek
 * per truck against positions_truck_recorded_key — scanned BACKWARDS, since
 * that index is ascending and a btree walks either way — O(trucks), flat as
 * the table grows. Verified: `npm run db:explain` shows
 * `Index Scan Backward using positions_truck_recorded_key`, loops=23, against
 * a full-table scan for the alternative.
 *
 * `recorded_at` is cast to ISO-8601 UTC **in SQL**, not in TypeScript.
 * Postgres's default text rendering of a timestamptz is
 * "2026-09-17 10:37:13.524+00" — a space separator and a bare "+00" — and its
 * exact form depends on the session's DateStyle, which is a setting, not a
 * guarantee. `to_char` pins it. The boundary is here, once, in the query.
 */
export const LATEST_POSITION_SQL = sql`
  select
    t.id::text                as id,
    t.truck_number            as truck_number,
    t.samsara_name            as samsara_name,
    d.name                    as driver_name,
    p.lat                     as lat,
    p.lng                     as lng,
    p.heading                 as heading,
    p.speed_mph               as speed_mph,
    to_char(p.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                              as recorded_at,
    p.formatted_location      as formatted_location,
    ns.stop_id, ns.load_id, ns.load_number, ns.load_status, ns.stop_type,
    ns.stop_address, ns.stop_city, ns.stop_state, ns.stop_zip,
    ns.appointment_start_utc, ns.appointment_end_utc, ns.appointment_tz,
    ns.appointment_type,
    (select count(*) from loads ol
      where ol.truck_id = t.id
        and ol.status not in ('DELIVERED', 'TONU', 'CANCELLED'))::int
                              as open_load_count
  from trucks t
  -- assignments_one_open_per_truck guarantees at most one open row, so this
  -- cannot multiply the result set.
  left join assignments a on a.truck_id = t.id and a.ended_at is null
  left join drivers d     on d.id = a.driver_id
  left join lateral (
    select lat, lng, heading, speed_mph, recorded_at, formatted_location
    from positions
    where truck_id = t.id
    order by recorded_at desc
    limit 1
  ) p on true
  /**
   * The next stop (§12.13): lowest undeparted sequence, and for a truck
   * holding two loads, the EARLIEST DEADLINE across both — which is why the
   * appointment leads the ordering and the sequence only breaks ties.
   *
   * The terminal statuses are the three in lib/loads.ts. A delivered load's
   * stops are history, not work.
   */
  left join lateral (
    select
      s.id::text              as stop_id,
      l.id::text              as load_id,
      l.load_number           as load_number,
      l.status::text          as load_status,
      s.type::text            as stop_type,
      s.address_line          as stop_address,
      s.city                  as stop_city,
      s.state                 as stop_state,
      s.zip                   as stop_zip,
      to_char(s.appointment_start_utc at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                              as appointment_start_utc,
      to_char(s.appointment_end_utc at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                              as appointment_end_utc,
      s.appointment_tz        as appointment_tz,
      s.appointment_type::text as appointment_type
    from loads l
    join stops s on s.load_id = l.id
    where l.truck_id = t.id
      and l.status not in ('DELIVERED', 'TONU', 'CANCELLED')
      and s.departed_at is null
    order by s.appointment_start_utc asc nulls last, s.sequence asc
    limit 1
  ) ns on true
  where t.active
  order by t.truck_number asc nulls last
`;

/** Exactly what `to_char` above produces. */
const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * The HONEST shape of a row from that query, verified against the live
 * database rather than asserted.
 *
 * A raw `sql` result is untyped — `db.execute` hands back whatever the driver
 * decodes. Casting it to an interface with `as unknown as` tells the compiler
 * a story it cannot check, which is exactly how `recorded_at` came to be
 * declared `Date` while arriving as a string. Zod checks it at runtime
 * instead, so a drift between this query and this type fails loudly at the
 * boundary rather than as a TypeError inside a render.
 */
export const FleetQueryRow = z.object({
  id: z.string().uuid(),
  /** int4. Null only for a vehicle whose name carries no digits. */
  truck_number: z.number().int().nullable(),
  samsara_name: z.string(),
  driver_name: z.string().nullable(),
  /** double precision -> number. */
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  /** smallint -> number. */
  heading: z.number().nullable(),
  speed_mph: z.number().nullable(),
  /**
   * STRING, not Date. The regex is the guard: if the to_char cast is ever
   * dropped, Postgres's default rendering fails this immediately instead of
   * flowing onward to break at the first `.toISOString()`.
   */
  recorded_at: z.string().regex(ISO_UTC_MS, 'expected ISO-8601 UTC from to_char').nullable(),
  formatted_location: z.string().nullable(),

  /** The next-stop lateral. Every field is null when the truck has no load. */
  stop_id: z.string().uuid().nullable(),
  load_id: z.string().uuid().nullable(),
  /** §12.21: a load may not have a number yet. */
  load_number: z.string().nullable(),
  load_status: z.enum(LOAD_STATUSES).nullable(),
  stop_type: z.enum(['PU', 'DEL']).nullable(),
  stop_address: z.string().nullable(),
  stop_city: z.string().nullable(),
  stop_state: z.string().nullable(),
  stop_zip: z.string().nullable(),
  /** Same to_char cast, same reason: a STRING, never a Date. */
  appointment_start_utc: z
    .string()
    .regex(ISO_UTC_MS, 'expected ISO-8601 UTC from to_char')
    .nullable(),
  appointment_end_utc: z
    .string()
    .regex(ISO_UTC_MS, 'expected ISO-8601 UTC from to_char')
    .nullable(),
  appointment_tz: z.string().nullable(),
  appointment_type: z.enum(['APPT', 'FCFS']).nullable(),
  /** §12.13: the row names the load only when there is more than one. */
  open_load_count: z.number().int(),
});

export type FleetQueryRow = z.infer<typeof FleetQueryRow>;

export const FleetQueryRows = z.array(FleetQueryRow);

/** No Date is constructed anywhere: the query already produced ISO text. */
export function toFleetRow(raw: FleetQueryRow): FleetRow {
  return {
    id: raw.id,
    truckNumber: raw.truck_number,
    samsaraName: raw.samsara_name,
    driverName: raw.driver_name,
    lat: raw.lat,
    lng: raw.lng,
    heading: raw.heading,
    speedMph: raw.speed_mph,
    recordedAt: raw.recorded_at,
    formattedLocation: raw.formatted_location,
    cityState: cityState(raw.formatted_location),
    // Overwritten by applyPlaceholders in fleet.ts.
    status: 'ON_TIME' as Status,
    nextStop:
      raw.stop_id && raw.load_id && raw.load_status && raw.stop_type
        ? {
            stopId: raw.stop_id,
            loadId: raw.load_id,
            loadNumber: raw.load_number,
            loadStatus: raw.load_status,
            type: raw.stop_type,
            addressLine: raw.stop_address,
            city: raw.stop_city,
            state: raw.stop_state,
            zip: raw.stop_zip,
            apptStartUtc: raw.appointment_start_utc,
            apptEndUtc: raw.appointment_end_utc,
            apptTz: raw.appointment_tz,
            apptType: raw.appointment_type ?? 'APPT',
          }
        : null,
    openLoadCount: raw.open_load_count,
    apptAt: raw.appointment_start_utc,
  };
}

/** Parses a raw result set. Throws with the offending field named. */
export function parseFleetRows(result: unknown): FleetRow[] {
  const parsed = FleetQueryRows.safeParse(result);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .slice(0, 5)
      .join('; ');
    throw new Error(
      `The fleet query returned a shape FleetQueryRow does not describe. ` +
        `The query and its schema have drifted: ${detail}`,
    );
  }
  return parsed.data.map(toFleetRow);
}
