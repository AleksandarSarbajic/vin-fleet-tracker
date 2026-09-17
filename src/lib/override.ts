import { z } from 'zod';
import { FORCED_STATUSES, OVERRIDE_REASONS } from './status';
import { AppointmentDate, AppointmentTime, IanaZone } from './appointment';

/**
 * The status override contract (§9.5), shared by the client and the server.
 *
 * ONE schema. The modal validates with it and the route re-parses with it,
 * because §12.21 was a required-field rule that survived in the shared
 * validator after the column relaxed, and the only reason it could survive
 * was two copies of the rule.
 *
 * What each layer owns:
 *
 *   DB        forced_status in the three; reason NOT NULL; expires_at NOT
 *             NULL; OTHER needs a note; one live row per stop.
 *   THIS      the same four, so the modal can disable Save rather than
 *             letting the database say no.
 *   server    closes the previous live row, converts the two presets it
 *             alone can compute, writes the audit entry.
 *   engine    decides whether the row is still live (expiry on READ).
 *   render    forced chip, and the Showing/Computed pair.
 */

/**
 * Expiry. There is no `never` — `expires_at` is mandatory (§9.5), and the
 * default is +4h, NOT end of day: an end-of-day override set just after
 * midnight is twenty hours long and defeats the purpose (correction 4).
 */
export const EXPIRY_PRESETS = ['PLUS_4H', 'END_OF_DAY', 'UNTIL_APPT', 'CUSTOM'] as const;
export type ExpiryPreset = (typeof EXPIRY_PRESETS)[number];
export const DEFAULT_EXPIRY: ExpiryPreset = 'PLUS_4H';

export const EXPIRY_LABEL: Record<ExpiryPreset, string> = {
  PLUS_4H: '+4h',
  END_OF_DAY: 'End of day',
  UNTIL_APPT: 'Until appt',
  CUSTOM: 'Custom',
};

export const OVERRIDE_REASON_LABEL: Record<(typeof OVERRIDE_REASONS)[number], string> = {
  RECEIVER_CONFIRMED_DETENTION: 'Receiver confirmed detention',
  APPT_RESCHEDULED_BY_BROKER: 'Appointment rescheduled by broker',
  ELD_POSITION_WRONG: 'ELD position wrong or missing',
  DRIVER_REPORTED_DELAY: 'Driver reported delay by phone',
  OTHER: 'Other — note required',
};

/**
 * A custom expiry is a WALL TIME plus a zone, exactly like an appointment,
 * and it goes through the same integer-parts conversion. Two conversion paths
 * for the same kind of value is where the two-hour appointment bug lived.
 */
export const CustomExpiry = z
  .object({ date: AppointmentDate, time: AppointmentTime, tz: IanaZone })
  .strict();

export const OverrideInput = z
  .object({
    stopId: z.string().uuid(),
    forcedStatus: z.enum(FORCED_STATUSES),
    reason: z.enum(OVERRIDE_REASONS),
    reasonNote: z.string().trim().max(500).nullable(),
    expiry: z.enum(EXPIRY_PRESETS),
    /** Required when `expiry` is CUSTOM, refused otherwise. */
    customExpiry: CustomExpiry.nullable(),
  })
  .strict()
  .refine(
    (o) => o.reason !== 'OTHER' || (o.reasonNote ?? '').trim().length > 0,
    {
      path: ['reasonNote'],
      // Overrides are countable in review rather than merely readable only if
      // "Other" carries its note (§9.5).
      message: 'Say what "Other" means here — this note is the only record of it.',
    },
  )
  .refine((o) => o.expiry !== 'CUSTOM' || o.customExpiry !== null, {
    path: ['customExpiry'],
    message: 'Give the date and time this override should stop applying.',
  })
  .refine((o) => o.expiry === 'CUSTOM' || o.customExpiry === null, {
    path: ['customExpiry'],
    message: 'A preset expiry does not take a custom time.',
  });

export type OverrideInput = z.infer<typeof OverrideInput>;

/** Clearing is its own action — `Clear now` in the detail block (§9.5). */
export const ClearOverrideInput = z.object({ stopId: z.string().uuid() }).strict();
export type ClearOverrideInput = z.infer<typeof ClearOverrideInput>;
