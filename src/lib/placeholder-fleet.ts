import type { Status } from '@/lib/status';

/**
 * ============================================================================
 * PHASE 3 SCAFFOLDING — FABRICATED DATA. NOT REAL.
 * ============================================================================
 *
 * Two things the console needs that the database cannot supply yet:
 *
 *   status  TODO(phase 5): replaced by the real engine in `lib/status.ts`.
 *   driver  TODO(phase 4): replaced by real rows in `assignments`. Samsara
 *           returns data:null for this org (docs/samsara.md §6), so there is
 *           genuinely nothing to sync — dispatchers create assignments in the
 *           edit modal.
 *
 * Everything fabricated here is produced by ONE function, called from ONE
 * place. Deleting that call removes every invented value from the app; it
 * will not leave fabricated data hiding behind a flag somewhere.
 *
 * A real assignment always wins: if `assignments` has an open row for a truck,
 * the query returns that driver and the placeholder is not consulted.
 * ============================================================================
 */

/**
 * A deliberate spread, not a random one. Every status appears at least once so
 * the whole palette is visible on real tiles before phase 5 makes it real —
 * including STALE_GPS, whose hatched marker is the one most likely to read
 * badly at small sizes.
 *
 * Proportions follow the `3c` 30-truck console, scaled to ~23 active trucks.
 */
const SPREAD: Status[] = [
  'LATE',
  'LATE',
  'STALE_GPS',
  'STALE_GPS',
  'UNASSIGNED',
  'AT_RISK',
  'AT_RISK',
  'AT_RISK',
  'NO_APPT',
  'ARRIVED',
  'ARRIVED',
  'ON_TIME',
  'ON_TIME',
  'ON_TIME',
  'ON_TIME',
  'ON_TIME',
  'ON_TIME',
  'ON_TIME',
  'ON_TIME',
  'TOMORROW',
  'TOMORROW',
  'TOMORROW',
  'TOMORROW',
];

export interface Placeholdable {
  id: string;
  truckNumber: number | null;
  driverName: string | null;
  status: Status;
  driverIsPlaceholder: boolean;
}

/**
 * Applies the fabricated overlay. Deterministic: the same fleet always gets
 * the same statuses and drivers, so a reload does not reshuffle the colours
 * and a screenshot stays meaningful.
 *
 * Ordering is by truck number, NOT by database order, so the assignment does
 * not shift when a truck is added or its `active` flag flips.
 */
export function applyPlaceholders<T extends Placeholdable>(
  rows: T[],
  driverNames: string[],
): T[] {
  const ordered = [...rows].sort(
    (a, b) => (a.truckNumber ?? 1e9) - (b.truckNumber ?? 1e9),
  );
  const statusByTruck = new Map<string, Status>();
  const driverByTruck = new Map<string, string>();

  ordered.forEach((row, index) => {
    statusByTruck.set(row.id, SPREAD[index % SPREAD.length] ?? 'ON_TIME');
    if (driverNames.length > 0) {
      driverByTruck.set(row.id, driverNames[index % driverNames.length] ?? '');
    }
  });

  return rows.map((row) => {
    const status = statusByTruck.get(row.id) ?? 'ON_TIME';
    // A truck with no driver reads Unassigned in the UI (design-spec §5.8),
    // so the placeholder must not hand one to an UNASSIGNED row.
    const wantsDriver = status !== 'UNASSIGNED';
    const placeholderDriver = wantsDriver ? driverByTruck.get(row.id) : undefined;

    return {
      ...row,
      status,
      driverName: row.driverName ?? placeholderDriver ?? null,
      driverIsPlaceholder: row.driverName === null && placeholderDriver !== undefined,
    };
  });
}
