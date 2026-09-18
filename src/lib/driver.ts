import { z } from 'zod';

/**
 * Drivers a dispatcher creates (§12.35).
 *
 * A new hire is on the board before anyone adds them to the ELD, so the board
 * has to be able to represent a driver Samsara has never heard of.
 */

/**
 * NAME ONLY, and everything else optional.
 *
 * That is the whole point of the feature: a new hire exists before their
 * paperwork does. A required field a dispatcher cannot fill at 6am is a
 * required field they will fake, and faked data looks real to the next shift.
 *
 * Phone is here because for a driver with no ELD it is the ONLY way to reach
 * them — there is no position, no HOS, nothing. Samsara returns no phone for
 * this org, so it was always ours to collect.
 *
 * Nothing else. Not licence (never stored, by policy — see db/schema.ts), not
 * an employee number: a field with no consumer is a field that goes stale
 * while looking authoritative.
 */
export const DriverCreate = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'A name is required.')
      .max(120, 'Name is too long (120 characters).'),
    phone: z
      .string()
      .trim()
      .max(40)
      .transform((value) => (value === '' ? null : value))
      .nullable()
      .optional(),
  })
  .strict();

export type DriverCreate = z.infer<typeof DriverCreate>;

/**
 * How two names are compared when looking for a merge candidate.
 *
 * Deliberately crude — case, punctuation and runs of whitespace only. It is
 * not trying to be clever, because it never decides anything on its own: a
 * match OFFERS a merge to a human and nothing more (§12.35). Making it
 * cleverer would raise the rate of confident wrong matches, which is the one
 * outcome that silently rewrites assignment history.
 */
export function normalizeDriverName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    // Strip accents, so "José" and "Jose" are the same person.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,'`’-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when two names are close enough to ASK about. Never to act on. */
export function namesMatch(a: string, b: string): boolean {
  const left = normalizeDriverName(a);
  const right = normalizeDriverName(b);
  return left.length > 0 && left === right;
}

export type DriverSource = 'samsara' | 'app';

/**
 * What the UI says beside a driver with no ELD behind them.
 *
 * A dispatcher has to be able to tell the two apart, because it changes what
 * "no position" means: expected for an app-created driver, broken for a
 * Samsara-backed one. Provenance, not status — so it reads as a quiet tag
 * rather than borrowing a status colour.
 */
export const NO_ELD_LABEL = 'No ELD';

export function isEldBacked(driver: { source: DriverSource; samsaraDriverId: string | null }): boolean {
  return driver.source === 'samsara' || driver.samsaraDriverId !== null;
}
