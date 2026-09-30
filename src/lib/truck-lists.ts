import { z } from 'zod';
import { VIEW_NAME_MAX } from '@/lib/views';
import type { Status } from '@/lib/status';

/**
 * §12.90 — shared truck lists: the rules, pure, so each can be argued with in
 * a unit test. The writes are `server/truck-lists.ts`.
 *
 * A list is a SHARED, named set of trucks — unlike a personal view (a chip set
 * and a search term, kept in one browser). The two combine: the list decides
 * which trucks are in scope, then the chips and the search narrow it, by AND.
 */

/** The same 40 as personal views, so the two menus hold names of one length. */
export const LIST_NAME_MAX = VIEW_NAME_MAX;
export const LIST_CAP = 50;
export const LIST_TRUCK_CAP = 200;

/**
 * Trimmed and whitespace-collapsed — the shape the database also checks.
 *
 * NOT views' `normalizeName`, which also cuts to 40 characters: a 45-character
 * list name would have been saved shortened without a word. Here an over-long
 * name is refused by the schema below and said so.
 */
export function normalizeListName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/** Two names are one list when they differ only in case or spacing. */
export function sameListName(a: string, b: string): boolean {
  return normalizeListName(a).toLowerCase() === normalizeListName(b).toLowerCase();
}

export interface ParsedNumbers {
  /** Each distinct truck number, in the order first typed. */
  numbers: number[];
  /** Numbers typed more than once — collapsed, and said so. */
  duplicates: number[];
  /** Pieces that are not a truck number at all. */
  junk: string[];
}

/**
 * Truck numbers pasted as text: separated by commas, spaces, periods,
 * semicolons or new lines, in any mix — "113, 116. 124 128;133".
 *
 * A PERIOD separates, it is not a decimal point: there is no truck 113.5, and
 * a list typed as "113.116.124" is three trucks. Leading zeros are dropped
 * ("0137" is 137), as the truck number is an integer column.
 */
export function parseTruckNumbers(text: string): ParsedNumbers {
  const numbers: number[] = [];
  const duplicates: number[] = [];
  const junk: string[] = [];
  for (const piece of text.split(/[\s,.;]+/)) {
    if (piece === '') continue;
    if (!/^\d{1,9}$/.test(piece)) {
      if (!junk.includes(piece)) junk.push(piece);
      continue;
    }
    const n = Number(piece);
    if (numbers.includes(n)) {
      if (!duplicates.includes(n)) duplicates.push(n);
    } else {
      numbers.push(n);
    }
  }
  return { numbers, duplicates, junk };
}

export interface FleetTruck {
  id: string;
  truckNumber: number | null;
  samsaraName: string;
  active: boolean;
}

/**
 * Typed numbers against the fleet: which are trucks (by id — what a list
 * stores) and which are not. A number not in the fleet cannot be saved, since
 * a list holds trucks and not numbers; it is reported, never silently dropped.
 */
export function resolveNumbers(
  numbers: readonly number[],
  fleet: readonly FleetTruck[],
): { ids: string[]; unknown: number[] } {
  const byNumber = new Map<number, string>();
  for (const t of fleet) if (t.truckNumber !== null) byNumber.set(t.truckNumber, t.id);
  const ids: string[] = [];
  const unknown: number[] = [];
  for (const n of numbers) {
    const id = byNumber.get(n);
    if (id === undefined) unknown.push(n);
    else if (!ids.includes(id)) ids.push(id);
  }
  return { ids, unknown };
}

/** A truck as a person reads it: its number, else Samsara's name for it. */
export function truckLabel(t: Pick<FleetTruck, 'truckNumber' | 'samsaraName'>): string {
  return t.truckNumber === null ? t.samsaraName : String(t.truckNumber);
}

/**
 * The list's scope: only its trucks. Applied BEFORE the chips and the search,
 * which then narrow it further — list AND chips AND search.
 */
export function scopeToList<T extends { id: string }>(
  rows: readonly T[],
  memberIds: ReadonlySet<string> | null,
): T[] {
  if (memberIds === null) return [...rows];
  return rows.filter((row) => memberIds.has(row.id));
}

export interface OutsideList {
  late: number;
  unassigned: number;
}

/**
 * §12.8. With a list active the chips count only its trucks, so a late or
 * unassigned truck OUTSIDE it would otherwise be invisible from the board.
 * These two are counted, over active trucks by status, the way their chips
 * count them. `null` when there is nothing to say: no list, or nothing late
 * or unassigned outside it.
 */
export function outsideList(
  rows: readonly { id: string; active: boolean; status: Status }[],
  memberIds: ReadonlySet<string> | null,
): OutsideList | null {
  if (memberIds === null) return null;
  const outside = { late: 0, unassigned: 0 };
  for (const row of rows) {
    if (memberIds.has(row.id) || !row.active) continue;
    if (row.status === 'LATE') outside.late += 1;
    if (row.status === 'UNASSIGNED') outside.unassigned += 1;
  }
  return outside.late + outside.unassigned === 0 ? null : outside;
}

/** "Outside this list: 2 late, 1 unassigned" — only the parts that are not zero. */
export function outsideListText(outside: OutsideList): string {
  const parts = [
    outside.late > 0 ? `${outside.late} late` : null,
    outside.unassigned > 0 ? `${outside.unassigned} unassigned` : null,
  ].filter((p): p is string => p !== null);
  return `Outside this list: ${parts.join(', ')}`;
}

/* ------------------------------- the wire ------------------------------- */

const Name = z
  .string()
  .transform(normalizeListName)
  .pipe(
    z
      .string()
      .min(1, 'Give the list a name.')
      .max(LIST_NAME_MAX, `A list name is at most ${LIST_NAME_MAX} characters.`),
  );
const TruckIds = z
  .array(z.string().uuid())
  .max(LIST_TRUCK_CAP, `A list can hold at most ${LIST_TRUCK_CAP} trucks.`);

export const CreateListRequest = z.object({ name: Name, truckIds: TruckIds });
export type CreateListRequest = z.infer<typeof CreateListRequest>;

/**
 * An edit states the WHOLE list it wants and the version it started from.
 * Refused if the list moved on in between — never merged silently.
 */
export const UpdateListRequest = z.object({
  op: z.literal('update'),
  id: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  name: Name,
  truckIds: TruckIds,
});
/** "Add to list…": only adds, so it cannot overwrite anyone and has no version. */
export const AddToListRequest = z.object({
  op: z.literal('add'),
  id: z.string().uuid(),
  truckIds: z.array(z.string().uuid()).min(1).max(LIST_TRUCK_CAP),
});
export const PatchListRequest = z.discriminatedUnion('op', [
  UpdateListRequest,
  AddToListRequest,
]);
export type UpdateListRequest = z.infer<typeof UpdateListRequest>;
export type AddToListRequest = z.infer<typeof AddToListRequest>;

export const DeleteListRequest = z.object({
  id: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
});
export type DeleteListRequest = z.infer<typeof DeleteListRequest>;

/** What the console receives for each list. */
export interface TruckList {
  id: string;
  name: string;
  version: number;
  truckIds: string[];
  updatedAt: string;
  updatedByName: string | null;
}
