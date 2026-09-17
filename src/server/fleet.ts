import 'server-only';
import { asc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { drivers } from '@/db/schema';
import { cityState } from '@/samsara/schemas';
import { applyPlaceholders } from '@/lib/placeholder-fleet';
import type { Status } from '@/lib/status';

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
  recordedAt: string | null;
  /** Samsara's string, stored whole. Tooltip and popup show all of it. */
  formattedLocation: string | null;
  /** "New Lenox, IL" — what the Position column renders. */
  cityState: string | null;
  status: Status;
  /** True while the driver name comes from the phase-3 placeholder. */
  driverIsPlaceholder: boolean;
}

interface RawRow {
  id: string;
  truck_number: number | null;
  samsara_name: string;
  driver_name: string | null;
  lat: number | null;
  lng: number | null;
  heading: number | null;
  speed_mph: number | null;
  recorded_at: Date | null;
  formatted_location: string | null;
}

/**
 * Latest position per truck.
 *
 * LEFT JOIN LATERAL … LIMIT 1, deliberately, NOT `DISTINCT ON (truck_id)`.
 * DISTINCT ON scans the whole index — O(positions). This does one index seek
 * per truck against positions_truck_recorded_idx — O(trucks) — and stays flat
 * as the table grows.
 *
 * That difference is the whole ballgame here: three trucks logged 63 readings
 * in five minutes, so 60 active trucks at the 7-day retention ceiling is
 * roughly 7–9 million rows. DISTINCT ON would scan all of them on every poll
 * from every open tab.
 *
 * Run `npm run db:explain` to see the plan against the live table.
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
    p.recorded_at             as recorded_at,
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

export async function loadFleet(): Promise<FleetRow[]> {
  const [result, driverRows] = await Promise.all([
    db.execute(LATEST_POSITION_SQL),
    // Only needed by the phase-3 placeholder. TODO(phase 4): drop this read
    // once assignments carry real drivers.
    db
      .select({ name: drivers.name })
      .from(drivers)
      .where(eq(drivers.active, true))
      .orderBy(asc(drivers.name)),
  ]);

  const rows = (result as unknown as RawRow[]).map((r) => ({
    id: r.id,
    truckNumber: r.truck_number,
    samsaraName: r.samsara_name,
    driverName: r.driver_name,
    lat: r.lat,
    lng: r.lng,
    heading: r.heading,
    speedMph: r.speed_mph,
    recordedAt: r.recorded_at ? r.recorded_at.toISOString() : null,
    formattedLocation: r.formatted_location,
    cityState: cityState(r.formatted_location),
    // Overwritten by applyPlaceholders below.
    status: 'ON_TIME' as Status,
    driverIsPlaceholder: false,
  }));

  // ---------------------------------------------------------------------
  // The ONE call that fabricates data. Delete this line and every invented
  // status and driver name disappears from the app — nothing is hiding
  // behind a flag elsewhere.
  // TODO(phase 5): replace with the real engine from lib/status.ts.
  // TODO(phase 4): drop the driver half once assignments are written.
  // ---------------------------------------------------------------------
  return applyPlaceholders(
    rows,
    driverRows.map((d) => d.name),
  );
}
