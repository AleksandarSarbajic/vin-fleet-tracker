import postgres from 'postgres';

/**
 * The world each browser test starts in.
 *
 * Every row here lives in the LOCAL cluster (`./.testdb`) and is destroyed
 * before each spec file. The one thing that is NOT local is the Supabase
 * session: auth is hosted and there is no local stack, so the suite signs in
 * for real as a dedicated account. Real session, disposable data.
 *
 * Fixtures are explicit rather than derived from a seed script. §12.32's
 * lesson was that a fixture opening with `select … from trucks limit 1` picks
 * its own subject out of whatever happens to exist, so the test's meaning
 * changes with the data. Everything a spec asserts on is created by name here.
 */

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  `postgres://postgres@127.0.0.1:${process.env.TEST_PGPORT ?? '55432'}/fleet_test`;

/** Stable ids, so a spec can address a row without querying for it first. */
export const IDS = {
  truckChicago: '11111111-1111-4111-8111-111111111101',
  truckDallas: '11111111-1111-4111-8111-111111111102',
  truckAtZipStop: '11111111-1111-4111-8111-111111111103',
  driverAna: '22222222-2222-4222-8222-222222222201',
  driverMarko: '22222222-2222-4222-8222-222222222202',
  loadChicago: '33333333-3333-4333-8333-333333333301',
  loadDallas: '33333333-3333-4333-8333-333333333302',
  loadZip: '33333333-3333-4333-8333-333333333303',
  stopChicago: '44444444-4444-4444-8444-444444444401',
  stopDallas: '44444444-4444-4444-8444-444444444402',
  stopZip: '44444444-4444-4444-8444-444444444403',
} as const;

export const TRUCK_NUMBERS = { chicago: 101, dallas: 102, zip: 103 } as const;
export const DRIVER_NAMES = { ana: 'Ana Petrovic', marko: 'Marko Ilic' } as const;

/**
 * The zip-precision stop, and a truck parked exactly on it.
 *
 * Distance is therefore zero and arrival must STILL not fire. That is the
 * whole assertion: a ZIP centroid is the middle of a postal area, not a dock,
 * so "the truck is at the coordinates" carries no information about whether it
 * has arrived anywhere. A rule that keys on proximity alone gets this wrong in
 * the most confident possible way.
 */
export const ZIP_STOP = { lat: 41.8781, lng: -87.6298 } as const;

export function connect() {
  return postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
}

/** Empties every table in public. The cluster is loopback-only by construction. */
export async function truncateAll(sql: postgres.Sql): Promise<void> {
  const tables = await sql<{ name: string }[]>`
    select tablename as name from pg_tables where schemaname = 'public'`;
  const list = tables
    .map((t) => t.name)
    .filter((n) => /^[a-z_][a-z0-9_]*$/.test(n))
    .map((n) => `public."${n}"`)
    .join(', ');
  if (list) await sql.unsafe(`truncate table ${list} restart identity cascade`);
  await sql`delete from auth.users`;
}

/**
 * The signed-in dispatcher.
 *
 * Inserted into `auth.users`, which fires the real `on_auth_user_created`
 * trigger and produces a `profiles` row at role `viewer` — the same path a
 * real signup takes. The role is then promoted deliberately, exactly as
 * `bootstrap:admin` does, rather than the profile being written directly. If
 * the trigger ever breaks, these tests find out.
 */
export async function seedUser(sql: postgres.Sql, id: string, email: string): Promise<void> {
  await sql`
    insert into auth.users (id, email, raw_user_meta_data)
    values (${id}, ${email}, ${sql.json({ full_name: 'E2E Test Dispatcher' })})
    on conflict (id) do nothing`;
  await sql`update public.profiles set role = 'dispatcher', full_name = 'E2E Test Dispatcher'
            where id = ${id}`;
}

export interface SeedOptions {
  /** How old the newest position should look. Feed staleness is derived here. */
  feedAgeMinutes?: number;
  /** The Chicago stop's appointment, as a UTC instant. */
  appointmentUtc?: Date;
  /**
   * Extra trucks beyond the three named ones.
   *
   * A layout question cannot be asked of a three-row list: it fits, so nothing
   * overflows and every container looks correctly bounded. The real fleet is
   * ~34 trucks, and overflow is the whole point of the test.
   */
  extraTrucks?: number;
}

export async function seedFleet(sql: postgres.Sql, options: SeedOptions = {}): Promise<void> {
  const feedAge = options.feedAgeMinutes ?? 1;
  const recordedAt = new Date(Date.now() - feedAge * 60_000);
  // Tomorrow mid-afternoon Chicago time, unless a spec pins its own.
  const appointment = options.appointmentUtc ?? new Date(Date.now() + 26 * 3_600_000);

  const truck = (id: string, number: number) => sql`
    insert into trucks (id, samsara_vehicle_id, samsara_name, truck_number, active)
    values (${id}, ${`sv-${number}`}, ${`Truck #${number}`}, ${number}, true)`;
  await truck(IDS.truckChicago, TRUCK_NUMBERS.chicago);
  await truck(IDS.truckDallas, TRUCK_NUMBERS.dallas);
  await truck(IDS.truckAtZipStop, TRUCK_NUMBERS.zip);

  await sql`insert into drivers (id, name) values
    (${IDS.driverAna}, ${DRIVER_NAMES.ana}),
    (${IDS.driverMarko}, ${DRIVER_NAMES.marko})`;
  await sql`insert into assignments (truck_id, driver_id) values
    (${IDS.truckChicago}, ${IDS.driverAna}),
    (${IDS.truckDallas}, ${IDS.driverMarko})`;

  // Positions: Chicago and the zip truck sit ON the zip stop's coordinates.
  const position = (truckId: string, lat: number, lng: number) => sql`
    insert into positions (truck_id, lat, lng, heading, speed_mph, recorded_at, formatted_location)
    values (${truckId}, ${lat}, ${lng}, null, 0, ${recordedAt}, ${'Chicago, IL'})`;
  await position(IDS.truckChicago, 41.85, -87.65);
  await position(IDS.truckDallas, 32.7767, -96.797);
  await position(IDS.truckAtZipStop, ZIP_STOP.lat, ZIP_STOP.lng);

  await sql`insert into loads (id, truck_id, load_number, status) values
    (${IDS.loadChicago}, ${IDS.truckChicago}, ${'E2E-101'}, 'DISPATCHED'),
    (${IDS.loadDallas},  ${IDS.truckDallas},  ${'E2E-102'}, 'LOADED'),
    (${IDS.loadZip},     ${IDS.truckAtZipStop}, ${null}, 'DISPATCHED')`;

  const stop = (
    id: string,
    loadId: string,
    city: string,
    state: string,
    zip: string,
    lat: number,
    lng: number,
    precision: string,
  ) => sql`
    insert into stops (
      id, load_id, type, sequence, address_line, city, state, zip, lat, lng,
      appointment_start_utc, appointment_tz, appointment_type, geocode_precision)
    values (${id}, ${loadId}, 'DEL', 1, ${'1 Test Dock'}, ${city}, ${state}, ${zip},
            ${lat}, ${lng}, ${appointment}, ${'America/Chicago'}, 'APPT', ${precision})`;

  await stop(IDS.stopChicago, IDS.loadChicago, 'Chicago', 'IL', '60601', 41.8819, -87.6278, 'street');
  await stop(IDS.stopDallas, IDS.loadDallas, 'Dallas', 'TX', '75201', 32.7831, -96.8067, 'street');
  // Same coordinates as the truck. Zero miles away, and still not an arrival.
  await stop(IDS.stopZip, IDS.loadZip, 'Chicago', 'IL', '60602', ZIP_STOP.lat, ZIP_STOP.lng, 'zip');

  // Filler, so the list is longer than the viewport.
  for (let i = 0; i < (options.extraTrucks ?? 0); i += 1) {
    const n = 200 + i;
    const [t] = await sql<{ id: string }[]>`
      insert into trucks (samsara_vehicle_id, samsara_name, truck_number, active)
      values (${`sv-${n}`}, ${`Truck #${n}`}, ${n}, true) returning id`;
    await sql`
      insert into positions (truck_id, lat, lng, heading, speed_mph, recorded_at, formatted_location)
      values (${t!.id}, ${41.8 + i * 0.01}, ${-87.6 - i * 0.01}, null, 0, ${recordedAt}, ${'Chicago, IL'})`;
  }

  await sql`
    insert into feed_health (id, newest_position_at, last_success_at, cursor, missed_cycles)
    values (1, ${recordedAt}, ${new Date()}, ${'e2e-cursor'}, 0)
    on conflict (id) do update set
      newest_position_at = excluded.newest_position_at,
      last_success_at = excluded.last_success_at,
      cursor = excluded.cursor`;
}

/** Everything a spec needs, from empty to ready. */
export async function resetWorld(options: SeedOptions = {}): Promise<void> {
  const sql = connect();
  try {
    await truncateAll(sql);
    await seedUser(sql, process.env.E2E_USER_ID!, process.env.E2E_EMAIL!);
    await seedFleet(sql, options);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Ages the feed so the console withdraws schedule colour fleet-wide (§5.9). */
export async function makeFeedStale(minutesAgo = 180): Promise<void> {
  const sql = connect();
  try {
    await sql`update feed_health set newest_position_at = ${new Date(
      Date.now() - minutesAgo * 60_000,
    )} where id = 1`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
