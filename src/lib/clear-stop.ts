import { z } from 'zod';
import { timeInZone } from '@/lib/format';
import { isTerminal, LOAD_STATUS_LABEL } from '@/lib/loads';
import {
  groupByLoad,
  stopPlace,
  TIMELINE_KEEP_HOURS,
  type TimelineStay,
} from '@/lib/timeline';
import type { TimelineStop } from '@/server/timeline';

/**
 * §12.88 — Clear stop: one act that closes a finished load.
 *
 * The rules the confirm step states, kept pure so each sentence can be argued
 * with in a unit test. The write is `server/clear-stop.ts`.
 */

/** The two ways Clear stop may close a load. TONU stays in the Status field. */
export const CLEAR_STATUSES = ['DELIVERED', 'CANCELLED'] as const;
export type ClearStatus = (typeof CLEAR_STATUSES)[number];
export const DEFAULT_CLEAR_STATUS: ClearStatus = 'DELIVERED';

/**
 * The request. `loadId` is REQUIRED: the server never picks a load for the
 * caller, so a truck holding two cannot have one closed by default however
 * the client is written.
 */
export const ClearStopRequest = z.object({
  truckId: z.string().uuid(),
  loadId: z.string().uuid(),
  status: z.enum(CLEAR_STATUSES),
});
export type ClearStopRequest = z.infer<typeof ClearStopRequest>;

/** One open load, as the confirm step names it. */
export interface OpenLoadChoice {
  loadId: string;
  loadNumber: string | null;
  /** Where the load goes next: its first undeparted stop, else its last. */
  nextPlace: string;
  stops: TimelineStop[];
}

/**
 * The truck's open loads, from the timeline's own rows — which carry every
 * stop of every open load, so a load the fleet row does not show (the "+1
 * load") is here too.
 */
export function openLoadChoices(stops: readonly TimelineStop[]): OpenLoadChoice[] {
  return groupByLoad(stops)
    .filter((load) => !isTerminal(load.loadStatus))
    .map((load) => {
      const next = load.stops.find((s) => s.departedAt === null) ?? load.stops.at(-1)!;
      return {
        loadId: load.loadId,
        loadNumber: load.loadNumber,
        nextPlace: stopPlace(next),
        stops: load.stops,
      };
    });
}

/**
 * Which load the confirm step starts on. The only load when there is one;
 * NONE when there are several — the dispatcher chooses, every time.
 */
export function initialChoice(choices: readonly OpenLoadChoice[]): string | null {
  return choices.length === 1 ? choices[0]!.loadId : null;
}

/** How a load is named in a sentence. §12.21: blank means blank, and says so. */
export function loadName(loadNumber: string | null): string {
  return loadNumber === null ? 'the load with no number' : `load ${loadNumber}`;
}

/**
 * What closing does to the load's place on the timeline, in the words the
 * confirm step uses. Takes the SAME `timelineStay` the timeline query filters
 * with, evaluated for the load as it will be once closed.
 */
export function timelineSentence(stay: TimelineStay, dispatchTz: string): string {
  switch (stay.kind) {
    case 'open':
      // Unreachable for a load being closed; said plainly rather than thrown,
      // because a confirm step that crashes is worse than one that is vague.
      return 'It stays on the timeline while it is open.';
    case 'until':
      return (
        `It stays on the timeline until ${timeInZone(new Date(stay.untilUtc), dispatchTz, { weekday: true })}, ` +
        `${TIMELINE_KEEP_HOURS} hours after its last ${stay.after}.`
      );
    case 'gone':
      return stay.reason === 'never-reached'
        ? 'It leaves the timeline now: none of its stops was reached.'
        : `It leaves the timeline now: its last ${stay.after} was more than ${TIMELINE_KEEP_HOURS} hours ago.`;
  }
}

/**
 * Every line of the confirm step's "what happens", in order. The component
 * renders these and nothing else, so what it says is what is tested.
 */
export function confirmLines(input: {
  truckName: string;
  choice: OpenLoadChoice;
  status: ClearStatus;
  /** The truck's OTHER open loads, which keep going. */
  others: readonly OpenLoadChoice[];
  stay: TimelineStay;
  dispatchTz: string;
  /** Fields edited in the modal and not saved, which closing discards. */
  unsaved: readonly string[];
}): string[] {
  const { choice, status, others } = input;
  const name = loadName(choice.loadNumber);
  const lines = [
    `${name[0]!.toUpperCase()}${name.slice(1)} is closed as ${LOAD_STATUS_LABEL[status]}.`,
  ];
  if (choice.stops.length > 1) {
    lines.push(`All ${choice.stops.length} of its stops close with it.`);
    /**
     * §12.119. Said, because closing is not reaching: the stops the truck
     * never got to are kept, unreached, and nothing marks them done.
     */
    const unreached = choice.stops.filter((s) => s.arrivedAt === null).length;
    if (unreached === 1) {
      lines.push('1 of its stops was never reached; it stays on record as not reached.');
    } else if (unreached > 1) {
      lines.push(
        `${unreached} of its stops were never reached; they stay on record as not reached.`,
      );
    }
  }
  lines.push('The arrival and departure times are kept as the record.');
  lines.push(timelineSentence(input.stay, input.dispatchTz));
  lines.push(
    others.length === 0
      ? `Truck ${input.truckName} then shows no next stop, appointment or load number.`
      : others.length === 1
        ? `Truck ${input.truckName} keeps its other open load, ${loadName(others[0]!.loadNumber)}.`
        : `Truck ${input.truckName} keeps its ${others.length} other open loads.`,
  );
  lines.push(
    'Not changed: the driver assignment, whether the truck is active, and its history.',
  );
  if (input.unsaved.length > 0) {
    lines.push(`Unsaved edits in this form are discarded: ${input.unsaved.join(', ')}.`);
  }
  return lines;
}

/* ------------------------- previous loads (§12.92) ----------------------- */

/**
 * §12.92. A PREVIOUS load: open, and every one of its stops departed. Done
 * on the road, not closed in the system — nothing closes a load by itself
 * when its last stop is left; that is Clear stop's job.
 *
 * When the fleet row has no next stop, every open load the truck holds is
 * one of these: the next stop is the first undeparted stop of an open load,
 * so "no next stop" means no open load has one.
 */
export function previousLoads(stops: readonly TimelineStop[]): OpenLoadChoice[] {
  return openLoadChoices(stops).filter(
    (load) => load.stops.length > 0 && load.stops.every((s) => s.departedAt !== null),
  );
}

/**
 * The edit modal's subtitle in its new-load state. Keyed off the SAME
 * `openLoadCount` that enables Clear stop, so the header can never say there
 * is no load while the button can close one.
 */
export function newLoadSubtitle(openLoadCount: number): string {
  if (openLoadCount === 0) return 'No load on this truck yet';
  return `No next stop. ${openLoadCount} previous ${
    openLoadCount === 1 ? 'load' : 'loads'
  } still open`;
}

/** "6612193", or "no number" (§12.21: blank means blank, and says so). */
function shortName(loadNumber: string | null): string {
  return loadNumber ?? 'no number';
}

function lastStop(load: OpenLoadChoice): TimelineStop {
  return [...load.stops].sort((a, b) => a.sequence - b.sequence).at(-1)!;
}

function lastPlace(load: OpenLoadChoice): string {
  const last = lastStop(load);
  return last.city ?? last.addressLine ?? 'an unnamed stop';
}

/** A time in dispatch time; the weekday too when it is not today there. */
export function dispatchTime(iso: string, dispatchTz: string, now: Date): string {
  const day = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: dispatchTz }).format(d);
  const at = new Date(iso);
  return timeInZone(at, dispatchTz, { weekday: day(at) !== day(now) });
}

/**
 * The line above the form for each previous load:
 *
 *   Previous load 6612193: Vernon Hills, arrived 09:19 CDT, departed
 *   09:57 CDT (detected automatically). Still open.
 */
export function previousLoadLine(
  load: OpenLoadChoice,
  dispatchTz: string,
  now: Date,
): string {
  const last = lastStop(load);
  const arrived = last.arrivedAt
    ? `arrived ${dispatchTime(last.arrivedAt, dispatchTz, now)}`
    : 'arrival not recorded';
  const departed = last.departedAt
    ? `departed ${dispatchTime(last.departedAt, dispatchTz, now)}`
    : 'not departed';
  const how =
    last.arrivedSource === 'detected'
      ? ' (detected automatically)'
      : last.arrivedSource === 'dispatcher'
        ? ' (marked by hand)'
        : '';
  /**
   * §12.118. The note at the end has always described the ARRIVAL. A hand
   * departure needs its own, so then each note sits beside the time it is
   * about; a line without one reads exactly as it did.
   */
  if (last.departedSource === 'dispatcher') {
    return `Previous load ${shortName(load.loadNumber)}: ${lastPlace(load)}, ${arrived}${how}, ${departed} (marked by hand). Still open.`;
  }
  return `Previous load ${shortName(load.loadNumber)}: ${lastPlace(load)}, ${arrived}, ${departed}${how}. Still open.`;
}

/**
 * Clear stop's tooltip when the form is empty: it names what it would act
 * on, so the button never closes something the dispatcher cannot see.
 * `null` while the loads are still being read.
 */
export function clearStopTitle(previous: readonly OpenLoadChoice[] | null): string {
  if (previous === null || previous.length === 0) {
    return 'Close a previous load still open on this truck.';
  }
  const named = previous.map((l) => `${shortName(l.loadNumber)} (${lastPlace(l)})`);
  return previous.length === 1
    ? `Close previous load ${named[0]!}.`
    : `Close one of ${previous.length} previous loads: ${named.join(', ')}.`;
}

/** The save-time question, one per previous load. */
export function savePrompt(load: OpenLoadChoice): string {
  return `Previous load ${shortName(load.loadNumber)} is still open. Close it as Delivered?`;
}

/** The three answers. `keep` closes nothing; there is no default. */
export const SAVE_ANSWERS = ['DELIVERED', 'CANCELLED', 'keep'] as const;
export type SaveAnswer = (typeof SAVE_ANSWERS)[number];

/** What a set of answers asks the save to close. "Keep it open" closes nothing. */
export function closesFor(
  answers: Readonly<Record<string, SaveAnswer>>,
): { loadId: string; status: ClearStatus }[] {
  return Object.entries(answers).flatMap(([loadId, answer]) =>
    answer === 'keep' ? [] : [{ loadId, status: answer }],
  );
}
