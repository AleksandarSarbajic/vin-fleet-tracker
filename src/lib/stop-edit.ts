import { z } from 'zod';
import { AppointmentInput } from './appointment';
import { LOAD_STATUSES } from './loads';
import { StopOverrideEdit } from './override';

/**
 * What the edit modal sends. Shared by the client and the server; the server
 * re-validates every field regardless of what the UI allowed (§9.9).
 *
 * One schema covers editing an existing stop and creating the truck's first
 * load, because a dispatcher entering a load and editing one are the same act
 * with different starting data. A separate creation flow would be a second
 * place for the appointment path to go wrong.
 */

/**
 * §12.21: **permanently optional.** This supersedes the phase-3 ruling that
 * required a load number, and the constraint is not coming back.
 *
 * Brokers do not always supply a number when the load is entered. A required
 * field that dispatchers work around by typing junk is worse than a nullable
 * column: junk looks real to the next shift and to anyone reconciling against
 * the broker, and nothing downstream can tell it from a real number.
 *
 * Empty input becomes NULL rather than '', so there is one way to say "not
 * known yet" instead of two. Trimmed, capped, otherwise unvalidated —
 * brokers number loads any way they like.
 *
 * This is the schema the client validates with AND the one the route
 * re-parses, so a form cannot start blocking a save the API would accept.
 *
 * `.optional()` as well as `.nullable()`, and the two mean different things:
 *
 *     "LD-4417"   set it
 *     ""          clear it — the modal's empty box
 *     null        clear it — the same intent, said explicitly
 *     omitted     LEAVE IT ALONE
 *
 * Without `.optional()` an API client that simply did not send the key got
 * `400 Required`, which is not what "permanently optional" can mean. That was
 * the last layer of §12.21 still standing: the modal had stopped requiring it,
 * the column was nullable, and the wire contract still was not.
 *
 * Omitted deliberately does NOT mean null. Writing a column the caller never
 * mentioned is §12.23's broker wipe exactly — `loads.broker` went to null
 * because a write listed a field the form did not render. A key that is absent
 * is not a request to erase anything.
 */
export const LoadNumber = blankIsNull(64).optional();

/**
 * A free-text field where blank means "not known", not "known to be empty".
 *
 * ONE definition, because four copies is how layers drift apart. `loadNumber`
 * had the `'' -> null` transform and `addressLine`, `city`, `zip` and
 * `dispatcherNote` did not, so the same empty box produced NULL in one column
 * and `''` in the others.
 *
 * The modal hid it: its own `trimmed()` nulls a blank before validating, so
 * the UI never sent `''`. An API client posting `{"city": ""}` did, and the
 * database then held a value the modal could not have produced — the mirror
 * of the optimistic-cache bug in §12.21, and it breaks the same `??`
 * renderers for the same reason.
 *
 * `state` and `zip` have their own normalisers below, which follow the same
 * `'' -> null` rule for the same reason (§12.44).
 */
function blankIsNull(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable();
}

/* ------------------------------ normalisation ---------------------------- */

/**
 * §12.44. The normalisation lives HERE, not in the modal.
 *
 * The modal's own `trimmed()` nulls a blank before validating, which is why
 * the load-number and city empty-string bugs survived three sessions: the UI
 * could not produce the bad shape and an API client could. An API client
 * posting `{"state": "il"}` must get `"IL"` stored or a 400 — never `"il"`.
 *
 * Both follow `blankIsNull`'s rule that `'' -> null`, so "clear this field"
 * is one contract across every text field on the stop rather than two.
 */

/**
 * Two letters, uppercased.
 *
 * This was `z.string().trim().length(2).toUpperCase()`, which accepted `'i1'`
 * and `'1!'` — a rule that did not say what it claimed. It also rejected `''`
 * outright, so clearing the state meant `null` while clearing the city meant
 * either `null` or `''`.
 *
 * The state is not cosmetic: `zoneForState` derives the appointment timezone
 * from it, and the search maps full state names onto it (§12.7).
 */
export const StateCode = z
  .string()
  .trim()
  .nullable()
  .transform((value, ctx) => {
    if (value === null || value === '') return null;
    if (!/^[A-Za-z]{2}$/.test(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'State must be its two-letter code, like IL.',
      });
      return z.NEVER;
    }
    return value.toUpperCase();
  });

/**
 * Exactly five digits. ZIP+4 is accepted on input and the +4 discarded.
 *
 * Dispatchers paste `60601-1234` off rate confirmations, and everything we do
 * with a ZIP is geocoding: Census matches the 5-digit code and ignores the
 * +4. Storing it would add a field that can disagree with itself and buy
 * nothing — and a stored `60601-1234` silently degrades the geocode that the
 * whole ETA chain hangs off.
 *
 * Hyphens and internal spaces are removed before counting, so `60601-1234`,
 * `606011234` and `60601 - 1234` are the same input.
 */
export const Zip = z
  .string()
  .trim()
  .nullable()
  .transform((value, ctx) => {
    if (value === null || value === '') return null;
    const digits = value.replace(/[\s-]/g, '');
    const fail = (message: string) => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    };
    if (!/^[0-9]+$/.test(digits)) {
      return fail('ZIP must be digits only, like 60601 or 60601-1234.');
    }
    // Five is a ZIP. Nine is ZIP+4, and the +4 is dropped rather than stored.
    if (digits.length === 5 || digits.length === 9) return digits.slice(0, 5);
    if (digits.length < 5) return fail('ZIP must be 5 digits.');
    return fail('ZIP must be 5 digits, or 9 with the +4.');
  });

export const StopEdit = z
  .object({
    /** Null creates the load and its stop. */
    stopId: z.string().uuid().nullable(),
    truckId: z.string().uuid(),

    loadNumber: LoadNumber,
    loadStatus: z.enum(LOAD_STATUSES),

    stopType: z.enum(['PU', 'DEL']),
    /** The street line, as the rate confirmation gives it. */
    addressLine: blankIsNull(200),
    city: blankIsNull(120),
    /** Two letters, uppercased. The search maps full state names here (§12.7). */
    state: StateCode,
    /** Five digits. ZIP+4 accepted on input, the +4 discarded (§12.44). */
    zip: Zip,

    /** Null leaves the stop with no appointment — a real state (NO_APPT). */
    appointment: AppointmentInput.nullable(),

    /**
     * Visible to the next shift — and therefore **optional on the wire**, for
     * the same reason `loadNumber` is (§12.21): an ABSENT key is not a request
     * to erase anything.
     *
     * This was the §12.23 broker wipe in a third column. The modal initialised
     * its note box to `''` and never loaded the stored value, so every save
     * sent `dispatcherNote: null` and nulled a note the dispatcher could not
     * see and had not touched — along with `noteBy` and `noteAt`. The audit
     * row said `dispatcherNote: "call receiver first" -> null`, which is again
     * the only place it would ever have shown up.
     *
     *     "note text"   set it
     *     ""            clear it — the modal's emptied box
     *     null          clear it, said explicitly
     *     omitted       LEAVE IT ALONE
     */
    dispatcherNote: blankIsNull(2000).optional(),

    /**
     * The driver this truck should end up with. Undefined leaves the
     * assignment alone; null clears it; a uuid assigns or reassigns, which
     * goes through the two-sided transaction and the confirm dialog.
     */
    driverId: z.string().uuid().nullable().optional(),

    /**
     * §12.28: the status override travels WITH the save, not after it.
     *
     * It used to be a second request to a second route, so a dispatcher who
     * changed an appointment and forced a status could get one and not the
     * other. Undefined leaves any existing override alone.
     */
    override: StopOverrideEdit.optional(),

    /**
     * The hash of the server preview the dispatcher actually confirmed. Only
     * required when the assignment changes — see server/reassign.ts.
     */
    previewToken: z.string().optional(),
  })
  .strict();

export type StopEdit = z.infer<typeof StopEdit>;

/** Which fields differ from the loaded row — the modal's dirty banner names them. */
export function dirtyFields(before: Partial<StopEdit>, after: StopEdit): string[] {
  const named: [keyof StopEdit, string][] = [
    ['loadNumber', 'load number'],
    ['loadStatus', 'load status'],
    ['stopType', 'stop type'],
    ['addressLine', 'address'],
    ['city', 'city'],
    ['state', 'state'],
    ['zip', 'ZIP'],
    ['dispatcherNote', 'note'],
    ['driverId', 'assigned driver'],
  ];
  const changed = named
    .filter(
      ([key]) =>
        before[key] !== undefined && after[key] !== undefined && before[key] !== after[key],
    )
    .map(([, label]) => label);

  // `driverId` and `loadNumber` are optional on the wire (undefined means
  // "leave it alone"), so an absent key must not read as a change. The filter
  // above already skips a `before` of undefined; this skips an `after` of it.

  if (JSON.stringify(before.appointment ?? null) !== JSON.stringify(after.appointment ?? null)) {
    changed.push('appointment time');
  }
  return changed;
}
