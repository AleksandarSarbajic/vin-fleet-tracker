import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  AppointmentTimeError,
  wallText,
  type AppointmentInput,
  type AppointmentResolution,
} from '@/lib/appointment';

/**
 * Stop-local wall time -> UTC instant, done by Postgres.
 *
 * Postgres carries the same tzdata the world runs on (1,196 zones on this
 * instance) and `timezone(zone, timestamp)` is exactly the primitive needed:
 * it reads a naive timestamp AS wall time in that zone and returns the
 * instant. No JS date arithmetic, no second implementation to disagree with
 * the first.
 *
 * The parts cross the driver as INTEGERS via make_timestamp. Never as a
 * string — see the note on AppointmentTime in lib/appointment.ts.
 */

/** The instant. The only place wall time becomes an instant in this app. */
export function appointmentStartSql(input: AppointmentInput): SQL {
  const { y, m, d } = input.date;
  const { h, min } = input.time;
  return sql`timezone(${input.tz},
    make_timestamp(${y}::int, ${m}::int, ${d}::int, ${h}::int, ${min}::int, 0))`;
}

/** Start + window. Null for FCFS — a cutoff has no end (§12.2). */
export function appointmentEndSql(input: AppointmentInput): SQL | null {
  if (input.type === 'FCFS' || input.windowMinutes === null) return null;
  return sql`${appointmentStartSql(input)}
    + make_interval(mins => ${input.windowMinutes}::int)`;
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

/**
 * Raw `sql` results are whatever the driver decoded, so the shape is parsed
 * rather than asserted — the same rule the fleet query learned the hard way.
 */
const ResolveRow = z
  .object({
    start_utc: z.string().regex(ISO_UTC),
    end_utc: z.string().regex(ISO_UTC).nullable(),
    /** The wall time Postgres reads back out of the instant it computed. */
    reads_back_as: z.string(),
    /** True when the hour before lands on the same wall time (fall-back). */
    ambiguous: z.boolean(),
  })
  .strict();

export interface ResolvedAppointment {
  /** ISO-8601 UTC. What goes in appointment_start_utc. */
  startUtc: string;
  endUtc: string | null;
  /** The zone as entered. Stored beside the instant, never an abbreviation. */
  tz: string;
  resolution: AppointmentResolution;
}

/** A handle that can run raw SQL: the pooled db, or a transaction. */
export interface Executor {
  execute: (query: SQL) => Promise<unknown>;
}

/**
 * Converts, and checks its own work by converting back.
 *
 * Two DST pathologies, both measured against the real database rather than
 * looked up, both handled without a rules table:
 *
 *   NONEXISTENT  2026-03-08 02:30 America/Chicago. The clocks jump 02:00 ->
 *                03:00, so that wall time never happens. Postgres answers
 *                with 08:30Z, which reads back as 03:30 — an hour later than
 *                the dispatcher typed. Detected by the round trip
 *                disagreeing, and REFUSED. Storing it silently is how an app
 *                ends up an hour wrong on a real delivery.
 *
 *   AMBIGUOUS    2026-11-01 01:30 America/Chicago happens twice. Postgres
 *                resolves it to the SECOND one (CST, 07:30Z); it round-trips
 *                cleanly, so only a separate check finds it. Detected by
 *                asking whether the instant an hour earlier reads back as the
 *                same wall time, and ACCEPTED — with `resolution:
 *                'ambiguous'` so the UI can say which of the two it stored.
 */
export async function resolveAppointment(
  executor: Executor,
  input: AppointmentInput,
): Promise<ResolvedAppointment> {
  const start = appointmentStartSql(input);
  const end = appointmentEndSql(input);

  /**
   * Every expression is parenthesised. AT TIME ZONE binds TIGHTER than `+`
   * and `-`, so `start + interval at time zone 'UTC'` parses as
   * `start + (interval at time zone 'UTC')` and fails with
   * `function timezone(unknown, interval) does not exist`. Found by running
   * it; the precedence is not obvious from reading it.
   */
  const result = await executor.execute(sql`
    select
      to_char((${start}) at time zone 'UTC', ${sql.raw(ISO)})           as start_utc,
      ${end ? sql`to_char((${end}) at time zone 'UTC', ${sql.raw(ISO)})` : sql`null::text`}
                                                                       as end_utc,
      to_char((${start}) at time zone ${input.tz}, 'YYYY-MM-DD HH24:MI') as reads_back_as,
      to_char(((${start}) - interval '1 hour') at time zone ${input.tz},
              'YYYY-MM-DD HH24:MI')
        = to_char((${start}) at time zone ${input.tz}, 'YYYY-MM-DD HH24:MI')
                                                                       as ambiguous
  `);

  const rows = z.array(ResolveRow).parse(result);
  const row = rows[0];
  if (!row) throw new Error('The appointment conversion returned no row.');

  const wall = wallText(input);
  if (row.reads_back_as !== wall) {
    throw new AppointmentTimeError(wall, input.tz, row.reads_back_as);
  }

  return {
    startUtc: row.start_utc,
    endUtc: row.end_utc,
    tz: input.tz,
    resolution: row.ambiguous ? 'ambiguous' : 'exact',
  };
}
