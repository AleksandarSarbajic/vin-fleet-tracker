/**
 * The way back to the board (§12.104).
 *
 * The board keeps its whole view in its address — `?list=`, `?chips=`, `?q=`,
 * `?truck=` — so the address IS the view. The board writes it to this tab's
 * sessionStorage every time it changes, and the history page's Board button
 * (and G B, and the phone's Board link) go back to it instead of to a bare
 * `/`.
 *
 * sessionStorage, not localStorage: a tab's board is that tab's. A new tab
 * starts at `/`, and a second dispatcher's view never leaks into the first's.
 *
 * Written on every change rather than at the moment of leaving. There are
 * several ways off the board (the account menu, G H, the palette, the phone's
 * menu, the browser's own address bar), and a save hung on each of them is a
 * save one of them forgets. A save on every change cannot be skipped.
 */

export const BOARD_RETURN_KEY = 'ft.boardReturn';

/** The only parameters the board reads. Anything else is not the board's. */
const BOARD_PARAMS = ['list', 'chips', 'q', 'truck'] as const;

/** Only the board's own parameters, in a fixed order. */
function boardParams(search: string): URLSearchParams {
  const from = new URLSearchParams(search);
  const kept = new URLSearchParams();
  for (const key of BOARD_PARAMS) {
    const value = from.get(key);
    if (value !== null && value !== '') kept.set(key, value);
  }
  return kept;
}

export function rememberBoard(search: string): void {
  try {
    window.sessionStorage.setItem(BOARD_RETURN_KEY, boardParams(search).toString());
  } catch {
    // Storage unavailable: the Board button goes to `/`, as it did before.
  }
}

/**
 * Where the Board button goes. `/` when nothing was saved, and `/` when what
 * was saved names a list that has since been deleted or a chip that no longer
 * exists — a stale view is dropped whole rather than opened half-applied with
 * a warning about it.
 */
export function boardReturnHref(
  known: { listIds: readonly string[]; chips: readonly string[] },
): string {
  let saved: string | null;
  try {
    saved = window.sessionStorage.getItem(BOARD_RETURN_KEY);
  } catch {
    // Storage unavailable, as on a fresh tab: the board's plain address.
    return '/';
  }
  if (!saved) return '/';
  const params = boardParams(saved);
  const list = params.get('list');
  if (list !== null && !known.listIds.includes(list)) return '/';
  const chips = (params.get('chips') ?? '').split(',').filter(Boolean);
  if (chips.some((chip) => !known.chips.includes(chip))) return '/';
  const qs = params.toString();
  return qs ? `/?${qs}` : '/';
}
