import { StatusChip } from '@/components/console/StatusChip';
import { elapsed } from '@/lib/format';
import { upcomingLabel, type Status } from '@/lib/status';
import type { FleetRow } from '@/server/fleet-query';

/**
 * §12.145. What a truck is doing now, in the board's "Currently" column: the
 * console row's chip and the truck's position, from the fleet the console
 * polls (`useFleet`). Nothing here decides a status. `row.status` is the
 * server's (`applyStatus`, server/fleet-query.ts); this only draws it, by the
 * console row's rules.
 *
 * It is the SAVED assignment's live state. The board's draft never reaches
 * it: a pick changes the Driver column and its "was", not this.
 */

export interface ConsoleChip {
  status: Status;
  forced: boolean;
  label: string | undefined;
}

/**
 * The chip the console's row draws for this truck (`TruckRow`, its Status
 * cell). A stale FEED withdraws schedule colour from every chip: each becomes
 * the dotted Stale GPS carrying its fix's age (§5.9). A truck's own stale GPS
 * carries its age the same way (§5.1), and an upcoming load names its day
 * (§12.82). `Currently.test.tsx` renders the console's row beside this and
 * compares the two chips.
 */
export function consoleChip(
  row: FleetRow,
  feedStale: boolean,
  fetchedAt: string | null,
): ConsoleChip {
  const stale = feedStale || row.status === 'STALE_GPS';
  return {
    status: feedStale ? 'STALE_GPS' : row.status,
    forced: !feedStale && row.override !== null,
    label: stale
      ? (elapsed(row.recordedAt, fetchedAt ? new Date(fetchedAt) : undefined) ?? undefined)
      : row.status === 'TOMORROW' && row.upcoming
        ? upcomingLabel(row.upcoming)
        : undefined,
  };
}

export function Currently({
  row,
  feedStale,
  fetchedAt,
}: {
  /** The truck's row in the last fleet poll; undefined when the poll did not carry it. */
  row: FleetRow | undefined;
  feedStale: boolean;
  /** The poll's instant, which every age is measured from, as on the console. */
  fetchedAt: string | null;
}) {
  if (row === undefined) return null;

  // No driver is said by absence, never by the Unassigned chip (§12.18).
  if (row.driverName === null) {
    return (
      <span aria-label="No driver assigned" className="text-body text-text-muted">
        —
      </span>
    );
  }

  // The console's position cell: "City, ST" from the truck's own fix, the
  // whole Samsara string on hover, and "Last seen" once it is not live.
  const stale = feedStale || row.status === 'STALE_GPS';
  const position = stale ? `Last seen ${row.cityState ?? '—'}` : (row.cityState ?? '—');
  // No open load: the position only. A chip would be a status for nothing.
  const chip = row.openLoadCount > 0 ? consoleChip(row, feedStale, fetchedAt) : null;

  return (
    <>
      {chip ? <StatusChip status={chip.status} forced={chip.forced} label={chip.label} /> : null}
      <span
        data-position=""
        title={row.formattedLocation ?? undefined}
        className={`min-w-0 truncate text-body ${
          stale ? 'text-status-neutral-fg' : chip ? 'text-text-secondary' : 'text-text-muted'
        }`}
      >
        {position}
      </span>
    </>
  );
}
