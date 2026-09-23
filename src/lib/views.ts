/**
 * Saved filter views (§14 feature 11). **Interpretation** — turn 5 listed it
 * and drew no screen.
 *
 * ## What a view is, and what it deliberately is not
 *
 * A view is the two things that decide WHICH TRUCKS are on screen: the chip
 * set and the search term. §9.6 already put both in the URL so a link carries
 * a view; this is the same idea given a name and kept locally.
 *
 * Three things a dispatcher might expect in one, and why none is:
 *
 *   - **The selected truck.** A cursor, not a view. Saving it would mean
 *     applying a view moves the map, and "show me the late ones" would drag
 *     the board to wherever a truck was three days ago.
 *   - **Row density.** A display preference that belongs to a person and
 *     their screen, not to a slice of the fleet (§14 feature 5). It already
 *     persists on its own, and a view that changed it would fight the `D`
 *     key.
 *   - **Pinned trucks.** Also a person, not a view. Applying a view must
 *     never silently change which trucks someone chose to watch.
 *
 * ## Why it refuses rather than overwrites
 *
 * Same ruling as the pin cap, for the same reason. A saved view replaced
 * without a word is a thing someone deliberately made, gone — and unlike a
 * pin it took typing. Both the cap and a name collision refuse and say so.
 */

/** Eight, and the menu stays one screen without scrolling. */
export const VIEW_CAP = 8;
export const VIEW_STORAGE_KEY = 'ft.views';
export const VIEW_NAME_MAX = 40;

export interface SavedView {
  id: string;
  name: string;
  query: string;
  /** Validated against the live chip list on read — see `readViews`. */
  chips: string[];
}

export interface ViewState {
  query: string;
  chips: readonly string[];
}

/**
 * Names are compared with whitespace collapsed and case folded, so "Late
 * today", "late today" and "Late  today" are the same view to a person and
 * therefore the same view here.
 */
export function normalizeName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, VIEW_NAME_MAX);
}

const sameName = (a: string, b: string) =>
  a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** Order-insensitive: a view is its chip SET, however it was clicked together. */
const sameChips = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

export function sameView(a: ViewState, b: ViewState): boolean {
  return a.query.trim() === b.query.trim() && sameChips(a.chips, b.chips);
}

/**
 * The saved views, with anything that is not one dropped.
 *
 * `validChips` is passed in rather than imported, so this file stays free of
 * the component layer — and so the validation is a visible argument rather
 * than a hidden dependency. It is not optional: `passesFilters` indexes a
 * record by the key, so one junk chip from a hand-edited `localStorage`
 * throws inside a render, and the console shows an error boundary instead of
 * a fleet.
 */
export function readViews(validChips: readonly string[]): SavedView[] {
  try {
    const raw = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .flatMap((entry): SavedView[] => {
        if (typeof entry !== 'object' || entry === null) return [];
        const { id, name, query, chips } = entry as Record<string, unknown>;
        if (typeof id !== 'string' || typeof name !== 'string') return [];
        const cleanName = normalizeName(name);
        if (cleanName === '') return [];
        return [
          {
            id,
            name: cleanName,
            query: typeof query === 'string' ? query : '',
            chips: Array.isArray(chips)
              ? chips.filter(
                  (c): c is string => typeof c === 'string' && validChips.includes(c),
                )
              : [],
          },
        ];
      })
      .slice(0, VIEW_CAP);
  } catch {
    // Storage unavailable, or someone hand-edited it. No views costs nothing;
    // an exception here costs the console.
    return [];
  }
}

export function writeViews(views: readonly SavedView[]): void {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(views));
  } catch {
    // The views are lost on reload. Nothing else is.
  }
}

export type SaveRefusal = 'cap' | 'duplicate-name' | 'empty-name';

export interface SaveResult {
  views: SavedView[];
  refused: SaveRefusal | null;
}

export function addView(
  views: readonly SavedView[],
  input: { name: string; state: ViewState; id: string },
): SaveResult {
  const name = normalizeName(input.name);
  if (name === '') return { views: [...views], refused: 'empty-name' };
  if (views.some((v) => sameName(v.name, name))) {
    return { views: [...views], refused: 'duplicate-name' };
  }
  if (views.length >= VIEW_CAP) return { views: [...views], refused: 'cap' };
  return {
    views: [
      ...views,
      {
        id: input.id,
        name,
        query: input.state.query.trim(),
        chips: [...input.state.chips],
      },
    ],
    refused: null,
  };
}

export function removeView(views: readonly SavedView[], id: string): SavedView[] {
  return views.filter((v) => v.id !== id);
}

/** The saved view the board is showing right now, if it is showing one. */
export function activeView(
  views: readonly SavedView[],
  state: ViewState,
): SavedView | null {
  return views.find((v) => sameView(v, state)) ?? null;
}

/** What the save control should say it will refuse, before it is pressed. */
export function refusalMessage(refusal: SaveRefusal, name: string): string {
  switch (refusal) {
    case 'cap':
      return `${VIEW_CAP} views is the limit — delete one first`;
    case 'duplicate-name':
      return `“${normalizeName(name)}” is already saved`;
    case 'empty-name':
      return 'Give the view a name';
  }
}
