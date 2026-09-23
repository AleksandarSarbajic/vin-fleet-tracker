import { TRAIL_RAMP } from '@/design/tokens';

/**
 * §14 feature 9 — the movement trail.
 *
 * > **The trail is selected-only.** Thirty trails at once would read as
 * > traffic, not history. (§14.3)
 *
 * > Dots, no stroke, 4–5px — smaller than any marker (14px+) and **never a
 * > line**, so a future route preview can own the solid line. (§14.5)
 *
 * The ramp is `TRAIL_RAMP`, newest → ~30 minutes old, and §14.4 is explicit
 * that its tail falls below 3:1 **on purpose**: past roughly twelve minutes a
 * dot carries direction only, and the marker carries status.
 */

/** Five ramp steps over half an hour (§14.4). */
export const TRAIL_WINDOW_MS = 30 * 60_000;
export const TRAIL_STEP_MS = TRAIL_WINDOW_MS / TRAIL_RAMP.length;

export interface TrailPoint {
  lat: number;
  lng: number;
  /** ISO instant. */
  recordedAt: string;
}

export interface TrailDot extends TrailPoint {
  opacity: number;
  /** §14.5's "4–5px". The freshest dot is the larger one. */
  radius: number;
  /** Which ramp step it came from, 0 = newest. Used as the feature key. */
  step: number;
}

/**
 * One dot per ramp step, newest first.
 *
 * ## Why the newest reading is dropped
 *
 * The trail is built from position HISTORY, and the newest history row is the
 * one the marker is already drawn at. Keeping it would put a full-opacity dot
 * underneath a 14px marker: invisible, and it would spend the brightest step
 * of the ramp saying something the marker already says.
 *
 * ## Why it buckets by age instead of taking the last five rows
 *
 * The worker polls every 30 seconds, so the last five rows are the last two
 * and a half minutes — a trail that never reaches past the end of the block
 * the truck is on. Bucketing by age spreads the five dots across the whole
 * half hour whatever the poll cadence does, and it degrades honestly: a
 * truck that has only been tracked for nine minutes gets two dots rather
 * than five crowded ones.
 *
 * A parked truck yields five dots at one coordinate, which draws as a single
 * dot beside the marker. That is the correct picture and not a bug to fix.
 */
export function trailDots(points: readonly TrailPoint[], now: number): TrailDot[] {
  // Newest first, so "the newest in this bucket" is the first one found.
  const sorted = [...points].sort(
    (a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt),
  );
  // The head. See above.
  const history = sorted.slice(1);

  const dots: TrailDot[] = [];
  for (let step = 0; step < TRAIL_RAMP.length; step += 1) {
    const youngest = step * TRAIL_STEP_MS;
    const oldest = (step + 1) * TRAIL_STEP_MS;
    const found = history.find((p) => {
      const age = now - Date.parse(p.recordedAt);
      return age >= youngest && age < oldest;
    });
    if (!found) continue;
    dots.push({
      ...found,
      opacity: TRAIL_RAMP[step]!,
      // 5px for the freshest, 4 for the rest: the head of the trail reads as
      // the direction of travel, and every other dot is where it has been.
      radius: step === 0 ? 5 : 4,
      step,
    });
  }
  return dots;
}
