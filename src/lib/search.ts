import { expandQuery } from './us-states';

/** Debounce for the search field (design-spec §9.6). */
export const SEARCH_DEBOUNCE_MS = 250;

export interface Searchable {
  truckNumber: number | null;
  samsaraName: string;
  driverName: string | null;
  cityState: string | null;
  formattedLocation: string | null;
  /**
   * The next stop, searched by facility, city, state and load number — the
   * §9.6 field set. Structured rather than a pre-joined string so the row
   * type stays the one the list renders from.
   */
  nextStop?: {
    loadNumber: string;
    facilityName: string | null;
    city: string | null;
    state: string | null;
  } | null;
}

/**
 * Fields are joined with a separator that cannot appear inside one, so a
 * query can never match by straddling the boundary between two of them.
 */
const FIELD_SEPARATOR = ' | ';

function haystack(row: Searchable): string {
  return [
    row.truckNumber === null ? '' : String(row.truckNumber),
    row.samsaraName,
    row.driverName ?? '',
    row.cityState ?? '',
    row.formattedLocation ?? '',
    row.nextStop?.loadNumber ?? '',
    row.nextStop?.facilityName ?? '',
    row.nextStop?.city ?? '',
    row.nextStop?.state ?? '',
  ]
    .join(FIELD_SEPARATOR)
    .toLowerCase();
}

/**
 * True when the row matches. Search REMOVES rows and never re-sorts, so a
 * dispatcher's muscle memory for row positions survives typing.
 */
export function matches(row: Searchable, query: string): boolean {
  const needles = expandQuery(query);
  if (needles.length === 0) return true;
  const hay = haystack(row);
  return needles.some((n) => hay.includes(n));
}

export function filterRows<T extends Searchable>(rows: T[], query: string): T[] {
  if (!query.trim()) return rows;
  return rows.filter((row) => matches(row, query));
}

export interface Segment {
  text: string;
  hit: boolean;
}

/**
 * Splits a cell into highlighted and plain runs for rendering. Prefers the
 * earliest match, and the longest one at that position, so searching "kansas"
 * highlights the whole word rather than stopping at a shorter expansion.
 */
export function highlight(text: string | null, query: string): Segment[] {
  if (!text) return [];
  const needles = expandQuery(query).filter(Boolean);
  if (needles.length === 0) return [{ text, hit: false }];

  const lower = text.toLowerCase();
  const segments: Segment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    let bestAt = -1;
    let bestLen = 0;
    for (const n of needles) {
      const at = lower.indexOf(n, cursor);
      if (at === -1) continue;
      if (bestAt === -1 || at < bestAt || (at === bestAt && n.length > bestLen)) {
        bestAt = at;
        bestLen = n.length;
      }
    }
    if (bestAt === -1) {
      segments.push({ text: text.slice(cursor), hit: false });
      break;
    }
    if (bestAt > cursor) {
      segments.push({ text: text.slice(cursor, bestAt), hit: false });
    }
    segments.push({ text: text.slice(bestAt, bestAt + bestLen), hit: true });
    cursor = bestAt + bestLen;
  }

  return segments.filter((s) => s.text.length > 0);
}
