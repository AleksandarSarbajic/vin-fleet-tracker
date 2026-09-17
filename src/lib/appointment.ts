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
    /** Minutes after `time`. Null for FCFS: a cutoff is not a slot (§12.2). */
    windowMinutes: z.number().int().min(0).max(MAX_WINDOW_MINUTES).nullable(),
  })
  .strict()
  .refine((a) => a.type !== 'FCFS' || a.windowMinutes === null, {
    path: ['windowMinutes'],
    message:
      'An FCFS stop has a cutoff, not a window. appointment_end_utc stays null.',
  });

export type AppointmentInput = z.infer<typeof AppointmentInput>;

/**
 * What the server made of it. `resolution` is not decoration — it is the
 * answer to "which 01:30 did I get?" on the one night a year the question
 * has two answers.
 */
export const APPOINTMENT_RESOLUTIONS = ['exact', 'ambiguous'] as const;
export type AppointmentResolution = (typeof APPOINTMENT_RESOLUTIONS)[number];

/** Zero-padded wall time, for comparing against what Postgres read back. */
export function wallText(input: Pick<AppointmentInput, 'date' | 'time'>): string {
  const p = (n: number, width = 2) => String(n).padStart(width, '0');
  const { y, m, d } = input.date;
  const { h, min } = input.time;
  return `${p(y, 4)}-${p(m)}-${p(d)} ${p(h)}:${p(min)}`;
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
  ) {
    super(
      `${wall} does not exist in ${tz} — the clocks jump that hour, and it ` +
        `would be stored as ${became}.`,
    );
    this.name = 'AppointmentTimeError';
  }
}
