import { elapsed } from '@/lib/format';
import { upcomingLabel, type Status } from '@/lib/status';
import type { FleetRow } from '@/server/fleet-query';

export interface ChipProps {
  status: Status;
  forced: boolean;
  label: string | undefined;
}

/**
 * The props of a truck's status chip, wherever the console draws it: the row
 * (`TruckRow`), the phone's card and sheet, the map popup, and the board's
 * Currently column (§12.145). One rule in one place, so no surface can show
 * a colour another has withdrawn. The popup's copy never withdrew it (3av).
 *
 * A stale FEED withdraws schedule colour from every chip: each becomes the
 * dotted Stale GPS carrying its fix's age, and never "forced" (§5.9). A
 * truck's own stale GPS carries its age the same way (§5.1), and an upcoming
 * load names its day (§12.82).
 *
 * Every age is measured from the poll's instant, never the clock: see
 * `fetchedAt` on TruckRow's props, on hydration.
 *
 * `chip-props.test.ts` fails the build if any other file under
 * src/components builds the stale status by hand again.
 */
export function chipProps(
  row: FleetRow,
  feedStale: boolean,
  fetchedAt: string | null,
): ChipProps {
  const stale = feedStale || row.status === 'STALE_GPS';
  return {
    status: feedStale ? 'STALE_GPS' : row.status,
    forced: !feedStale && row.override !== null,
    label: stale
      ? (elapsed(row.recordedAt, fetchedAt ? new Date(fetchedAt) : undefined) ??
        undefined)
      : row.status === 'TOMORROW' && row.upcoming
        ? upcomingLabel(row.upcoming)
        : undefined,
  };
}
