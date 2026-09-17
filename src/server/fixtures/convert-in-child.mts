/**
 * Not a test — the child half of one. See appointment.test.ts.
 *
 * Converts one fixed appointment, and probes two ways of getting a wall time
 * across the driver on a BARE postgres.js client. The parent runs this under
 * two TZ environments and compares: an appointment at a facility cannot
 * depend on which machine happened to save it.
 *
 * Run it directly to see the numbers:
 *   TZ=Asia/Kolkata npx tsx src/server/fixtures/convert-in-child.mts
 */
import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { AppointmentInput } from '../../lib/appointment.js';
import { resolveAppointment } from '../appointment.js';

loadEnv({ path: '.env.local' });

const TZ = 'America/Chicago';
const WALL = '2026-09-18 14:30';
const FMT = `'YYYY-MM-DD"T"HH24:MI"Z"'`;

/** What we ship: drizzle, integer parts. */
const wrapped = postgres(process.env.DIRECT_URL!, { max: 1 });
const resolved = await resolveAppointment(
  drizzle(wrapped),
  AppointmentInput.parse({
    type: 'APPT',
    date: { y: 2026, m: 9, d: 18 },
    time: { h: 14, min: 30 },
    tz: TZ,
    windowMinutes: 30,
  }),
);
await wrapped.end({ timeout: 5 });

/**
 * A SEPARATE, unwrapped client. `drizzle(client)` replaces postgres.js's
 * timestamp serialisers on the client it wraps, so probing the raw behaviour
 * needs a connection drizzle has never touched — which is also exactly what
 * every script in scripts/ uses.
 */
const bare = postgres(process.env.DIRECT_URL!, { max: 1 });

/** The trap: a wall-time STRING cast with ::timestamp. */
const [trap] = await bare`
  select to_char(timezone(${TZ}, ${WALL}::timestamp) at time zone 'UTC',
                 ${bare.unsafe(FMT)}) as t`;

/** The same conversion from integer parts. Nothing for the driver to parse. */
const [safe] = await bare`
  select to_char(timezone(${TZ}, make_timestamp(${2026}, ${9}, ${18}, ${14}, ${30}, 0))
                 at time zone 'UTC', ${bare.unsafe(FMT)}) as t`;

console.log(
  JSON.stringify({
    tz: process.env.TZ ?? null,
    resolved,
    trap: trap?.['t'] ?? null,
    safe: safe?.['t'] ?? null,
  }),
);
await bare.end({ timeout: 5 });
