/**
 * §12.136. "Night desk", the assignment page's own look (HANDOFF 3an).
 *
 * Only `/assignments` uses it. The parts it shares with the rest of the
 * console — DriverSelect (the edit modal's picker) and DriverName / NoEldTag
 * (every driver name on every surface) — take a `look` prop that defaults to
 * `'console'`, and render exactly as before 3an unless `'nightDesk'` is passed
 * (look-scope.test.tsx holds that, markup for markup). A prop rather than a
 * CSS scope on the page's root, because the default path is then the old
 * code itself, not old code plus selectors that must never match elsewhere.
 */
export type Look = 'console' | 'nightDesk';

/**
 * Night desk's focus ring: 1px of its accent, 2px out. The console's is 2px
 * of `accent` (globals.css), which these utilities outrank on the elements
 * that carry them. Every control on the page carries one of the two.
 */
export const ND_FOCUS =
  'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-nightDesk-accent';

/** The same ring drawn inside, for the open list, which clips its overflow. */
export const ND_FOCUS_INSET =
  'focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-nightDesk-accent';
