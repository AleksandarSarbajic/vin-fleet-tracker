import { urgencyRank, type Status } from './status';

/**
 * The list's ordering rules, deliberately apart from the component that uses
 * them and from the phase-3 placeholder that currently supplies the statuses.
 *
 * This file and its test survive the placeholder's deletion in phase 5: the
 * comparator is pure, structural, and knows nothing about where a status came
 * from. Its test builds its own rows.
 */

export type SortMode = 'urgency' | 'truck';

/** Everything the comparator reads. `FleetRow` satisfies it structurally. */
export interface Sortable {
  status: Status;
  truckNumber: number | null;
  /**
   * The appointment instant for the truck's next stop, ISO-8601 UTC.
   *
   * TODO(phase 4): supplied by `stops` once loads exist. Absent today, which
   * the comparator treats exactly like null — sorted last, never as zero.
   */
  apptAt?: string | null;
}

/**
 * Nulls sort last, so a finite sentinel rather than Infinity: two missing
 * values must subtract to 0, and `Infinity - Infinity` is NaN, which a
 * comparator must never return.
 */
const LAST = Number.MAX_SAFE_INTEGER;

/**
 * Epoch millis, or LAST. Parsed rather than compared as text: lexicographic
 * order only matches chronological order for one fixed rendering, and this
 * field will come from a different query in phase 4 than the one that pins
 * `recorded_at` to a fixed format today. An unparseable value sorts last
 * instead of poisoning the comparison with NaN.
 */
function instant(value: string | null | undefined): number {
  if (value === null || value === undefined) return LAST;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? LAST : ms;
}

function truckKey(row: Sortable): number {
  return row.truckNumber ?? LAST;
}

/**
 * design-spec §12.4 and §5: urgency band first, appointment time ascending
 * within a band, truck number as the final tiebreak so the order is total and
 * two rows never swap between renders.
 *
 * The band order is `STATUSES` in lib/status.ts — LATE, STALE_GPS,
 * UNASSIGNED, AT_RISK, NO_APPT, ARRIVED, ON_TIME, TOMORROW.
 */
export function compareFleet(mode: SortMode) {
  return (a: Sortable, b: Sortable): number => {
    if (mode === 'urgency') {
      const byUrgency = urgencyRank(a.status) - urgencyRank(b.status);
      if (byUrgency !== 0) return byUrgency;

      const byAppointment = instant(a.apptAt) - instant(b.apptAt);
      if (byAppointment !== 0) return byAppointment;
    }
    return truckKey(a) - truckKey(b);
  };
}
