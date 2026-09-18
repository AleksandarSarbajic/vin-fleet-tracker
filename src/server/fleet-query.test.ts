import { afterAll, describe, expect, it } from 'vitest';
import { createPooledDb } from '@/db/connection';
import {
  FleetQueryRow,
  FleetQueryRows,
  LATEST_POSITION_SQL,
  parseFleetRows,
  toFleetRow,
} from './fleet-query';

/**
 * These run against the REAL database.
 *
 * The bug they exist to prevent: the row type for a raw `sql` query is not
 * checked by anything. `db.execute` returns whatever the driver decodes, so an
 * interface asserted over it with `as unknown as` compiles happily while being
 * wrong — which is how `recorded_at` came to be declared `Date` while arriving
 * as the string "2026-09-17 10:37:13.524+00", and why the first
 * `.toISOString()` on it threw at runtime on the first real page render.
 *
 * A unit test with hand-written fixtures could not have caught that: the
 * fixture would have been wrong in exactly the same way as the type. Only the
 * database knows what the database returns.
 */

const url = process.env.DATABASE_URL;
const withDb = url ? describe : describe.skip;

let handle: ReturnType<typeof createPooledDb> | null = null;
function connect() {
  handle ??= createPooledDb(url!);
  return handle;
}

afterAll(async () => {
  await handle?.client.end({ timeout: 5 });
});

withDb('the fleet query, against the real database', () => {
  it('returns rows whose shape FleetQueryRow actually describes', async () => {
    const { db } = connect();
    const result = await db.execute(LATEST_POSITION_SQL);

    // THE regression guard. If the query and its schema ever drift again,
    // this fails here with the offending field named, rather than as a
    // TypeError inside a React render.
    const parsed = FleetQueryRows.safeParse(result);
    if (!parsed.success) {
      throw new Error(
        `Row shape drifted: ${parsed.error.issues
          .map((i) => `${i.path.join('.')} ${i.message}`)
          .join('; ')}`,
      );
    }
    expect(parsed.data.length).toBeGreaterThan(0);
  });

  it('returns recorded_at as an ISO-8601 UTC STRING, never a Date', async () => {
    const { db } = connect();
    const rows = FleetQueryRows.parse(await db.execute(LATEST_POSITION_SQL));
    const withPosition = rows.filter((r) => r.recorded_at !== null);
    expect(withPosition.length).toBeGreaterThan(0);

    for (const row of withPosition) {
      expect(typeof row.recorded_at).toBe('string');
      expect(row.recorded_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      // And it is a real instant, not merely a well-shaped string.
      expect(Number.isNaN(Date.parse(row.recorded_at!))).toBe(false);
    }
  });

  it('gives every column the runtime type the schema claims', async () => {
    const { db } = connect();
    const raw = (await db.execute(LATEST_POSITION_SQL)) as unknown as Record<
      string,
      unknown
    >[];
    const expected: Record<string, string> = {
      id: 'string',
      truck_number: 'number',
      samsara_name: 'string',
      active: 'boolean',
      driver_id: 'string',
      driver_name: 'string',
      lat: 'number',
      lng: 'number',
      heading: 'number',
      speed_mph: 'number',
      recorded_at: 'string',
      formatted_location: 'string',
      // The next-stop lateral (§12.13). appointment_start_utc carries the
      // same to_char cast as recorded_at and for the same reason: a
      // timestamptz read through db.execute arrives as a driver value, and
      // the row type must not claim otherwise.
      stop_id: 'string',
      load_id: 'string',
      load_number: 'string',
      load_status: 'string',
      stop_type: 'string',
      stop_address: 'string',
      stop_city: 'string',
      stop_state: 'string',
      stop_zip: 'string',
      appointment_start_utc: 'string',
      appointment_end_utc: 'string',
      appointment_tz: 'string',
      appointment_type: 'string',
      stop_lat: 'number',
      stop_lng: 'number',
      // Cast to text in the lateral: a pg enum read through db.execute comes
      // back as a driver value, and the row type must not claim otherwise.
      stop_precision: 'string',
      stop_accuracy_miles: 'number',
      route_miles: 'number',
      route_duration_s: 'number',
      route_from_lat: 'number',
      route_from_lng: 'number',
      route_straight_miles: 'number',
      route_lane_ratio: 'number',
      route_snap_from_m: 'number',
      route_snap_to_m: 'number',
      route_computed_at: 'string',
      arrived_at: 'string',
      forced_status: 'string',
      reason: 'string',
      reason_note: 'string',
      set_by_name: 'string',
      set_at: 'string',
      expires_at: 'string',
      open_load_count: 'number',
    };

    for (const row of raw) {
      // Every declared column is present, so a renamed column is caught too.
      expect(Object.keys(row).sort()).toEqual(Object.keys(expected).sort());
      for (const [column, type] of Object.entries(expected)) {
        const value = row[column];
        if (value === null) continue; // nullable columns are allowed to be null
        expect(`${column}:${typeof value}`).toBe(`${column}:${type}`);
      }
    }
  });

  it('returns at most one row per truck — the lateral join cannot multiply', async () => {
    const { db } = connect();
    const rows = FleetQueryRows.parse(await db.execute(LATEST_POSITION_SQL));
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('maps cleanly to FleetRow, constructing no Date at all', async () => {
    const { db } = connect();
    const rows = parseFleetRows(await db.execute(LATEST_POSITION_SQL));
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      expect(row.recordedAt === null || typeof row.recordedAt === 'string').toBe(true);
      // The failure that started this: anything downstream calling a Date
      // method on recordedAt would throw.
      expect(row.recordedAt).not.toBeInstanceOf(Date);
      expect(typeof row.id).toBe('string');
      expect(row.samsaraName.length).toBeGreaterThan(0);
    }
  });

  it('derives cityState for every row that has a location', async () => {
    const { db } = connect();
    const rows = parseFleetRows(await db.execute(LATEST_POSITION_SQL));
    for (const row of rows) {
      if (row.formattedLocation === null) continue;
      expect(row.cityState).toBeTruthy();
      // Every real value parses to "City, ST".
      expect(row.cityState).toMatch(/,\s[A-Z]{2}$/);
    }
  });
});

describe('the schema guard itself', () => {
  const valid = {
    id: '3d1fb39f-bfd8-435a-a685-677338fe9a62',
    truck_number: 113,
    samsara_name: 'Truck #113',
    active: true,
    driver_id: null,
    driver_name: null,
    lat: 41.701967,
    lng: -87.933931,
    heading: null,
    speed_mph: 0,
    recorded_at: '2026-09-17T10:37:13.524Z',
    formatted_location: 'Maple Road, New Lenox, IL, 60451',
    // The next-stop lateral. All null is the "truck holds no load" case.
    stop_id: null,
    load_id: null,
    load_number: null,
    load_status: null,
    stop_type: null,
    stop_address: null,
    stop_city: null,
    stop_state: null,
    stop_zip: null,
    appointment_start_utc: null,
    appointment_end_utc: null,
    appointment_tz: null,
    appointment_type: null,
    stop_lat: null,
    stop_lng: null,
    stop_precision: null,
    stop_accuracy_miles: null,
    route_miles: null,
    route_duration_s: null,
    route_from_lat: null,
    route_from_lng: null,
    route_straight_miles: null,
    route_lane_ratio: null,
    route_snap_from_m: null,
    route_snap_to_m: null,
    route_computed_at: null,
    arrived_at: null,
    forced_status: null,
    reason: null,
    reason_note: null,
    set_by_name: null,
    set_at: null,
    expires_at: null,
    open_load_count: 0,
  };

  it('accepts the shape the query produces', () => {
    expect(FleetQueryRow.safeParse(valid).success).toBe(true);
  });

  it("rejects Postgres's DEFAULT timestamp rendering", () => {
    // If the to_char cast is ever dropped, this is what arrives instead:
    // a space separator and a bare "+00". The guard must not let it through,
    // because V8 happens to parse it — masking the drift until DateStyle
    // changes and it silently does not.
    const parsed = FleetQueryRow.safeParse({
      ...valid,
      recorded_at: '2026-09-17 10:37:13.524+00',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a Date object, which is what the old type claimed', () => {
    const parsed = FleetQueryRow.safeParse({
      ...valid,
      recorded_at: new Date('2026-09-17T10:37:13.524Z'),
    });
    expect(parsed.success).toBe(false);
  });

  it('allows null for every nullable column', () => {
    const parsed = FleetQueryRow.safeParse({
      ...valid,
      truck_number: null,
      driver_name: null,
      lat: null,
      lng: null,
      heading: null,
      speed_mph: null,
      recorded_at: null,
      formatted_location: null,
    });
    expect(parsed.success).toBe(true);
  });

  it('names the offending field when the shape drifts', () => {
    expect(() => parseFleetRows([{ ...valid, recorded_at: 12345 }])).toThrow(
      /recorded_at/,
    );
  });

  it('maps a null position to a null cityState', () => {
    const row = toFleetRow({ ...valid, formatted_location: null, recorded_at: null });
    expect(row.cityState).toBeNull();
    expect(row.recordedAt).toBeNull();
  });
});
