/**
 * The semantic status the UI maps to a token. Emitted by the status engine.
 *
 * TODO(phase 5): the real engine lands here as pure functions in this file —
 * `lib/status.ts`, no I/O, fully unit tested, per PROJECT_BRIEF. Phase 3 uses
 * `lib/placeholder-fleet.ts` to fabricate a spread so the palette is visible.
 * Only this type is real today.
 *
 * The array order is ALSO the urgency sort order, top to bottom.
 */
export const STATUSES = [
  'LATE',
  'STALE_GPS',
  'UNASSIGNED',
  'AT_RISK',
  'NO_APPT',
  'ARRIVED',
  'ON_TIME',
  'TOMORROW',
] as const;

export type Status = (typeof STATUSES)[number];

/** Rank in the urgency sort. Lower sorts higher. */
export function urgencyRank(status: Status): number {
  return STATUSES.indexOf(status);
}

/**
 * design-spec §12.5. These five never cluster on the map, and they are what
 * "0 problems below the fold" counts. ARRIVED, ON_TIME and TOMORROW are not
 * problems.
 */
const PROBLEM = new Set<Status>([
  'LATE',
  'STALE_GPS',
  'UNASSIGNED',
  'AT_RISK',
  'NO_APPT',
]);

export function isProblem(status: Status): boolean {
  return PROBLEM.has(status);
}

/** Everything that is not a problem clusters, ARRIVED included (§12.5). */
export function clusters(status: Status): boolean {
  return !isProblem(status);
}

export const STATUS_LABEL: Record<Status, string> = {
  LATE: 'Late',
  STALE_GPS: 'Stale GPS',
  UNASSIGNED: 'Unassigned',
  AT_RISK: 'At risk',
  NO_APPT: 'No appt',
  ARRIVED: 'Arrived',
  ON_TIME: 'On time',
  TOMORROW: 'Tomorrow',
};
