import { StatusChip } from '@/components/console/StatusChip';
import { chipProps } from '@/components/console/chip-props';
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
 *
 * The chip's props are the console's own (`chipProps`, shared with the row,
 * the phone and the popup). `Currently.test.tsx` renders the console's row
 * beside this and compares the two chips.
 */

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
  const chip = row.openLoadCount > 0 ? chipProps(row, feedStale, fetchedAt) : null;

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
