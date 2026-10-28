import { connect, seedUser, truncateAll } from './fixtures';

/**
 * The assignment board's baseline world (`assignments-baseline.spec.ts`).
 * INVENTED: made-up truck numbers, made-up names, 555-01xx phones, and
 * positions in real towns with made-up streets. No real driver, phone or
 * truck is in it.
 */

export const NOW = new Date('2026-10-21T15:00:00Z');

/** Trucks in board order; `null` is a truck with nobody on it. */
const BOARD: [number, string | null][] = [
  [401, 'Ada Okonkwo-Lindqvist'],
  [404, 'Bram Tessaro'],
  [410, null],
  [412, 'Cleo Varga'],
  [415, 'Dov Abernathy-Kim'],
  [418, null],
  [420, 'Elif Marchetti'],
  [422, 'Fenn Oduya'],
  [425, 'Gus Halvorsen'],
  [427, 'Hana Petrosyan'],
  [430, null],
  [433, 'Ivo Brandt'],
  [436, 'Juno Castellanos Reyes'],
  [438, 'Kai Thorvaldsen'],
];
/** On no truck: the "Drivers without a truck" panel, and first in the picker. */
export const FREE = 'Lior Mbeki-Saarinen';
/** Hand-entered drivers, so the No ELD tag is in the picture. */
const NO_ELD = new Set(['Bram Tessaro', 'Elif Marchetti', 'Hana Petrosyan', FREE]);
/**
 * 3ao: two DIFFERENT drivers with one (invented) number, so every picture has
 * the shared-phone warning on 425 and 436 and its panel (§12.138). Juno is
 * given Gus's number.
 */
const SHARES_PHONE_WITH: Record<string, string> = { 'Juno Castellanos Reyes': 'Gus Halvorsen' };

/**
 * 3ap: what Currently shows (§12.145). The status is the SERVER's, computed
 * with its own real clock, which no browser clock reaches. So every load is
 * one whose status cannot move with the date, as the console's baselines do:
 *
 *   - `past`: an appointment on 2026-10-20 and a fresh fix: Late, on any day
 *     after (the clock passed the deadline; no ETA without coordinates);
 *   - `future`: an appointment on Tue 2030-06-04: Upcoming, "Tue 6/4";
 *   - `arrived`: arrived on 2026-10-20: Arrived wins outright;
 *   - `no-appt`: a load whose stop has no appointment: No appt;
 *   - `forced`: `future` with a dispatcher's Late until 2030: "Late · forced";
 *   - a `future` load with a fix 60 hours old: Stale GPS, its chip "2d"
 *     whenever the shot is taken (the age is measured from the seed);
 *   - no load: the position only; no driver: "—"; no fix: "—".
 *
 * On time and At risk are ETA against the clock on the server's day, and
 * move with the time of day; the unit tests hold them (Currently.test.tsx).
 */
type Load = 'past' | 'future' | 'arrived' | 'no-appt' | 'forced';
const LIVE: Record<number, { place: string | null; fixHoursAgo?: number; load?: Load }> = {
  401: { place: 'I-55 S, Bolingbrook, IL, 60440', load: 'past' },
  404: { place: 'Joliet, IL, 60431', load: 'future' },
  410: { place: 'Ottawa, IL, 61350' },
  412: { place: '1250 W Main St, Peoria, IL, 61602', load: 'arrived' },
  415: { place: 'Bloomington, IL, 61701', load: 'no-appt' },
  418: { place: null },
  420: { place: 'Kankakee, IL, 60901', fixHoursAgo: 60, load: 'future' },
  422: { place: 'Champaign, IL, 61820', load: 'forced' },
  425: { place: 'I-74 W, Galesburg, IL' },
  427: { place: '1250 171st Street, East Hazel Crest, IL, 60429' },
  430: { place: 'Danville, IL, 61832' },
  433: { place: null },
  436: { place: 'Springfield, IL, 62701', load: 'past' },
  438: { place: 'Decatur, IL, 62521', load: 'no-appt' },
};
const PAST = new Date('2026-10-20T15:00:00Z');
const FUTURE = new Date('2030-06-04T19:30:00Z');

export async function seedBoard(): Promise<void> {
  const sql = connect();
  try {
    await truncateAll(sql);
    await seedUser(sql, process.env.E2E_USER_ID!, process.env.E2E_EMAIL!);
    const names = [...BOARD.map(([, name]) => name).filter((n): n is string => n !== null), FREE];
    const driverIds = new Map<string, string>();
    const phones = new Map<string, string | null>();
    for (const [i, name] of names.entries()) {
      const app = NO_ELD.has(name);
      const sharer = SHARES_PHONE_WITH[name];
      // Every third driver has no phone, so "No phone" and Add are in the picture.
      const phone =
        sharer !== undefined ? phones.get(sharer)! : i % 3 === 2 ? null : `70855501${String(i).padStart(2, '0')}`;
      phones.set(name, phone);
      const [d] = await sql<{ id: string }[]>`
        insert into drivers (name, source, samsara_driver_id, phone)
        values (${name}, ${app ? 'app' : 'samsara'}, ${app ? null : `sd-a${i}`}, ${phone})
        returning id`;
      driverIds.set(name, d!.id);
    }
    // One instant for every fresh fix and the feed, so nothing reads as stale.
    const seededAt = new Date();
    for (const [index, [n, name]] of BOARD.entries()) {
      const [t] = await sql<{ id: string }[]>`
        insert into trucks (samsara_vehicle_id, samsara_name, truck_number, active)
        values (${`sv-a${n}`}, ${`Truck #${n}`}, ${n}, true) returning id`;
      if (name !== null) {
        await sql`insert into assignments (truck_id, driver_id, started_at)
                  values (${t!.id}, ${driverIds.get(name)!}, ${NOW})`;
      }
      const live = LIVE[n];
      if (live?.place) {
        const at = new Date(seededAt.getTime() - (live.fixHoursAgo ?? 0) * 3_600_000);
        await sql`
          insert into positions (truck_id, lat, lng, heading, speed_mph, recorded_at, formatted_location)
          values (${t!.id}, ${40.1 + index * 0.05}, ${-88.2 - index * 0.05}, null, 0, ${at}, ${live.place})`;
      }
      if (live?.load) await seedLoad(sql, t!.id, n, live.load);
    }
    await sql`
      insert into feed_health (id, newest_position_at, last_success_at, cursor, missed_cycles)
      values (1, ${seededAt}, ${seededAt}, ${'e2e-cursor'}, 0)
      on conflict (id) do update set
        newest_position_at = excluded.newest_position_at,
        last_success_at = excluded.last_success_at,
        cursor = excluded.cursor`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** One open load with one delivery, with no coordinates, so the clock alone decides. */
async function seedLoad(sql: ReturnType<typeof connect>, truckId: string, n: number, load: Load) {
  const [l] = await sql<{ id: string }[]>`
    insert into loads (truck_id, load_number, status)
    values (${truckId}, ${`E2E-A${n}`}, 'DISPATCHED') returning id`;
  const appointment = load === 'no-appt' ? null : load === 'past' || load === 'arrived' ? PAST : FUTURE;
  const arrived = load === 'arrived' ? new Date(PAST.getTime() - 10 * 60_000) : null;
  const [s] = await sql<{ id: string }[]>`
    insert into stops (
      load_id, type, sequence, address_line, city, state, zip,
      appointment_start_utc, appointment_tz, appointment_type, arrived_at, arrived_source)
    values (${l!.id}, 'DEL', 1, ${'1 Test Dock'}, ${'Joliet'}, ${'IL'}, ${'60431'},
            ${appointment}, ${appointment ? 'America/Chicago' : null}, 'APPT',
            ${arrived}, ${arrived ? 'detected' : null})
    returning id`;
  if (load === 'forced') {
    await sql`
      insert into overrides (stop_id, forced_status, reason, set_at, expires_at)
      values (${s!.id}, 'LATE', 'RECEIVER_CONFIRMED_DETENTION', ${NOW}, ${new Date('2030-06-05T00:00:00Z')})`;
  }
}
