import type { TimelineOverride, TimelineStop } from '@/server/timeline';

/**
 * §14 feature 15 — what the per-truck timeline says about each stop.
 *
 * Pure, and separate from the query for the usual reason: the three
 * judgements below are the whole feature, and none of them should need a
 * database to be argued with.
 */

/**
 * Where a stop is in its own life.
 *
 * Read off the two timestamps and nothing else. Not off `loads.status`,
 * which is a dispatcher's label for the whole load and can say `AT_RECEIVER`
 * while the second of three stops is still ahead.
 */
export type StopState = 'done' | 'here' | 'ahead';

export function stopState(stop: TimelineStop): StopState {
  if (stop.departedAt !== null) return 'done';
  if (stop.arrivedAt !== null) return 'here';
  return 'ahead';
}

/**
 * How late the truck was, in minutes, or null when the question does not
 * apply.
 *
 * The rule is `status.ts`'s, restated and not reimported — the same boundary
 * §14 feature 8 drew. The deadline is `apptEnd ?? apptStart`, and §12.1's
 * window IS the grace, so there is no tolerance to add. Null when the stop
 * has not been arrived at (nothing to measure) or carries no appointment
 * (nothing to measure against) — never zero, because zero means "on the dot"
 * and would print as an achievement.
 */
export function minutesLate(stop: TimelineStop): number | null {
  if (stop.arrivedAt === null) return null;
  const deadline = stop.apptEndUtc ?? stop.apptStartUtc;
  if (deadline === null) return null;
  return Math.round((Date.parse(stop.arrivedAt) - Date.parse(deadline)) / 60_000);
}

export type OverrideState = 'live' | 'cleared' | 'expired';

/**
 * An override's state at a given instant.
 *
 * Three, not two. An override that was CLEARED is a dispatcher changing their
 * mind; one that EXPIRED is §9.5 working as designed — the status returning
 * to what the engine computes because nobody renewed a claim. A timeline that
 * printed both as "ended" would lose the only interesting difference between
 * them.
 */
export function overrideState(override: TimelineOverride, now: number): OverrideState {
  if (override.clearedAt !== null) return 'cleared';
  return Date.parse(override.expiresAt) <= now ? 'expired' : 'live';
}

export interface TimelineLoad {
  loadId: string;
  loadNumber: string | null;
  loadStatus: string;
  stops: TimelineStop[];
}

/**
 * The stops grouped into their loads, in the order the query returned them.
 *
 * Grouped rather than flattened because §12.13's ordering is per load, and a
 * flat list of six stops from two loads reads as one run the truck is not
 * making. The query already orders by `created_at, id, sequence`; this only
 * has to preserve it, which is why it walks rather than sorts.
 */
export function groupByLoad(stops: readonly TimelineStop[]): TimelineLoad[] {
  const loads: TimelineLoad[] = [];
  for (const stop of stops) {
    const last = loads[loads.length - 1];
    if (last && last.loadId === stop.loadId) {
      last.stops.push(stop);
      continue;
    }
    loads.push({
      loadId: stop.loadId,
      loadNumber: stop.loadNumber,
      loadStatus: stop.loadStatus,
      stops: [stop],
    });
  }
  return loads;
}

/**
 * Where the "now" line goes: the first stop that has not been departed.
 *
 * Returns the stop id, or null when every stop is done — in which case there
 * is no line to draw, and drawing one under the last row would suggest
 * something is still expected.
 */
export function currentStopId(stops: readonly TimelineStop[]): string | null {
  return stops.find((s) => s.departedAt === null)?.stopId ?? null;
}

/** One line naming the stop, for the card heading. */
export function stopPlace(stop: TimelineStop): string {
  const place =
    stop.city && stop.state ? `${stop.city}, ${stop.state}` : stop.addressLine;
  return place ?? 'Address not given yet';
}
