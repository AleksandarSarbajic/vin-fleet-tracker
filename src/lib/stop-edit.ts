import { z } from 'zod';
import { AppointmentInput } from './appointment';
import { LOAD_STATUSES } from './loads';

/**
 * What the edit modal sends. Shared by the client and the server; the server
 * re-validates every field regardless of what the UI allowed (§9.9).
 *
 * One schema covers editing an existing stop and creating the truck's first
 * load, because a dispatcher entering a load and editing one are the same act
 * with different starting data. A separate creation flow would be a second
 * place for the appointment path to go wrong.
 */

/** Non-empty and trimmed. Nothing more — brokers number loads any way. */
export const LoadNumber = z
  .string()
  .trim()
  .min(1, "Load number can't be empty. Any format the broker uses.")
  .max(64);

export const StopEdit = z
  .object({
    /** Null creates the load and its stop. */
    stopId: z.string().uuid().nullable(),
    truckId: z.string().uuid(),

    loadNumber: LoadNumber,
    broker: z.string().trim().max(120).nullable(),
    loadStatus: z.enum(LOAD_STATUSES),

    stopType: z.enum(['PU', 'DEL']),
    facilityName: z.string().trim().max(160).nullable(),
    city: z.string().trim().max(120).nullable(),
    /** Two letters. The search maps full state names to these (§12.7). */
    state: z.string().trim().length(2).toUpperCase().nullable(),
    /** Free text, as the broker wrote it. Never checked against a door list. */
    dockDoor: z.string().trim().max(60).nullable(),

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
    ['broker', 'broker'],
    ['loadStatus', 'load status'],
    ['stopType', 'stop type'],
    ['facilityName', 'facility'],
    ['city', 'city'],
    ['state', 'state'],
    ['dockDoor', 'dock / door'],
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
