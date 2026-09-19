import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  AppointmentTimeError,
  wallText,
  type AppointmentInput,
  type AppointmentResolution,
  type WallTimeInput,
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
export function appointmentStartSql(input: Pick<AppointmentInput, 'date' | 'time' | 'tz'>): SQL {
  const { y, m, d } = input.date;
  const { h, min } = input.time;
  return sql`timezone(${input.tz},
    make_timestamp(${y}::int, ${m}::int, ${d}::int, ${h}::int, ${min}::int, 0))`;
}

/**
 * The end instant, which means two different things (§12.22):
 *
 *   APPT  start + the ± window, or null for an exact time.
 *   FCFS  the LATEST receiving hour — a wall time in its own right, typed by
 *         the dispatcher, and therefore converted the same way the start is
 *         rather than derived by arithmetic.
 */
export function appointmentEndSql(input: AppointmentInput): SQL | null {
  if (input.type === 'FCFS') {
    const end = input.endTime;
    if (!end) return null;
    const { y, m, d } = input.date;
    return sql`timezone(${input.tz},
      make_timestamp(${y}::int, ${m}::int, ${d}::int, ${end.h}::int, ${end.min}::int, 0))`;
  }
  if (input.windowMinutes === null) return null;
  return sql`(${appointmentStartSql(input)})
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
    /**
     * Same check for the FCFS latest hour, which is typed rather than
     * derived. Null for an APPT stop, whose end is start + window and so
     * cannot land in an hour the start did not.
     */
    end_reads_back_as: z.string().nullable(),
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
  /** Only a typed wall time needs checking; a derived one inherits the check. */
  const typedEnd = input.type === 'FCFS' && end ? end : null;

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
      ${
        typedEnd
          ? sql`to_char((${typedEnd}) at time zone ${input.tz}, 'YYYY-MM-DD HH24:MI')`
          : sql`null::text`
      }                                                                    as end_reads_back_as,
      to_char(((${start}) - interval '1 hour') at time zone ${input.tz},
              'YYYY-MM-DD HH24:MI')
        = to_char((${start}) at time zone ${input.tz}, 'YYYY-MM-DD HH24:MI')
                                                                       as ambiguous
  `);

  const rows = z.array(ResolveRow).parse(result);
  const row = rows[0];
  if (!row) throw new Error('The appointment conversion returned no row.');

  const wall = wallText(input, input.time);
  if (row.reads_back_as !== wall) {
    throw new AppointmentTimeError(wall, input.tz, row.reads_back_as);
  }

  // The FCFS latest hour is typed by a person too, so it can land in the
  // hour that does not exist just as easily — 02:00-03:00 sits inside
  // plausible night receiving hours.
  if (input.endTime && row.end_reads_back_as !== null) {
    const endWall = wallText(input, input.endTime);
    if (row.end_reads_back_as !== endWall) {
      throw new AppointmentTimeError(
        endWall,
        input.tz,
        row.end_reads_back_as,
        'appointment.endTime',
      );
    }
  }

  return {
    startUtc: row.start_utc,
    endUtc: row.end_utc,
    tz: input.tz,
    resolution: row.ambiguous ? 'ambiguous' : 'exact',
  };
}

/* -------------------------------------------------------------------------
 * §12.57 — a bare wall time, for the hand-entered arrival
 * ---------------------------------------------------------------------- */

/**
 * The same conversion as an appointment's start, for a value that is only a
 * time — no window, no type, no second hour.
 *
 * It calls `appointmentStartSql`, so there is still exactly ONE place where a
 * wall time becomes an instant. What it repeats is the round-trip CHECK, not
 * the conversion: `resolveAppointment` verifies start and end in one query
 * because it has two to verify, and folding this into it would mean giving it
 * a third shape of input to branch on. A duplicated guard is cheap; a second
 * conversion is the two-hour bug.
 *
 * Both DST pathologies apply here for the same reasons they do to an
 * appointment, and one of them harder: a NONEXISTENT wall time silently
 * stored an hour late would be a record of when a truck was somewhere, which
 * is the thing detention is argued from.
 */
export async function resolveWallTime(
  executor: Executor,
  input: WallTimeInput,
  field: 'arrivedAt.time' = 'arrivedAt.time',
): Promise<{ utc: string; resolution: AppointmentResolution }> {
  const at = appointmentStartSql(input);

  const result = await executor.execute(sql`
    select
      to_char((${at}) at time zone 'UTC', ${sql.raw(ISO)})              as start_utc,
      null::text                                                       as end_utc,
      to_char((${at}) at time zone ${input.tz}, 'YYYY-MM-DD HH24:MI')   as reads_back_as,
      null::text                                                       as end_reads_back_as,
      to_char(((${at}) - interval '1 hour') at time zone ${input.tz},
              'YYYY-MM-DD HH24:MI')
        = to_char((${at}) at time zone ${input.tz}, 'YYYY-MM-DD HH24:MI')
                                                                       as ambiguous
  `);

  const rows = z.array(ResolveRow).parse(result);
  const row = rows[0];
  if (!row) throw new Error('The wall-time conversion returned no row.');

  const wall = wallText(input, input.time);
  if (row.reads_back_as !== wall) {
    throw new AppointmentTimeError(wall, input.tz, row.reads_back_as, field);
  }

  return { utc: row.start_utc, resolution: row.ambiguous ? 'ambiguous' : 'exact' };
}
