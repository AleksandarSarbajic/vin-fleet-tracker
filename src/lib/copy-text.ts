import type { FleetRow } from '@/server/fleet-query';

/**
 * What the copy controls put on the clipboard (§14, feature 3).
 *
 * §14.5 placed them — "copy at the right edge of `Next stop` and the load
 * cell on hover only" — and specified no formats, so these are chosen here
 * and tested here rather than being whatever a JSX expression happened to
 * produce.
 *
 * The two formats answer two different needs, which is why one control is
 * not enough:
 *
 *   address     pasted into a maps app or a text to a driver. One line, no
 *               labels, nothing a geocoder has to strip.
 *   load info   pasted into an email or a broker's portal. Labelled lines,
 *               because the recipient has no column headers to read it by.
 *
 * Both are plain text. A rich-text clipboard would arrive styled in one
 * target and mangled in three.
 */

/** One line, the way an address is written on an envelope. */
export function addressText(row: FleetRow): string | null {
  const stop = row.nextStop;
  if (!stop) return null;
  const locality = [stop.city, stop.state].filter(Boolean).join(', ');
  const line = [stop.addressLine, locality, stop.zip].filter(Boolean).join(', ');
  return line.length > 0 ? line : null;
}

/**
 * The load, labelled, one fact per line.
 *
 * The load number is permanently optional (§12.21), so a blank one says so
 * rather than being omitted — a pasted block with a silently missing line is
 * how someone ends up believing a load has a number that nobody recorded.
 */
export function loadText(row: FleetRow): string | null {
  const stop = row.nextStop;
  if (!stop) return null;
  const truck = row.truckNumber === null ? row.samsaraName : String(row.truckNumber);
  const address = addressText(row);
  return [
    `Load: ${stop.loadNumber ?? 'not given yet'}`,
    `Truck: ${truck}`,
    row.driverName ? `Driver: ${row.driverName}` : 'Driver: unassigned',
    `${stop.type === 'PU' ? 'Pick up' : 'Deliver'}: ${address ?? 'address not known'}`,
  ].join('\n');
}
