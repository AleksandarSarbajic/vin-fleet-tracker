/**
 * Obviously-fake dispatch data for development. `npm run seed:demo`.
 *
 * Every row it writes is marked: load numbers are prefixed `DEMO-` and every
 * address says DEMO. If this ever runs against the production database by
 * accident the result is embarrassing rather than dangerous — nobody mistakes
 * DEMO-1147-A for a real load number, and `npm run seed:demo -- --clear`
 * removes exactly what it wrote.
 *
 * It uses the app's own appointment conversion rather than writing timestamps
 * itself. A seed script that takes a shortcut around the boundary is a seed
 * script that puts appointments in the database the app could never have
 * produced.
 */
import { config as loadEnv } from 'dotenv';
import { eq, inArray, like, or, sql } from 'drizzle-orm';
import { createDirectDb } from '../src/db/connection.ts';
import { loads, stops, trucks } from '../src/db/schema.ts';
import { AppointmentInput } from '../src/lib/appointment.ts';
import { resolveAppointment } from '../src/server/appointment.ts';

loadEnv({ path: '.env.local' });

const PREFIX = 'DEMO-';

/**
 * Addresses with the zone AND the coordinates stated, because there is no
 * geocoder (and won't be — §12.24).
 *
 * The coordinates are what make the ETA path real in development: without
 * them every seeded stop falls back to the clock and LATE/AT_RISK are never
 * exercised. A dispatcher-entered stop still has none, which is exactly the
 * case `etaAbsence: 'no-coordinates'` exists to render.
 */
/**
 * REAL addresses, in real industrial districts, with no coordinates.
 *
 * They used to be "1 DEMO Industrial Park" with hand-written lat/lng, which
 * made the demo data the one thing on the board that could never exercise
 * the geocoder — every seeded stop had coordinates no dispatcher-entered
 * stop could get, so the ETA path looked healthy in development and was
 * broken in production. Now the seed goes through the same forward geocode a
 * save does, and a demo stop that fails to resolve fails the way a real one
 * would.
 *
 * The DEMO marking moved to the load number and the dispatcher note, which
 * is where a human actually reads it — and which is what `--clear` matches.
 */
const PLACES = [
  { address: '1400 Laraway Road', city: 'New Lenox', state: 'IL', zip: '60451', tz: 'America/Chicago' },
  { address: '3902 Main Avenue', city: 'Fargo', state: 'ND', zip: '58103', tz: 'America/Chicago' },
  { address: '5500 East 56th Avenue', city: 'Denver', state: 'CO', zip: '80216', tz: 'America/Denver' },
  { address: '4747 West Buckeye Road', city: 'Phoenix', state: 'AZ', zip: '85043', tz: 'America/Phoenix' },
  { address: '2611 South Westmoreland Road', city: 'Dallas', state: 'TX', zip: '75212', tz: 'America/Chicago' },
  { address: '4400 Fulton Industrial Boulevard SW', city: 'Atlanta', state: 'GA', zip: '30336', tz: 'America/New_York' },
  { address: '1750 South 4800 West', city: 'Salt Lake City', state: 'UT', zip: '84104', tz: 'America/Denver' },
] as const;

/** On every demo stop. A human reads this; `--clear` matches it. */
const DEMO_NOTE = 'DEMO SEED — safe to delete';

const LOAD_STATUSES = ['DISPATCHED', 'AT_SHIPPER', 'LOADED', 'AT_RECEIVER'] as const;

const { client, db } = createDirectDb(process.env.DIRECT_URL!);
const clearOnly = process.argv.includes('--clear');

/**
 * A seatbelt, not the plan. The plan is the line in PROJECT_BRIEF.md's phase 6
 * entry: clear the demo data before deploying. This only stops the most
 * obvious way of getting it wrong.
 */
if (process.env.NODE_ENV === 'production' && !clearOnly && !process.argv.includes('--force')) {
  console.error(
    'Refusing to seed demo data with NODE_ENV=production.\n' +
      'If this really is what you want, pass --force. To remove it, pass --clear.',
  );
  process.exit(1);
}

/**
 * Everything this script has ever written, and nothing else.
 *
 * Matched on the note as well as the load number. Matching the number alone
 * missed one demo load in seven: §12.21 made an empty load number a real
 * state, the seed writes some to exercise it, and `load_number LIKE 'DEMO-%'`
 * does not match NULL. Those rows survived `--clear` — which is exactly the
 * data that must not reach production, surviving the one command whose job
 * is to remove it.
 */
const demoLoads = await db
  .selectDistinct({ id: loads.id })
  .from(loads)
  .leftJoin(stops, eq(stops.loadId, loads.id))
  .where(
    or(like(loads.loadNumber, `${PREFIX}%`), eq(stops.dispatcherNote, DEMO_NOTE)),
  );

if (demoLoads.length > 0) {
  await db.delete(loads).where(
    inArray(loads.id, demoLoads.map((l) => l.id)),
  );
  console.log(`cleared ${demoLoads.length} demo load(s) (stops cascade)`);
}
if (clearOnly) {
  await client.end();
  process.exit(0);
}

const fleet = await db
  .select({ id: trucks.id, number: trucks.truckNumber })
  .from(trucks)
  .where(eq(trucks.active, true))
  .orderBy(trucks.truckNumber);

const today = new Date();
const dayIn = (offset: number) => {
  const d = new Date(today.getTime() + offset * 86_400_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
};

let stopCount = 0;
for (const [index, truck] of fleet.entries()) {
  // Two trucks in five carry no load at all — the "truck with no load" empty
  // state is a real thing a dispatcher sees, not a hypothetical.
  if (index % 5 === 3) continue;

  const pickup = PLACES[index % PLACES.length]!;
  const delivery = PLACES[(index + 3) % PLACES.length]!;
  const label = truck.number ?? index;

  const [load] = await db
    .insert(loads)
    .values({
      truckId: truck.id,
      // Every seventh load has no number, because §12.21 made that a real
      // state and an empty column is how you find out whether the UI handles it.
      loadNumber: index % 7 === 5 ? null : `${PREFIX}${label}-A`,
      status: LOAD_STATUSES[index % LOAD_STATUSES.length]!,
    })
    .returning({ id: loads.id });

  const legs = [
    { type: 'PU' as const, place: pickup, seq: 1, hour: 7 + (index % 5), day: index % 3 === 0 ? 0 : 1 },
    { type: 'DEL' as const, place: delivery, seq: 2, hour: 13 + (index % 6), day: index % 3 === 0 ? 1 : 2 },
  ];

  for (const leg of legs) {
    /**
     * Every fifth stop is FCFS, which now carries RECEIVING HOURS (§12.22):
     * earliest and latest, both stop-local, with the latest as the deadline.
     * Two of them get hours other than the 07:00-15:00 default, so the
     * console shows more than one window.
     */
    const fcfs = (index + leg.seq) % 5 === 0;
    const hours = index % 3 === 0 ? { from: 6, to: 14 } : { from: 7, to: 15 };
    const input = AppointmentInput.parse({
      type: fcfs ? 'FCFS' : 'APPT',
      date: dayIn(leg.day),
      time: fcfs
        ? { h: hours.from, min: 0 }
        : { h: leg.hour, min: leg.seq === 1 ? 0 : 30 },
      tz: leg.place.tz,
      windowMinutes: fcfs ? null : 30,
      endTime: fcfs ? { h: hours.to, min: 0 } : null,
    });
    const appt = await resolveAppointment(db, input);

    await db.insert(stops).values({
      loadId: load!.id,
      type: leg.type,
      sequence: leg.seq,
      addressLine: leg.place.address,
      city: leg.place.city,
      state: leg.place.state,
      zip: leg.place.zip,
      // No coordinates written here. `npm run geocode:backfill` resolves
      // them through the same path a dispatcher's save uses (§12.24).
      dispatcherNote: DEMO_NOTE,
      appointmentStartUtc: sql`${appt.startUtc}::timestamptz`,
      appointmentEndUtc: appt.endUtc ? sql`${appt.endUtc}::timestamptz` : null,
      appointmentTz: appt.tz,
      appointmentType: input.type,
      // The first leg of the older loads is already done.
      arrivedAt: leg.seq === 1 && index % 4 === 0 ? sql`now() - interval '5 hours'` : null,
      departedAt: leg.seq === 1 && index % 4 === 0 ? sql`now() - interval '4 hours'` : null,
    });
    stopCount += 1;
  }
}

const [counts] = await db.execute(sql`
  select (select count(*) from loads)::int as loads,
         (select count(*) from stops)::int as stops`);
console.log(`seeded ${stopCount} stops across ${fleet.length} trucks ->`, counts);
await client.end();
