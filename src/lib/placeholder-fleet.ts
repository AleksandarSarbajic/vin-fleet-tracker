import type { Status } from '@/lib/status';

/**
 * ============================================================================
 * PHASE 3 SCAFFOLDING — FABRICATED DATA. NOT REAL.
 * ============================================================================
 *
 * ONE thing the console still needs that the database cannot supply:
 *
 *   status  TODO(phase 5): replaced by the real engine in `lib/status.ts`.
 *
 * The driver half is GONE as of phase 4. Drivers are real rows in
 * `assignments` now, entered on the bulk assignment screen — Samsara returns
 * data:null for this org (docs/samsara.md §6), so there was never anything to
 * sync and there is nothing left to fabricate.
 *
 * What remains is produced by ONE function, called from ONE place. Deleting
 * that call removes every invented value from the app; nothing is hiding
 * behind a flag somewhere. `placeholder-guard.test.ts` keeps it that way.
 * ============================================================================
 */

/**
 * A deliberate spread, not a random one, and deliberately NOT in urgency
 * order.
 *
 * Every status appears at least once so the whole palette is visible on real
 * tiles before phase 5 makes it real — including STALE_GPS, whose hatched
 * marker is the one most likely to read badly at small sizes.
 *
 * The sequence is scattered on purpose. An earlier version listed the
 * statuses in urgency order, which made the fabricated status a monotonic
 * function of truck number: urgency order and truck-number order came out
 * identical, so the list looked correct whether or not the sort ran at all.
 * The sort was unverifiable on screen. Problem statuses now sit at both ends
 * of the range and the two orders visibly disagree.
 *
 * Position in truck-number order, against the active fleet on 2026-09-17:
 *
 *   113 On time    128 At risk    137 Unassigned   144 On time
 *   116 LATE       130 On time    138 On time      145 At risk
 *   122 Stale GPS  132 Arrived    139 At risk      146 Arrived
 *   124 Tomorrow   133 No appt    140 LATE         147 On time
 *   126 On time    135 On time    141 On time      246 Tomorrow
 *                  136 Tomorrow   142 Tomorrow
 *                                 143 Stale GPS
 *
 * Those numbers move if the roster changes, since the index is a position and
 * not the number itself. What survives a roster change is the property that
 * matters: the sequence itself does not track the index.
 *
 * Proportions follow the `3c` 30-truck console, scaled to ~23 active trucks:
 * 8 on time, 4 tomorrow, 3 at risk, 2 late, 2 stale, 2 arrived, 1 unassigned,
 * 1 no appt.
 */
const SPREAD: Status[] = [
  'ON_TIME',
  'LATE',
  'STALE_GPS',
  'TOMORROW',
  'ON_TIME',
  'AT_RISK',
  'ON_TIME',
  'ARRIVED',
  'NO_APPT',
  'ON_TIME',
  'TOMORROW',
  'UNASSIGNED',
  'ON_TIME',
  'AT_RISK',
  'LATE',
  'ON_TIME',
  'TOMORROW',
  'STALE_GPS',
  'ON_TIME',
  'AT_RISK',
  'ARRIVED',
  'ON_TIME',
  'TOMORROW',
];

export interface Placeholdable {
  id: string;
  truckNumber: number | null;
  status: Status;
}

/**
 * Applies the fabricated status. Deterministic: the same fleet always gets the
 * same statuses, so a reload does not reshuffle the colours and a screenshot
 * stays meaningful.
 *
 * Ordering is by truck number, NOT by database order, so the assignment does
 * not shift when a truck is added or its `active` flag flips.
 */
export function applyPlaceholders<T extends Placeholdable>(rows: T[]): T[] {
  const ordered = [...rows].sort(
    (a, b) => (a.truckNumber ?? 1e9) - (b.truckNumber ?? 1e9),
  );
  const statusByTruck = new Map<string, Status>();
  ordered.forEach((row, index) => {
    statusByTruck.set(row.id, SPREAD[index % SPREAD.length] ?? 'ON_TIME');
  });

  return rows.map((row) => ({
    ...row,
    status: statusByTruck.get(row.id) ?? 'ON_TIME',
  }));
}
