import { z } from 'zod';
import { FORCED_STATUSES, OVERRIDE_REASONS } from './status';
import { WallTimeInput } from './appointment';

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
  /**
   * §12.58. Deliberately worded about the STOP, not the truck: the ELD is
   * fine and the position is right — our coordinate for the destination
   * cannot register an arrival, so the board will never flip it on its own.
   */
  ARRIVAL_NOT_DETECTED: 'Arrival cannot be detected for this stop',
  DRIVER_REPORTED_DELAY: 'Driver reported delay by phone',
  OTHER: 'Other — note required',
};

/**
 * A custom expiry is a WALL TIME plus a zone, exactly like an appointment,
 * and it goes through the same integer-parts conversion. Two conversion paths
 * for the same kind of value is where the two-hour appointment bug lived.
 *
 * It IS `WallTimeInput` now rather than a third copy of the same three
 * fields — the alias is kept because `customExpiry` is what the wire calls it
 * and renaming it would be a contract change for no gain.
 */
export const CustomExpiry = WallTimeInput;

/**
 * Everything about an override EXCEPT which stop it is on.
 *
 * Split out because the override now travels inside the stop save (§12.28),
 * and on a new load the stop does not have an id yet — it is created in the
 * same transaction. The server fills `stopId` in from the row it just wrote,
 * which is also the only version it would be right to trust.
 *
 * The refinements are applied to both shapes below rather than to this
 * object, because Zod cannot `.omit()` from a schema that already carries
 * them — and two hand-maintained copies of a validation rule is exactly how
 * §12.21 survived in one layer after being removed from another.
 */
const overrideFields = {
  forcedStatus: z.enum(FORCED_STATUSES),
  reason: z.enum(OVERRIDE_REASONS),
  reasonNote: z.string().trim().max(500).nullable(),
  expiry: z.enum(EXPIRY_PRESETS),
  /** Required when `expiry` is CUSTOM, refused otherwise. */
  customExpiry: CustomExpiry.nullable(),
} as const;

/** The three rules, applied identically wherever the fields appear. */
function withOverrideRules<T extends z.ZodTypeAny>(schema: T) {
  return schema
    .refine(
      (o: z.infer<T>) => o.reason !== 'OTHER' || (o.reasonNote ?? '').trim().length > 0,
      {
        path: ['reasonNote'],
        // Overrides are countable in review rather than merely readable only
        // if "Other" carries its note (§9.5).
        message: 'Say what "Other" means here — this note is the only record of it.',
      },
    )
    .refine((o: z.infer<T>) => o.expiry !== 'CUSTOM' || o.customExpiry !== null, {
      path: ['customExpiry'],
      message: 'Give the date and time this override should stop applying.',
    })
    .refine((o: z.infer<T>) => o.expiry === 'CUSTOM' || o.customExpiry === null, {
      path: ['customExpiry'],
      message: 'A preset expiry does not take a custom time.',
    });
}

/** Standalone: `Clear now`'s sibling, and what server/override.ts takes. */
export const OverrideInput = withOverrideRules(
  z.object({ stopId: z.string().uuid(), ...overrideFields }).strict(),
);

export type OverrideInput = z.infer<typeof OverrideInput>;

/**
 * What rides inside a stop save. No `stopId` — the server uses the stop it
 * just wrote, so a new load's override lands in the same transaction as the
 * load, the stop and the appointment (§12.28).
 */
export const StopOverrideEdit = z.union([
  z.object({ action: z.literal('clear') }).strict(),
  // A plain union rather than discriminatedUnion: the refinements turn the
  // `set` branch into a ZodEffects, which discriminatedUnion will not take.
  withOverrideRules(z.object({ action: z.literal('set'), ...overrideFields }).strict()),
]);

export type StopOverrideEdit = z.infer<typeof StopOverrideEdit>;

/**
 * §14 feature 2. The same override, applied to several stops at once.
 *
 * Reuses `overrideFields` and `withOverrideRules` rather than restating them:
 * a bulk override that could carry an "Other" with no note, or a CUSTOM
 * expiry with no time, would be a second set of rules for the same act, and
 * §9.5's review is counting them together.
 *
 * `stopIds` is bounded. Not because the transaction could not take more, but
 * because a bulk status write is a claim a person is making about every truck
 * in it, and past a couple of dozen nobody is making that claim — they are
 * clicking. The bar's own selection is capped by what fits on screen.
 */
export const BulkOverrideInput = withOverrideRules(
  z
    .object({
      stopIds: z.array(z.string().uuid()).min(1).max(40),
      ...overrideFields,
    })
    .strict(),
);
export type BulkOverrideInput = z.infer<typeof BulkOverrideInput>;

/**
 * §14 feature 2. A dispatcher note on several stops.
 *
 * Trimmed, and a blank one is a refusal rather than a clear: bulk-clearing
 * notes across trucks would destroy text nobody can recover, and §12.23's
 * "omitted means leave alone" has no gesture here to express it.
 */
export const BulkNoteInput = z
  .object({
    stopIds: z.array(z.string().uuid()).min(1).max(40),
    note: z.string().trim().min(1).max(500),
  })
  .strict();
export type BulkNoteInput = z.infer<typeof BulkNoteInput>;

/** Clearing is its own action — `Clear now` in the detail block (§9.5). */
export const ClearOverrideInput = z.object({ stopId: z.string().uuid() }).strict();
export type ClearOverrideInput = z.infer<typeof ClearOverrideInput>;
