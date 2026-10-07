import { z } from 'zod';
import { CLEAR_STATUSES } from '@/lib/clear-stop';
import { REACHED_ANSWERS } from '@/lib/reached-stop';
import { AppointmentInput, WallTimeInput } from './appointment';
import { LOAD_STATUSES } from './loads';
import { StopOverrideEdit } from './override';
import { LoadNumber, StateCode, Zip, blankIsNull, type StopEdit } from './stop-edit';

/**
 * §12.117. What the edit modal sends: ONE load and the stops it writes.
 *
 * The per-field rules are `stop-edit.ts`'s, reused rather than restated — the
 * same `blankIsNull`, `StateCode`, `Zip` and `LoadNumber`, so a stop typed
 * into this shape and one typed into the old one cannot be normalised
 * differently.
 *
 * The three states every optional field already has hold for stops too:
 *
 *     a stop with its id       write it
 *     a stop with id null      append it, after every stop the load has
 *     an id in removedStopIds  delete it — refused once the truck reached it
 *     a stop not mentioned     LEAVE IT ALONE (§12.23)
 *
 * so a save that names one stop of a three-stop load touches one stop.
 */

/** §12.116 D6. Re-counted under the lock on the server; there is one write path. */
export const MAX_STOPS_PER_LOAD = 10;

/** The version the modal opened with: an md5 of what people edit (server/load-version.ts). */
export const LoadVersion = z.string().regex(/^[0-9a-f]{32}$/);

export const StopDraft = z
  .object({
    /** Null appends a new stop. */
    stopId: z.string().uuid().nullable(),
    stopType: z.enum(['PU', 'DEL']),
    addressLine: blankIsNull(200),
    city: blankIsNull(120),
    state: StateCode,
    zip: Zip,
    /** Null leaves the stop with no appointment — a real state (NO_APPT). */
    appointment: AppointmentInput.nullable(),
    /** Omitted leaves the note alone; null or '' clears it (§12.21, §12.53). */
    dispatcherNote: blankIsNull(2000).optional(),
    /** Omitted leaves the arrival alone; null clears it (§12.57). */
    arrivedAt: WallTimeInput.nullable().optional(),
    /** §12.118. The same three states, for the departure. */
    departedAt: WallTimeInput.nullable().optional(),
    /** Omitted leaves any override alone (§12.28). */
    override: StopOverrideEdit.optional(),
  })
  .strict();

export type StopDraft = z.infer<typeof StopDraft>;

export const LoadEdit = z
  .object({
    /** Null creates the load and its stops. */
    loadId: z.string().uuid().nullable(),
    truckId: z.string().uuid(),
    /**
     * Required for an existing load: the server refuses a save whose version
     * is not the one under its lock, and nothing is written (§12.117).
     */
    version: LoadVersion.optional(),

    loadNumber: LoadNumber,
    loadStatus: z.enum(LOAD_STATUSES),

    /** Undefined leaves the assignment alone; null clears it. See StopEdit. */
    driverId: z.string().uuid().nullable().optional(),
    previewToken: z.string().optional(),

    /** §12.92. A NEW load only. See StopEdit. */
    closePrevious: z
      .array(z.object({ loadId: z.string().uuid(), status: z.enum(CLEAR_STATUSES) }).strict())
      .max(20)
      .optional(),

    /** The answer to "correction, or the next trip?" (lib/reached-stop.ts). */
    reachedStop: z.enum(REACHED_ANSWERS).optional(),

    stops: z.array(StopDraft).min(1).max(MAX_STOPS_PER_LOAD),
    removedStopIds: z.array(z.string().uuid()).max(MAX_STOPS_PER_LOAD).optional(),
  })
  .strict()
  .superRefine((edit, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

    if (edit.loadId !== null && edit.version === undefined) {
      issue(['version'], 'Reopen this load and try again: the save did not say which version it edits.');
    }
    if (edit.loadId === null) {
      // A new load has no stops to name and none to remove.
      edit.stops.forEach((stop, i) => {
        if (stop.stopId !== null) issue(['stops', i, 'stopId'], 'A new load has no existing stops.');
      });
      if (edit.removedStopIds?.length) {
        issue(['removedStopIds'], 'A new load has no stops to remove.');
      }
    }
    const named = edit.stops.flatMap((s) => (s.stopId ? [s.stopId] : []));
    if (new Set(named).size !== named.length) {
      issue(['stops'], 'A stop is named twice.');
    }
    for (const id of edit.removedStopIds ?? []) {
      if (named.includes(id)) issue(['removedStopIds'], 'A stop cannot be written and removed.');
    }
  });

export type LoadEdit = z.infer<typeof LoadEdit>;
export type LoadEditInput = z.input<typeof LoadEdit>;

/** One stop of the form as the load-shaped request carries it, key by key. */
function stopDraftFrom(edit: StopEdit): z.input<typeof StopDraft> {
  return {
    stopId: edit.stopId,
    stopType: edit.stopType,
    addressLine: edit.addressLine,
    city: edit.city,
    state: edit.state,
    zip: edit.zip,
    appointment: edit.appointment,
    ...(edit.dispatcherNote !== undefined ? { dispatcherNote: edit.dispatcherNote } : {}),
    ...(edit.arrivedAt !== undefined ? { arrivedAt: edit.arrivedAt } : {}),
    ...(edit.departedAt !== undefined ? { departedAt: edit.departedAt } : {}),
    ...(edit.override !== undefined ? { override: edit.override } : {}),
  };
}

/**
 * The modal's flat per-stop edits turned into the load-shaped request, key by
 * key — an omitted key in the form stays omitted here, because omitted means
 * "leave it alone" on both shapes and a converter that filled one in would be
 * §12.23's wipe.
 *
 * §12.119. Every stop of one load carries the same load fields, so they are
 * read off the first. The stops go in the order given — the load's own order
 * — and the removals after them, only when there are any: a one-stop save is
 * byte for byte the request the one-stop modal sent (one-stop-body.test.tsx).
 */
export function loadEditFromStops(
  edits: readonly [StopEdit, ...StopEdit[]],
  ids: { loadId: string | null; version?: string | undefined },
  removedStopIds: readonly string[] = [],
): LoadEditInput {
  const edit = edits[0];
  return {
    loadId: ids.loadId,
    truckId: edit.truckId,
    ...(ids.version !== undefined ? { version: ids.version } : {}),
    ...(edit.loadNumber !== undefined ? { loadNumber: edit.loadNumber } : {}),
    loadStatus: edit.loadStatus,
    ...(edit.driverId !== undefined ? { driverId: edit.driverId } : {}),
    ...(edit.previewToken !== undefined ? { previewToken: edit.previewToken } : {}),
    ...(edit.closePrevious !== undefined ? { closePrevious: edit.closePrevious } : {}),
    ...(edit.reachedStop !== undefined ? { reachedStop: edit.reachedStop } : {}),
    stops: edits.map(stopDraftFrom),
    ...(removedStopIds.length > 0 ? { removedStopIds: [...removedStopIds] } : {}),
  };
}

/** One stop: the request the one-stop modal sent (§12.117). */
export function loadEditFromStop(
  edit: StopEdit,
  ids: { loadId: string | null; version?: string | undefined },
): LoadEditInput {
  return loadEditFromStops([edit], ids);
}

/**
 * The server names a stop's field as `stops.<i>.<field>`. Today's modal has
 * one stop and its fields carry their bare names, so `stops.0.` is dropped
 * on the way in. Anything else is left as the server said it.
 */
export function singleStopField(field: string): string {
  return field.startsWith('stops.0.') ? field.slice('stops.0.'.length) : field;
}
