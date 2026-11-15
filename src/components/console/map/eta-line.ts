import type { FleetRow } from '@/server/fleet-query';
import { timeInZone } from '@/lib/format';
import { milesText } from '../TruckRow';

/**
 * Phase 3bw, QoL feature 14 (§12.163). The ETA line the popup's Copy ETA puts on the clipboard.
 *
 * One line, in the 3bf demo's words: `Truck 101 · Chicago, IL · ETA 14:18 CDT · 412 mi`. The
 * time and the miles come from the functions the popup's Projected line draws with
 * (`timeInZone`, `milesText`), so the two can never say different things; the abbreviation is
 * Intl's, at the moment of the copy, never stored (CLAUDE.md). Clipboard only: nothing is sent
 * to anyone.
 *
 * It refuses, and says why, where the board says not to quote an ETA: on a stale feed
 * (`FeedBanner`: "do not quote an ETA from this screen", §5.9), and where there is none.
 */
export const FEED_DOWN_REFUSAL = 'The feed is down, so there is no ETA to quote from this screen.';

export function etaLine(row: FleetRow, feedStale: boolean): { text: string } | { refused: string } {
  const truck = row.truckNumber ?? row.samsaraName;
  if (feedStale) return { refused: FEED_DOWN_REFUSAL };
  const stop = row.nextStop;
  const zone = stop?.apptTz;
  if (!stop || row.etaAbsence !== 'has-eta' || !row.etaUtc || !zone) {
    return { refused: `Truck ${truck} has no ETA to copy.` };
  }
  const place = [stop.city, stop.state].filter(Boolean).join(', ') || stop.addressLine || 'its next stop';
  const miles = milesText(row.milesRemaining);
  return {
    text: [`Truck ${truck}`, place, `ETA ${timeInZone(new Date(row.etaUtc), zone)}`, ...(miles ? [miles] : [])].join(' · '),
  };
}
