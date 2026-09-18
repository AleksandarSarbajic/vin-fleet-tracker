import type { Status } from './status';

/**
 * Which status changes are worth interrupting someone for (§12.50).
 *
 * §9.11 specifies three toasts and makes status-change toasts "opt-in per
 * chip". There is no settings surface and building one for a single
 * preference is the wrong order — so the event set is narrowed until a
 * preference has nothing to do.
 *
 * Measured over 16.6 hours of real board data, 28 trucks with an open stop:
 *
 *     into LATE       8 crossings, 6 distinct truck+stop, worst hour 2
 *     into AT_RISK    4 crossings, 4 distinct truck+stop, worst hour 1
 *
 * LATE only. All four AT_RISK crossings were followed by a LATE crossing on
 * the same truck and stop 20 to 45 minutes later — so an AT_RISK toast is a
 * second interruption about a situation the dispatcher is about to be told
 * about again, and it flags no truck that LATE does not. That is exactly the
 * shape that teaches people to ignore toasts.
 *
 * `scripts/status-transitions.mts` is the tool that produced those counts.
 * Re-run it on a real week before revisiting AT_RISK — this window is one
 * day, because the §12.32 truncate took the rest.
 */

/** A transition is only news when it ENTERS this set. */
const WORTH_INTERRUPTING = new Set<Status>(['LATE']);

/**
 * Statuses that mean "we do not know", not "everything is fine".
 *
 * Leaving one of these is not a transition INTO anything — it is the fog
 * lifting on a fact that was already true. This is the rule the data forced:
 * truck 138 reports GPS once an hour, so it cycled
 * `LATE → STALE_GPS (at 45 min) → LATE` three times in one morning while
 * being continuously, unchangingly late.
 */
const FOG = new Set<Status>(['STALE_GPS', 'NO_APPT', 'UNASSIGNED']);

export interface FleetSnapshot {
  id: string;
  truckNumber: number | null;
  samsaraName: string;
  status: Status;
  /** The stop this status is about. Null when the truck holds no load. */
  stopId: string | null;
  /** True when a dispatcher is forcing this status (§9.5). */
  forced: boolean;
}

export interface StatusToast {
  /** `truckId|stopId` — the ledger key, and the React key. */
  id: string;
  truckLabel: string;
  status: Status;
  truckId: string;
}

export interface DetectInput {
  previous: Map<string, FleetSnapshot> | null;
  next: FleetSnapshot[];
  /** §5.9. True on either side of the change suppresses everything. */
  feedStaleBefore: boolean;
  feedStaleNow: boolean;
  /** Keys already toasted today. Mutated by the caller on accept. */
  alreadyToday: ReadonlySet<string>;
}

export const toastKey = (truckId: string, stopId: string | null): string =>
  `${truckId}|${stopId ?? 'none'}`;

/**
 * The transitions worth a toast, with every suppression applied.
 *
 * Pure, and it takes the previous snapshot as data rather than reading a ref,
 * so the suppression rules can be tested without a browser — which is the
 * only way to prove a rule that exists to stop something happening.
 */
export function detectToasts(input: DetectInput): StatusToast[] {
  const { previous, next, feedStaleBefore, feedStaleNow, alreadyToday } = input;

  /**
   * RULE 1 — first load. No previous poll means no transition, only a
   * starting position. Every LATE truck on the board is not news; it is the
   * board. This also covers a page refresh mid-shift.
   */
  if (previous === null) return [];

  /**
   * RULE 2 — the feed. When `feedStale` flips, every row becomes STALE_GPS
   * or comes back at once: 23 toasts for one event, none of them about a
   * truck. Suppressed on both edges, because the return is as synchronised
   * as the departure.
   */
  if (feedStaleBefore || feedStaleNow) return [];

  const out: StatusToast[] = [];
  for (const row of next) {
    const before = previous.get(row.id);

    /**
     * RULE 3 — a truck that was not on the board a poll ago. A truck
     * appearing already LATE has not crossed anything; it has arrived in the
     * query. (A truck LEAVING needs no rule: it is not in `next` to consider.)
     */
    if (!before) continue;

    if (!WORTH_INTERRUPTING.has(row.status) || row.status === before.status) continue;

    /**
     * RULE 4 — the fog states. Coming back from STALE_GPS is not becoming
     * late; it is being seen again. Without this, one truck reporting hourly
     * produces a toast an hour, all day, about one unchanging fact.
     */
    if (FOG.has(before.status)) continue;

    /**
     * RULE 5 — a forced status. The dispatcher who just set it does not need
     * telling what they typed. Checked on the NEW row: an override lifting
     * to reveal a genuine LATE is a real crossing and does toast.
     */
    if (row.forced) continue;

    /**
     * RULE 6 — once per truck and stop per dispatch day.
     *
     * A time debounce cannot do this job: the flapping in the real data has a
     * sixty-minute period, so any debounce short enough to be useful lets it
     * through, and one long enough to catch it would swallow genuine
     * crossings on a different truck.
     *
     * Keyed by stop, not by truck: the same truck going late on its NEXT stop
     * tomorrow is a different fact and gets its own toast.
     */
    const key = toastKey(row.id, row.stopId);
    if (alreadyToday.has(key)) continue;

    out.push({
      id: key,
      truckId: row.id,
      truckLabel: row.truckNumber === null ? row.samsaraName : String(row.truckNumber),
      status: row.status,
    });
  }
  return out;
}

/** `YYYY-MM-DD` in the DISPATCH zone — the day the ledger resets on. */
export function dispatchDay(at: Date, dispatchTz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: dispatchTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}
