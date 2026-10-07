import { addDays, mondayOf, zonedWallToUtc, type IsoWeek } from '../src/lib/history-week';
import { connect, resetWorld } from './fixtures';

/**
 * §12.101 — a fixed history for the driver history page, at fixed instants,
 * so its screenshots hold still. Shaped on the design's weeks:
 *
 *   2026-W40  Sep 28 – Oct 4   A: a normal week (the design's, today Friday)
 *   2026-W39  Sep 21 – 27      C: a busy week — 4 loads in one day, weekends
 *   2026-W38  Sep 14 – 20      B: drivers assigned, no loads
 *   2026-W37  Sep 7 – 13       F: before the first record
 *
 * The fixture world's own loads and assignments are stamped with the REAL
 * time, which would land in whatever week today is; they are removed. Its
 * trucks and positions stay — the header's sync state reads them.
 */

const TZ = 'America/Chicago';
const W40 = { year: 2026, week: 40 };
const W39 = { year: 2026, week: 39 };

/** Day `d` of `week` (0 = Monday), at hh:mm in Chicago. */
const at = (week: IsoWeek, d: number, hh: number, mm = 0) =>
  zonedWallToUtc(addDays(mondayOf(week), d), hh, mm, TZ);

/** Thursday Sep 17, 2026: the drivers' trucks, from before the first record. */
const SINCE = at({ year: 2026, week: 38 }, 3, 8);

type Status = 'DELIVERED' | 'CANCELLED' | 'TONU' | 'LOADED' | 'DISPATCHED';
interface StopSeed {
  type: 'PU' | 'DEL';
  city: string;
  state: string;
  arrived?: Date;
  departed?: Date;
}

export async function seedHistory(): Promise<void> {
  await resetWorld();
  const sql = connect();
  try {
    await sql`delete from loads`;
    await sql`delete from assignments`;

    const truckIds = new Map<number, string>();
    for (const n of [1131, 1140, 1147, 1153, 1158, 1162, 1169, 1176, 1188, 1199]) {
      const [t] = await sql<{ id: string }[]>`
        insert into trucks (samsara_vehicle_id, samsara_name, truck_number, active)
        values (${`sv-h${n}`}, ${`Truck #${n}`}, ${n}, true) returning id`;
      truckIds.set(n, t!.id);
    }
    const driverIds = new Map<string, string>();
    for (const name of [
      'Marcus Reyes', 'Dana Kowalski', 'Luis Ortega', 'Priya Natarajan',
      'Tomasz Wiśniewski', 'Andre Baptiste', 'Hannah Brooks', 'Samuel Okafor',
    ]) {
      const [d] = await sql<{ id: string }[]>`insert into drivers (name) values (${name}) returning id`;
      driverIds.set(name, d!.id);
    }
    const assign = (name: string, truck: number, from: Date, to: Date | null = null) =>
      sql`insert into assignments (truck_id, driver_id, started_at, ended_at)
          values (${truckIds.get(truck)!}, ${driverIds.get(name)!}, ${from}, ${to})`;

    await assign('Marcus Reyes', 1147, SINCE);
    // Dana: 1162 until Wednesday morning, then 1188.
    await assign('Dana Kowalski', 1162, SINCE, at(W40, 2, 6));
    await assign('Dana Kowalski', 1188, at(W40, 2, 6));
    // Luis: 1131 until Wednesday night of week 40 — a part-week truck.
    await assign('Luis Ortega', 1131, SINCE, at(W40, 2, 23));
    await assign('Priya Natarajan', 1176, SINCE);
    await assign('Tomasz Wiśniewski', 1153, SINCE);
    await assign('Andre Baptiste', 1140, SINCE);
    await assign('Hannah Brooks', 1169, SINCE);
    await assign('Samuel Okafor', 1158, SINCE);

    const load = async (
      truck: number,
      number: string | null,
      status: Status,
      created: Date,
      stops: StopSeed[],
    ) => {
      const [l] = await sql<{ id: string }[]>`
        insert into loads (truck_id, load_number, status, created_at)
        values (${truckIds.get(truck)!}, ${number}, ${status}, ${created}) returning id`;
      for (const [i, s] of stops.entries()) {
        await sql`
          insert into stops (load_id, type, sequence, city, state, arrived_at, arrived_source,
                             departed_at, departed_source)
          values (${l!.id}, ${s.type}, ${i + 1}, ${s.city}, ${s.state}, ${s.arrived ?? null},
                  ${s.arrived ? 'detected' : null}, ${s.departed ?? null},
                  ${s.departed ? 'detected' : null})`;
      }
    };
    /** A pickup load and a delivery load under one number: the page pairs them. */
    const pair = async (
      truck: number,
      number: string,
      week: IsoWeek,
      pu: [number, number, string, string],
      del: [number, number, string, string] | null,
      status: Status = 'DELIVERED',
    ) => {
      const [pd, ph, pc, ps] = pu;
      await load(truck, number, del ? 'DELIVERED' : status, at(week, pd, ph - 2), [
        { type: 'PU', city: pc, state: ps, arrived: at(week, pd, ph, 40), departed: at(week, pd, ph + 1, 55) },
      ]);
      if (del) {
        const [dd, dh, dc, ds] = del;
        await load(truck, number, status, at(week, pd, ph - 2), [
          { type: 'DEL', city: dc, state: ds, arrived: at(week, dd, dh, 20), departed: at(week, dd, dh + 1, 5) },
        ]);
      }
    };
    const one = (truck: number, number: string | null, week: IsoWeek, d: number, h: number, stop: Omit<StopSeed, 'arrived' | 'departed'>, status: Status = 'DELIVERED', departs = true) =>
      load(truck, number, status, at(week, d, h - 3), [
        { ...stop, arrived: at(week, d, h, 15), ...(departs ? { departed: at(week, d, h + 1, 5) } : {}) },
      ]);

    // ---- Week 40: A, a normal week (today is Friday) ----
    await pair(1147, '48213', W40, [0, 6, 'Melrose Park', 'IL'], [0, 16, 'Fargo', 'ND']);
    await pair(1147, '48240', W40, [1, 7, 'Fargo', 'ND'], [1, 15, 'Sioux Falls', 'SD']);
    await one(1147, '48277', W40, 3, 9, { type: 'PU', city: 'Joliet', state: 'IL' });
    await one(1147, '48301', W40, 4, 7, { type: 'PU', city: 'Joliet', state: 'IL' }, 'LOADED', false);
    await load(1147, '48301', 'LOADED', at(W40, 4, 5), [{ type: 'DEL', city: 'Indianapolis', state: 'IN' }]);
    await load(1147, '48231', 'DISPATCHED', at(W40, 0, 5), [{ type: 'PU', city: 'Melrose Park', state: 'IL' }]);

    await pair(1162, '48215', W40, [0, 8, 'Cicero', 'IL'], [0, 14, 'Milwaukee', 'WI']);
    await one(1162, null, W40, 1, 11, { type: 'DEL', city: 'Green Bay', state: 'WI' });
    await one(1188, '48260', W40, 2, 8, { type: 'PU', city: 'Elk Grove Village', state: 'IL' }, 'CANCELLED');
    await pair(1188, '48262', W40, [2, 10, 'Elk Grove Village', 'IL'], [2, 15, 'Rockford', 'IL']);
    await one(1188, '48305', W40, 4, 9, { type: 'PU', city: 'Bolingbrook', state: 'IL' }, 'LOADED', false);

    await pair(1131, '48218', W40, [0, 7, 'Bedford Park', 'IL'], [0, 15, 'St. Louis', 'MO']);
    await pair(1131, '48244', W40, [1, 8, 'St. Louis', 'MO'], [1, 13, 'Springfield', 'IL']);
    await one(1131, '48266', W40, 2, 12, { type: 'DEL', city: 'Champaign', state: 'IL' });

    await one(1176, '48247', W40, 1, 10, { type: 'DEL', city: 'Cedar Rapids', state: 'IA' });
    await pair(1176, '48280', W40, [3, 7, 'Cedar Rapids', 'IA'], [3, 16, 'Kansas City', 'MO']);
    await one(1176, null, W40, 4, 8, { type: 'PU', city: 'Kansas City', state: 'MO' }, 'LOADED', false);

    await one(1140, '48220', W40, 0, 9, { type: 'PU', city: 'Melrose Park', state: 'IL' });
    await one(1140, '48249', W40, 1, 12, { type: 'DEL', city: 'Fort Wayne', state: 'IN' });
    await one(1140, '48283', W40, 3, 8, { type: 'PU', city: 'Gary', state: 'IN' }, 'TONU');
    await one(1140, '48309', W40, 4, 6, { type: 'PU', city: 'Toledo', state: 'OH' }, 'LOADED', false);
    await load(1140, '48309', 'LOADED', at(W40, 4, 4), [{ type: 'DEL', city: 'Detroit', state: 'MI' }]);

    await pair(1169, '48268', W40, [2, 7, 'Aurora', 'IL'], [2, 17, 'Omaha', 'NE']);
    await pair(1169, '48286', W40, [3, 8, 'Omaha', 'NE'], [3, 12, 'Lincoln', 'NE']);

    await pair(1158, '48224', W40, [0, 6, 'Naperville', 'IL'], [0, 13, 'Louisville', 'KY']);
    await pair(1158, '48251', W40, [1, 7, 'Louisville', 'KY'], [1, 12, 'Nashville', 'TN']);
    await pair(1158, '48270', W40, [2, 7, 'Nashville', 'TN'], [2, 11, 'Memphis', 'TN']);
    await one(1158, '48288', W40, 3, 10, { type: 'DEL', city: 'Little Rock', state: 'AR' });

    // A truck with no driver, reached, and one never reached.
    await one(1199, '48299', W40, 2, 13, { type: 'DEL', city: 'Hodgkins', state: 'IL' });
    await load(1199, '48298', 'DISPATCHED', at(W40, 2, 9), [{ type: 'PU', city: 'Hodgkins', state: 'IL' }]);

    // ---- Week 39: C, a busy week ----
    await one(1147, '48177', W39, 3, 7, { type: 'PU', city: 'Joliet', state: 'IL' });
    await pair(1147, '48179', W39, [3, 9, 'Joliet', 'IL'], [3, 12, 'Kankakee', 'IL']);
    await pair(1147, '48182', W39, [3, 14, 'Kankakee', 'IL'], [3, 18, 'Champaign', 'IL']);
    await one(1140, null, W39, 1, 6, { type: 'DEL', city: 'Fort Wayne', state: 'IN' });
    await pair(1140, '48151', W39, [1, 8, 'Fort Wayne', 'IN'], [1, 11, 'Elkhart', 'IN']);
    await one(1140, '48153', W39, 1, 13, { type: 'PU', city: 'Elkhart', state: 'IN' }, 'CANCELLED');
    await pair(1140, '48155', W39, [1, 15, 'South Bend', 'IN'], [1, 18, 'Gary', 'IN']);
    await pair(1158, '48190', W39, [5, 8, 'Memphis', 'TN'], [5, 15, 'Little Rock', 'AR']);
    await one(1176, '48192', W39, 5, 10, { type: 'DEL', city: 'Bloomington-Normal', state: 'IL' }, 'CANCELLED');
    await one(1169, null, W39, 6, 9, { type: 'PU', city: 'Aurora', state: 'IL' });
    await pair(1162, '48160', W39, [0, 8, 'Cicero', 'IL'], [0, 14, 'Milwaukee', 'WI']);
    await pair(1131, '48163', W39, [2, 7, 'Bedford Park', 'IL'], [2, 16, 'St. Louis', 'MO']);
    await one(1153, '48170', W39, 4, 11, { type: 'DEL', city: 'Peoria', state: 'IL' });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** The browser's frozen "now" for the history shots: Fri Oct 2, 2026, 10:42 CDT. */
export const HISTORY_NOW = zonedWallToUtc({ y: 2026, m: 10, d: 2 }, 10, 42, TZ);

/**
 * §12.103 — a week too long for one printed page: week 38 (otherwise empty)
 * with four loads a day — more than the screen shows before "+2 more" — on
 * Thursday to Sunday, the days the drivers have their trucks (`SINCE`), for
 * six drivers. Added on top of
 * `seedHistory()`, for the print tests only; every other spec keeps week 38
 * empty.
 */
export const LONG_WEEK = '2026-W38';
export const LONG_WEEK_DRIVERS = [
  ['Marcus Reyes', 1147], ['Dana Kowalski', 1162], ['Luis Ortega', 1131],
  ['Priya Natarajan', 1176], ['Andre Baptiste', 1140], ['Samuel Okafor', 1158],
] as const;
/** The load numbers seeded for one driver's row, in day order. */
export const longWeekNumbers = (row: number) =>
  Array.from({ length: 16 }, (_, i) => String(38_000 + row * 100 + i));

export async function seedLongWeek(): Promise<void> {
  const sql = connect();
  const W38 = { year: 2026, week: 38 };
  const places = [['Joliet', 'IL'], ['Gary', 'IN'], ['Peoria', 'IL'], ['Rockford', 'IL'], ['Toledo', 'OH']] as const;
  try {
    for (const [row, [, truck]] of LONG_WEEK_DRIVERS.entries()) {
      const [t] = await sql<{ id: string }[]>`select id from trucks where truck_number = ${truck}`;
      for (const [i, number] of longWeekNumbers(row).entries()) {
        const day = 3 + Math.floor(i / 4);
        const hour = 9 + (i % 4) * 3;
        const [city, state] = places[(row + i) % places.length]!;
        const [l] = await sql<{ id: string }[]>`
          insert into loads (truck_id, load_number, status, created_at)
          values (${t!.id}, ${number}, 'DELIVERED', ${at(W38, day, hour - 2)}) returning id`;
        await sql`
          insert into stops (load_id, type, sequence, city, state, arrived_at, arrived_source,
                             departed_at, departed_source)
          values (${l!.id}, ${i % 2 ? 'DEL' : 'PU'}, 1, ${city}, ${state}, ${at(W38, day, hour, 10)},
                  'detected', ${at(W38, day, hour + 1, 5)}, 'detected')`;
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}
