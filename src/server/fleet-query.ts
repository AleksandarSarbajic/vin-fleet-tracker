import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  needsRecompute,
  type CachedRoute,
  type DistanceBasis,
} from '@/lib/routing';
import { cityState } from '@/samsara/schemas';
import {
  FORCED_STATUSES,
  OVERRIDE_REASONS,
  evaluate,
  type EtaAbsence,
  type OverrideFacts,
  type Status,
  type StatusConfig,
} from '@/lib/status';
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
  /** Ours, not Samsara's. False rows are hidden unless the Inactive chip is on. */
  active: boolean;

  /* ------- what the engine said. `status` is what the row shows ------- */
  status: Status;
  /** The engine's own answer, even when an override is showing (§9.5). */
  computed: Status;
  /** Live only; an expired override reads as none (expiry on read). */
  override: OverrideFacts | null;
  etaUtc: string | null;
  /** Straight-line miles left, from the same calculation as the ETA (§12.24). */
  milesRemaining: number | null;
  /** How well the stop's coordinates are known. Null when there are none. */
  etaPrecision: 'street' | 'block' | 'zip' | null;
  /** The ± to print beside a coarse ETA (§12.30), snap included (§12.31). */
  etaAccuracyMiles: number | null;
  /** Routed, estimated from an earlier route, or straight-line (§12.31). */
  distanceBasis: DistanceBasis;
  /** The measured road factor for this lane, when one exists. */
  laneRatio: number | null;
  /** Metres the provider moved the stop to reach a road. */
  snapMeters: number | null;
  /** Why there is no ETA, so the UI can say it rather than print a dash. */
  etaAbsence: EtaAbsence;
  /** UNASSIGNED suppresses the ETA and keeps it here, struck through (§5.8). */
  lastComputedEtaUtc: string | null;
  deadlineUtc: string | null;

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
  /**
   * Written by the forward geocoder from the address above (§12.24), never
   * typed. Null when the address could not be located, or when there is
   * none — `etaAbsence` says which.
   */
  lat: number | null;
  lng: number | null;
  /** `street` segment · `block` nearest block · `zip` centroid (§12.30). */
  precision: 'street' | 'block' | 'zip' | null;
  /** The ± in miles on those coordinates. Null for a street match. */
  accuracyMiles: number | null;
  /** The cached route for this lane (§12.31), or null. */
  route: CachedRoute | null;
  arrivedAt: string | null;
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
    t.active                  as active,
    d.id::text                as driver_id,
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
    ns.appointment_type, ns.stop_lat, ns.stop_lng, ns.stop_precision,
    ns.stop_accuracy_miles, ns.arrived_at,
    ns.route_miles, ns.route_duration_s, ns.route_from_lat, ns.route_from_lng,
    ns.route_straight_miles, ns.route_lane_ratio,
    ns.route_snap_from_m, ns.route_snap_to_m, ns.route_computed_at,
    ov.forced_status, ov.reason, ov.reason_note, ov.set_by_name,
    ov.set_at, ov.expires_at,
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
      s.appointment_type::text as appointment_type,
      s.lat                   as stop_lat,
      s.lng                   as stop_lng,
      s.geocode_precision::text as stop_precision,
      s.geocode_accuracy_miles  as stop_accuracy_miles,
      -- §12.31: the cached route for this lane, if there is one.
      sr.routed_miles           as route_miles,
      sr.routed_duration_s      as route_duration_s,
      sr.from_lat               as route_from_lat,
      sr.from_lng               as route_from_lng,
      sr.straight_at_route_miles as route_straight_miles,
      sr.lane_ratio             as route_lane_ratio,
      sr.snap_from_m            as route_snap_from_m,
      sr.snap_to_m              as route_snap_to_m,
      to_char(sr.computed_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as route_computed_at,
      to_char(s.arrived_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                              as arrived_at
    from loads l
    join stops s on s.load_id = l.id
    left join stop_routes sr on sr.stop_id = s.id
                            and sr.stop_lat = s.lat and sr.stop_lng = s.lng
    where l.truck_id = t.id
      and l.status not in ('DELIVERED', 'TONU', 'CANCELLED')
      and s.departed_at is null
    order by s.appointment_start_utc asc nulls last, s.sequence asc
    limit 1
  ) ns on true
  -- The live override on that stop, if any (§9.5).
  --
  -- Filtered on cleared_at is null ONLY. Expiry is evaluated on READ, by the
  -- engine, never by a scheduled job that might not run. Handing the engine
  -- an expired row and letting it decide keeps ONE answer to "is this
  -- override live", in a pure function a test can ask directly.
  left join lateral (
    select
      o.forced_status::text as forced_status,
      o.reason::text        as reason,
      o.reason_note         as reason_note,
      p2.full_name          as set_by_name,
      to_char(o.set_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                            as set_at,
      to_char(o.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                            as expires_at
    from overrides o
    left join profiles p2 on p2.id = o.set_by
    -- ns.stop_id is already ::text for the row schema, so the comparison
    -- casts back rather than letting Postgres refuse uuid = text.
    where o.stop_id::text = ns.stop_id and o.cleared_at is null
    order by o.set_at desc
    limit 1
  ) ov on true
  -- EVERY truck, not just the active ones. The Inactive chip (§12.14) needs
  -- them in the payload, and a filter the client applies to a real column
  -- beats a second query nobody remembers exists. The list and the map both
  -- hide active = false unless that chip is on.
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
  active: z.boolean(),
  /** Presence is what UNASSIGNED turns on — the name is for the cell. */
  driver_id: z.string().uuid().nullable(),
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
  /** Null on every stop a dispatcher typed — there is no geocoder (§12.24). */
  stop_lat: z.number().nullable(),
  stop_lng: z.number().nullable(),
  stop_precision: z.enum(['street', 'block', 'zip']).nullable(),
  stop_accuracy_miles: z.number().nullable(),
  route_miles: z.number().nullable(),
  route_duration_s: z.number().nullable(),
  route_from_lat: z.number().nullable(),
  route_from_lng: z.number().nullable(),
  route_straight_miles: z.number().nullable(),
  route_lane_ratio: z.number().nullable(),
  route_snap_from_m: z.number().nullable(),
  route_snap_to_m: z.number().nullable(),
  route_computed_at: z.string().nullable(),
  arrived_at: z.string().regex(ISO_UTC_MS).nullable(),

  forced_status: z.enum(FORCED_STATUSES).nullable(),
  reason: z.enum(OVERRIDE_REASONS).nullable(),
  reason_note: z.string().nullable(),
  set_by_name: z.string().nullable(),
  set_at: z.string().regex(ISO_UTC_MS).nullable(),
  expires_at: z.string().regex(ISO_UTC_MS).nullable(),
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
    active: raw.active,
    // Filled in by applyStatus(), below. Never left to a caller to remember.
    status: 'ON_TIME',
    computed: 'ON_TIME',
    override: overrideOf(raw),
    etaUtc: null,
    milesRemaining: null,
    etaPrecision: null,
    etaAccuracyMiles: null,
    distanceBasis: 'straight-line',
    laneRatio: null,
    snapMeters: null,
    etaAbsence: 'no-appointment',
    lastComputedEtaUtc: null,
    deadlineUtc: null,
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
            lat: raw.stop_lat,
            lng: raw.stop_lng,
            precision: raw.stop_precision,
            accuracyMiles: raw.stop_accuracy_miles,
            route:
              raw.route_miles !== null &&
              raw.route_duration_s !== null &&
              raw.route_from_lat !== null &&
              raw.route_from_lng !== null &&
              raw.route_straight_miles !== null &&
              raw.route_lane_ratio !== null &&
              raw.route_computed_at !== null
                ? {
                    routedMiles: raw.route_miles,
                    routedDurationS: raw.route_duration_s,
                    fromLat: raw.route_from_lat,
                    fromLng: raw.route_from_lng,
                    straightAtRouteMiles: raw.route_straight_miles,
                    laneRatio: raw.route_lane_ratio,
                    stopLat: raw.stop_lat ?? 0,
                    stopLng: raw.stop_lng ?? 0,
                    snapFromM: raw.route_snap_from_m,
                    snapToM: raw.route_snap_to_m,
                    computedAtUtc: raw.route_computed_at,
                  }
                : null,
            arrivedAt: raw.arrived_at,
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

/** The override as the engine wants it, or null when the lateral found none. */
function overrideOf(raw: FleetQueryRow): OverrideFacts | null {
  if (!raw.forced_status || !raw.reason || !raw.set_at || !raw.expires_at) return null;
  return {
    forcedStatus: raw.forced_status,
    reason: raw.reason,
    reasonNote: raw.reason_note,
    setByName: raw.set_by_name,
    setAtUtc: raw.set_at,
    expiresAtUtc: raw.expires_at,
  };
}

/**
 * Runs the engine over parsed rows.
 *
 * Separate from `parseFleetRows` and from any database handle, so a test can
 * hand it rows and a `now` and get the same answer the console will show.
 * The engine stays pure; this is the only place the two meet.
 */
export function applyStatus(
  rows: FleetRow[],
  config: StatusConfig,
  now: Date,
): FleetRow[] {
  return rows.map((row) => {
    const result = evaluate(
      {
        lat: row.lat,
        lng: row.lng,
        recordedAtUtc: row.recordedAt,
        hasDriver: row.driverName !== null,
        stop: row.nextStop
          ? {
              apptStartUtc: row.nextStop.apptStartUtc,
              apptEndUtc: row.nextStop.apptEndUtc,
              apptType: row.nextStop.apptType,
              arrivedAt: row.nextStop.arrivedAt,
              lat: row.nextStop.lat,
              lng: row.nextStop.lng,
              precision: row.nextStop.precision,
              accuracyMiles: row.nextStop.accuracyMiles,
              route: row.nextStop.route,
              /**
               * §12.31: `routed` only while the route still describes where
               * the truck IS. Past the recompute threshold the same row is
               * still useful — its lane ratio is a measured road factor — but
               * the label must stop saying "routed".
               */
              routeFresh:
                row.nextStop.route !== null &&
                row.lat !== null &&
                row.lng !== null &&
                row.nextStop.lat !== null &&
                row.nextStop.lng !== null &&
                needsRecompute(
                  row.nextStop.route,
                  {
                    truckLat: row.lat,
                    truckLng: row.lng,
                    stopLat: row.nextStop.lat,
                    stopLng: row.nextStop.lng,
                  },
                  now,
                ) === null,
              // Whether a dispatcher typed one, not whether it resolved.
              hasAddress: Boolean(
                row.nextStop.addressLine ?? row.nextStop.city ?? row.nextStop.zip,
              ),
            }
          : null,
        override: row.override,
      },
      config,
      now,
    );
    return {
      ...row,
      status: result.status,
      computed: result.computed,
      override: result.override,
      etaUtc: result.etaUtc,
      milesRemaining: result.milesRemaining,
      etaPrecision: result.precision,
      etaAccuracyMiles: result.accuracyMiles,
      distanceBasis: result.distanceBasis,
      laneRatio: result.laneRatio,
      snapMeters: result.snapMeters,
      etaAbsence: result.etaAbsence,
      lastComputedEtaUtc: result.lastComputedEtaUtc,
      deadlineUtc: result.deadlineUtc,
    };
  });
}
