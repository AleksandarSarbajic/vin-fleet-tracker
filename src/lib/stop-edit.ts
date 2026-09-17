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
 */
export const LoadNumber = z
  .string()
  .trim()
  .max(64)
  .transform((value) => (value === '' ? null : value))
  .nullable();

export const StopEdit = z
  .object({
    /** Null creates the load and its stop. */
    stopId: z.string().uuid().nullable(),
    truckId: z.string().uuid(),

    loadNumber: LoadNumber,
    loadStatus: z.enum(LOAD_STATUSES),

    stopType: z.enum(['PU', 'DEL']),
    /** The street line, as the rate confirmation gives it. */
    addressLine: z.string().trim().max(200).nullable(),
    city: z.string().trim().max(120).nullable(),
    /** Two letters. The search maps full state names to these (§12.7). */
    state: z.string().trim().length(2).toUpperCase().nullable(),
    zip: z.string().trim().max(12).nullable(),

    /** Null leaves the stop with no appointment — a real state (NO_APPT). */
    appointment: AppointmentInput.nullable(),

    /** Visible to the next shift. */
    dispatcherNote: z.string().trim().max(2000).nullable(),

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
    .filter(([key]) => before[key] !== undefined && before[key] !== after[key])
    .map(([, label]) => label);

  // `driverId` is optional on the wire (undefined means "leave it alone"), so
  // a null-to-null comparison must not read as a change.

  if (JSON.stringify(before.appointment ?? null) !== JSON.stringify(after.appointment ?? null)) {
    changed.push('appointment time');
  }
  return changed;
}
