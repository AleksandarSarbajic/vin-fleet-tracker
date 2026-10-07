/**
 * §12.85 / §12.88. The column sets that clear an arrival, in one place.
 *
 * Three write paths clear some of these: an unticked arrival and an address
 * change (both in `stop-edit.ts`) clear the whole arrival, and Clear stop
 * (`clear-stop.ts`) clears only the anchor. They are spread from here rather
 * than spelled out at each site, because the failure a copy invites is
 * silent: a fourth anchor column added to one list and not the other would
 * leave half a point behind, which `stops_arrival_anchor_whole` refuses — as
 * a 500 on the path nobody updated.
 */

/**
 * The point a hand-marked arrival's departure is measured from (§12.85).
 * Meaningless once the load is closed — nothing measures a departure on a
 * closed load — so Clear stop removes it and keeps the times.
 */
export const ANCHOR_CLEARED = {
  arrivalAnchorLat: null,
  arrivalAnchorLng: null,
  arrivalAnchorAt: null,
} as const;

/**
 * The whole arrival: the departure goes with it (a truck cannot have left
 * somewhere it never reached) and so does the anchor
 * (`stops_arrival_anchor_dispatcher` refuses one with no dispatcher arrival).
 */
export const ARRIVAL_CLEARED = {
  arrivedAt: null,
  arrivedSource: null,
  departedAt: null,
  // §12.118. The pair goes with it, or the paired check refuses the write.
  departedSource: null,
  ...ANCHOR_CLEARED,
} as const;
