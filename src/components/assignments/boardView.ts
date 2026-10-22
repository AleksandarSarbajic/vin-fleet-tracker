import type { AssignmentBoard as Board, BoardDriver } from '@/server/assignments';
import { isEldBacked } from '@/lib/driver';

/**
 * What the assignment board SHOWS: its search, its filter tabs and the
 * shared-phone rule (§12.137, §12.138). View only. Nothing here reads or
 * writes the draft's edits or the save request; it is handed the draft and
 * decides which rows are on screen.
 */

/** One truck as the board shows it: the driver is the DRAFT's, not the saved one. */
export interface BoardRow {
  truck: Board['trucks'][number];
  label: string;
  driverId: string | null;
  /** Null for an empty truck, and for a driver the board's list does not have yet. */
  driver: BoardDriver | null;
}

/**
 * A phone's digits for comparing two numbers, without the punctuation people
 * type and without a leading US 1: "+1 (708) 555-0101" and "708.555.0101"
 * are one number. Empty for no number.
 */
export function phoneDigits(phone: string | null): string {
  if (phone === null) return '';
  const digits = phone.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

/**
 * The numbers two or more DIFFERENT drivers have, each with those drivers in
 * board order (§12.138).
 *
 * By driver, not by row: one driver on two trucks (a double-booking, which
 * the footer already names) is one person with one phone, not two people
 * sharing one. Counting rows would raise the warning on every double-booking.
 * Every active driver counts, on a truck or not: the board lists both.
 */
export function sharedPhones(drivers: BoardDriver[]): Map<string, BoardDriver[]> {
  const byDigits = new Map<string, BoardDriver[]>();
  for (const driver of drivers) {
    const digits = phoneDigits(driver.phone);
    if (digits === '') continue;
    byDigits.set(digits, [...(byDigits.get(digits) ?? []), driver]);
  }
  return new Map([...byDigits].filter(([, group]) => new Set(group.map((d) => d.id)).size > 1));
}

export type BoardFilter = 'all' | 'noDriver' | 'noPhone' | 'noEld' | 'sharedPhone';

export const BOARD_FILTERS: readonly { key: BoardFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'noDriver', label: 'No driver' },
  { key: 'noPhone', label: 'No phone' },
  { key: 'noEld', label: 'No ELD' },
  { key: 'sharedPhone', label: 'Shared phone' },
];

/** Whether a row is in a filter's tab. `shared` is the ids of drivers in `sharedPhones`. */
export function inFilter(row: BoardRow, filter: BoardFilter, shared: Set<string>): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'noDriver':
      return row.driverId === null;
    case 'noPhone':
      return row.driver !== null && row.driver.phone === null;
    case 'noEld':
      return row.driver !== null && !isEldBacked(row.driver);
    case 'sharedPhone':
      return row.driver !== null && shared.has(row.driver.id);
  }
}

/** Each tab's count, from the rows as the draft has them. */
export function filterCounts(rows: BoardRow[], shared: Set<string>): Record<BoardFilter, number> {
  const counts = { all: 0, noDriver: 0, noPhone: 0, noEld: 0, sharedPhone: 0 };
  for (const { key } of BOARD_FILTERS) {
    counts[key] = rows.filter((row) => inFilter(row, key, shared)).length;
  }
  return counts;
}

/**
 * The search: a truck's number (or Samsara name), the draft driver's name,
 * or the digits of their phone, with the query's punctuation ignored. Blank
 * matches every row.
 */
export function matchesSearch(row: BoardRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  if (row.label.toLowerCase().includes(needle)) return true;
  if (row.driver === null) return false;
  if (row.driver.name.toLowerCase().includes(needle)) return true;
  const digits = phoneDigits(needle);
  return digits !== '' && phoneDigits(row.driver.phone).includes(digits);
}
