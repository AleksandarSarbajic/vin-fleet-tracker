import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { cityState } from '@/samsara/schemas';
import type { Status } from '@/lib/status';

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
    p.formatted_location      as formatted_location
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
