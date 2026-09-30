import { isTerminal, type LoadStatus } from '@/lib/loads';
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
 * Read off the two timestamps — and, since §12.88, off whether the load is
 * CLOSED (Delivered, TONU, Cancelled). Not off any other `loads.status`, which
 * is a dispatcher's label for the whole load and can say `AT_RECEIVER` while
 * the second of three stops is still ahead.
 *
 * The closed statuses are the exception because they are not a label for
 * progress: they say the work is over. A delivered load whose receiver stop
 * was never departed — the usual case, the load is closed while the truck is
 * still at the dock — read `here`, with the live dot, for as long as the load
 * stayed on the timeline. And an unvisited stop on a cancelled load read
 * `ahead`, as if something were still expected there.
 *
 *   closed      the load is closed and the truck reached this stop. Its
 *               arrival and departure are the record and are shown as such.
 *   unvisited   the load is closed and the truck never got here.
 */
export type StopState = 'done' | 'here' | 'ahead' | 'closed' | 'unvisited';

export function stopState(stop: TimelineStop): StopState {
  if (isTerminal(stop.loadStatus))
    return stop.arrivedAt !== null ? 'closed' : 'unvisited';
  if (stop.departedAt !== null) return 'done';
  if (stop.arrivedAt !== null) return 'here';
  return 'ahead';
}

/** §12.88. The line a closed load's visited stops carry, in the load's own words. */
export const CLOSED_LOAD_LABEL: Record<'DELIVERED' | 'TONU' | 'CANCELLED', string> = {
  DELIVERED: 'Load delivered',
  TONU: 'Load TONU',
  CANCELLED: 'Load cancelled',
};

export function closedLoadLabel(status: LoadStatus): string | null {
  return status === 'DELIVERED' || status === 'TONU' || status === 'CANCELLED'
    ? CLOSED_LOAD_LABEL[status]
    : null;
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
  loadStatus: LoadStatus;
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
 * Where the "now" line goes: the first stop of an OPEN load that has not been
 * departed.
 *
 * Returns the stop id, or null when there is none — in which case there is no
 * line to draw, and drawing one under the last row would suggest something is
 * still expected.
 *
 * §12.88. Open loads only. A closed load's undeparted stop is not where the
 * truck is going: on a truck holding two loads, the line used to land on the
 * closed one because it was created first, and point away from the load the
 * truck was actually running.
 */
export function currentStopId(stops: readonly TimelineStop[]): string | null {
  return (
    stops.find((s) => !isTerminal(s.loadStatus) && s.departedAt === null)?.stopId ?? null
  );
}

/**
 * §12.88. How long a load stays on the per-truck timeline — THE rule, used by
 * the timeline query to decide which loads to return and by Clear stop's
 * confirm step to say what closing a load will do to it. One function, so
 * the sentence cannot promise something the timeline does not do.
 *
 * An open load always shows. A closed one shows until 24 hours after the
 * latest arrival or departure on any of its stops — measured from what the
 * truck did, not from when someone closed it, because nothing records the
 * closing instant (§12.88 declined the migration that would). A closed load
 * nobody reached has nothing to anchor a window to and does not show.
 *
 * The boundary is inclusive: at exactly 24 hours it still shows, matching
 * the `>= since` the query used before this function replaced it.
 */
export const TIMELINE_KEEP_HOURS = 24;

export type TimelineStay =
  | { kind: 'open' }
  | { kind: 'until'; untilUtc: string; after: 'arrival' | 'departure' }
  | { kind: 'gone'; reason: 'stale'; lastUtc: string; after: 'arrival' | 'departure' }
  | { kind: 'gone'; reason: 'never-reached' };

export function timelineStay(
  load: {
    status: LoadStatus;
    stops: readonly { arrivedAt: string | null; departedAt: string | null }[];
  },
  now: number,
): TimelineStay {
  if (!isTerminal(load.status)) return { kind: 'open' };

  let last: { at: number; after: 'arrival' | 'departure' } | null = null;
  for (const stop of load.stops) {
    for (const [value, after] of [
      [stop.arrivedAt, 'arrival'],
      [stop.departedAt, 'departure'],
    ] as const) {
      if (value === null) continue;
      const at = Date.parse(value);
      // A departure at the same instant as an arrival is the later event.
      if (last === null || at > last.at || (at === last.at && after === 'departure')) {
        last = { at, after };
      }
    }
  }
  if (last === null) return { kind: 'gone', reason: 'never-reached' };

  const until = last.at + TIMELINE_KEEP_HOURS * 3_600_000;
  return until >= now
    ? { kind: 'until', untilUtc: new Date(until).toISOString(), after: last.after }
    : {
        kind: 'gone',
        reason: 'stale',
        lastUtc: new Date(last.at).toISOString(),
        after: last.after,
      };
}

/** Whether the timeline shows the load. The query filters with exactly this. */
export function showsOnTimeline(stay: TimelineStay): boolean {
  return stay.kind !== 'gone';
}

/** One line naming the stop, for the card heading. */
export function stopPlace(stop: TimelineStop): string {
  const place =
    stop.city && stop.state ? `${stop.city}, ${stop.state}` : stop.addressLine;
  return place ?? 'Address not given yet';
}
