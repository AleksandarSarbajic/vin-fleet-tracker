import { z } from 'zod';

/**
 * The appointment contract, shared by the client and the server.
 *
 * An appointment is a WALL TIME at a facility plus the zone that facility
 * keeps. A rate confirmation reading 14:30 means 14:30 at the receiver, and
 * the only way to be sure that is what we stored is to never let an instant
 * near this boundary.
 *
 * So the wire format carries INTEGER PARTS, not a formatted string, and the
 * server converts. This is not fastidiousness — see the note on
 * `AppointmentWallTime` for the driver bug that made it necessary.
 */

/** IANA zone, e.g. "America/Chicago". Validated by asking Intl. */
export function isIanaZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * A fixed offset is not a facility zone. "UTC-5" cannot survive a DST
 * boundary, and an appointment entered in March is read again in November.
 */
const OFFSET_SHAPED = /^(utc|gmt|z|[+-]\d|etc\/)/i;

export const IanaZone = z
  .string()
  .min(1)
  .refine((tz) => !OFFSET_SHAPED.test(tz), {
    message:
      'Give the facility’s IANA zone (e.g. America/Chicago), not an offset. ' +
      'An offset cannot survive a DST boundary.',
  })
  .refine(isIanaZone, { message: 'Unknown IANA time zone' });

/**
 * The calendar date at the STOP, as written on the rate confirmation.
 * Not a Date, not an ISO string — three integers that cannot carry a zone.
 */
export const AppointmentDate = z
  .object({
    y: z.number().int().min(2000).max(2100),
    m: z.number().int().min(1).max(12),
    d: z.number().int().min(1).max(31),
  })
  .strict();

/**
 * The wall time at the STOP. 14:30 means 14:30 there.
 *
 * Integers rather than "14:30" for a measured reason: postgres.js infers a
 * timestamp parameter from a string used as `${wall}::timestamp` and
 * round-trips it through a JS Date, shifting it by the Node process's own UTC
 * offset. Measured against the real database from a CEST machine:
 *
 *   select ${'2026-09-18 14:30'}::timestamp::text  ->  "2026-09-18 12:30:00"
 *
 * Two hours of silent error on the one field that must not be silently wrong,
 * and every test written against our own code would still have passed. The
 * parts never become a string, so there is nothing for the driver to parse.
 */
export const AppointmentTime = z
  .object({
    h: z.number().int().min(0).max(23),
    min: z.number().int().min(0).max(59),
  })
  .strict();

/**
 * A stop-local wall time in full: the three date integers, the two time
 * integers, and the zone they are read in.
 *
 * Extracted because three things now carry one — the appointment, the
 * override's custom expiry, and the hand-entered arrival (§12.57) — and the
 * rule that matters is the same for all three: **the client never sends an
 * instant.** One schema, so a fourth caller cannot invent a fourth spelling
 * of it and a fourth conversion to go with it.
 */
export const WallTimeInput = z
  .object({ date: AppointmentDate, time: AppointmentTime, tz: IanaZone })
  .strict();

export type WallTimeInput = z.infer<typeof WallTimeInput>;

/** The default receiving hours on a new FCFS stop (§12.22). Editable per stop. */
export const DEFAULT_FCFS_HOURS = { earliest: { h: 7, min: 0 }, latest: { h: 15, min: 0 } };

export const APPOINTMENT_TYPES = ['APPT', 'FCFS'] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

/** 12 hours. Longer than any real dock window; a typo beyond it is a typo. */
export const MAX_WINDOW_MINUTES = 720;

/**
 * `.strict()` throughout, so a client that sends `startUtc`, `iso` or
 * `offset` is refused by name instead of having the unknown key dropped and
 * the appointment quietly saved from the fields that did parse.
 */
export const AppointmentInput = z
  .object({
    type: z.enum(APPOINTMENT_TYPES),
    date: AppointmentDate,
    time: AppointmentTime,
    tz: IanaZone,
    /** Minutes after `time`. APPT only — FCFS carries hours, not a window. */
    windowMinutes: z.number().int().min(0).max(MAX_WINDOW_MINUTES).nullable(),
    /**
     * FCFS only: the LATEST receiving hour, stop-local, same zone as `time`.
     * `time` is then the earliest hour, and this is the deadline the status
     * engine measures projected arrival against (§12.22).
     */
    endTime: AppointmentTime.nullable().optional(),
  })
  .strict()
  .refine((a) => a.type !== 'FCFS' || a.windowMinutes === null, {
    path: ['windowMinutes'],
    message: 'An FCFS stop carries receiving hours, not a ± window.',
  })
  .refine((a) => a.type !== 'FCFS' || (a.endTime ?? null) !== null, {
    path: ['endTime'],
    message: 'Give the latest receiving hour. It is the deadline for this stop.',
  })
  .refine((a) => a.type !== 'APPT' || (a.endTime ?? null) === null, {
    path: ['endTime'],
    message: 'An appointment has a ± window, not receiving hours.',
  })
  .refine(
    (a) =>
      a.type !== 'FCFS' ||
      !a.endTime ||
      a.endTime.h * 60 + a.endTime.min > a.time.h * 60 + a.time.min,
    {
      path: ['endTime'],
      message:
        'The latest receiving hour must be after the earliest, on the same ' +
        'day. Overnight receiving (22:00\u201306:00) is not supported yet \u2014 ' +
        'see \u00a712.22.',
    },
  );

export type AppointmentInput = z.infer<typeof AppointmentInput>;

/**
 * What the server made of it. `resolution` is not decoration — it is the
 * answer to "which 01:30 did I get?" on the one night a year the question
 * has two answers.
 */
export const APPOINTMENT_RESOLUTIONS = ['exact', 'ambiguous'] as const;
export type AppointmentResolution = (typeof APPOINTMENT_RESOLUTIONS)[number];

/** Zero-padded wall time, for comparing against what Postgres read back. */
export function wallText(
  input: Pick<AppointmentInput, 'date'>,
  time: { h: number; min: number },
): string {
  const p = (n: number, width = 2) => String(n).padStart(width, '0');
  const { y, m, d } = input.date;
  return `${p(y, 4)}-${p(m)}-${p(d)} ${p(time.h)}:${p(time.min)}`;
}

/**
 * Thrown when the wall time does not exist at that facility on that date —
 * the spring-forward hour. Postgres would silently answer with the instant an
 * hour later, so this is refused at the boundary and shown as a field error.
 */
export class AppointmentTimeError extends Error {
  constructor(
    readonly wall: string,
    readonly tz: string,
    readonly became: string,
    /**
     * Which field to hang the error on. `arrivedAt.time` is here because the
     * arrival is typed by a person too, and 02:30 on a spring-forward date is
     * as refusable there as in an appointment — more so, since it would go
     * into the one column that records when a truck was somewhere.
     */
    readonly field:
      | 'appointment.time'
      | 'appointment.endTime'
      | 'arrivedAt.time' = 'appointment.time',
  ) {
    super(
      `${wall} does not exist in ${tz} — the clocks jump that hour, and it ` +
        `would be stored as ${became}.`,
    );
    this.name = 'AppointmentTimeError';
  }
}
