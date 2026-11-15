import { highlight } from '@/lib/search';
import type { FleetRow } from '@/server/fleet-query';

/**
 * Phase 3bw, QoL feature 10 (§12.163). Why a row is in a searched list, when nothing it shows
 * says so.
 *
 * The search reads ten fields (`lib/search.ts`) and a row shows four of them, so a query that
 * matched a load number, a street or a ZIP left a row in the list with no mark anywhere (3bf's
 * found wrong 4). When no shown text holds a match, the first hidden field that does is shown,
 * with its mark, at the start of the next-stop cell.
 */
export interface SearchHint {
  /** What the field is, in the row's own words: "Load", "Street", "ZIP". */
  label: string;
  /** The field's whole text, to be marked where it matched. */
  text: string;
}

const hits = (text: string | null | undefined, query: string): boolean =>
  Boolean(text) && highlight(text!, query).some((part) => part.hit);

/**
 * The hint for a row, or null when the row already shows its match or there is no query.
 *
 * `shown` is every text the row draws and marks (the truck, the driver, the position when its
 * column is drawn, the next stop). `positionShown` is false below the eight-column width,
 * where the position column is cut, so a match there needs saying too.
 */
export function searchHint(
  row: FleetRow,
  query: string,
  shown: readonly (string | null | undefined)[],
  positionShown: boolean,
): SearchHint | null {
  if (!query.trim()) return null;
  if (shown.some((text) => hits(text, query))) return null;
  const stop = row.nextStop;
  const hidden: [string, string | null | undefined][] = [
    ['Load', stop?.loadNumber],
    ['Street', stop?.addressLine],
    ['City', stop?.city],
    ['State', stop?.state],
    ['ZIP', stop?.zip],
    ['Position', positionShown ? null : row.cityState],
    ['Location', row.formattedLocation],
    ['Name', row.samsaraName],
  ];
  const found = hidden.find(([, text]) => hits(text, query));
  return found ? { label: found[0], text: found[1]! } : null;
}
