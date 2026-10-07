import { dispatchTime } from '@/lib/clear-stop';

/**
 * Stage 1 of the driver history plan — the overwritten-trips fix.
 *
 * A stop that has been REACHED is a record of where a truck went. Saving a
 * new city or load number over it used to replace that record outright: the
 * audit log held the only copy, and §12.85 wipes the arrival with the old
 * address. Measured 2026-10-02 in production: 41 of 79 edits moved a stop to
 * a new city, and 7 of 19 real arrivals survived only in `audit_log`.
 *
 * Whether the dispatcher is CORRECTING the stop or entering the NEXT TRIP is
 * not something the data can tell, so it is asked, every time — including a
 * change that looks typo-sized. "Fargo" to "FARGO" is probably a correction,
 * and "probably" is the guess this exists to stop making.
 *
 * One rule for both layers: the modal asks before it sends, and the server
 * refuses a save that skipped the question. They cannot disagree about when
 * the question applies, because they call the same function.
 */

export const REACHED_ANSWERS = ['correction', 'next-trip'] as const;
export type ReachedAnswer = (typeof REACHED_ANSWERS)[number];

export interface StoredStop {
  /** ISO instant, or null for a stop no truck has reached. */
  arrivedAt: string | null;
  city: string | null;
  loadNumber: string | null;
}

export interface EditedStop {
  city: string | null;
  /** Undefined means the save leaves the number alone (§12.21). */
  loadNumber?: string | null | undefined;
}

/** True when this save must carry the dispatcher's answer. */
export function needsReachedAnswer(stored: StoredStop, edit: EditedStop): boolean {
  if (stored.arrivedAt === null) return false;
  const cityChanged = edit.city !== stored.city;
  const numberChanged = edit.loadNumber !== undefined && edit.loadNumber !== stored.loadNumber;
  return cityChanged || numberChanged;
}

/** "This stop was reached at 07:40 CDT. Is this a correction, or the next trip?" */
export function reachedPrompt(
  arrivedAt: string,
  dispatchTz: string,
  now: Date,
  /** §12.119. On a load of several stops, which one: "Stop 2 (Fargo, ND)". */
  stopName?: string,
): string {
  return `${stopName ?? 'This stop'} was reached at ${dispatchTime(arrivedAt, dispatchTz, now)}. Is this a correction, or the next trip?`;
}
