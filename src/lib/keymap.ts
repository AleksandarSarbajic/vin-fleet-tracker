/**
 * Every keyboard binding the console has, in one place (§14.1).
 *
 * ## Why this exists
 *
 * The bindings were spread across four components — `Console`, `FilterChips`,
 * `SearchField` and `AccountMenu` — each with its own `keydown` listener and
 * its own copy of the "is the user typing?" guard. That was survivable while
 * nothing had to DESCRIBE the keymap.
 *
 * §14 adds two things that do: a cheat sheet and a command palette. The
 * design brief had to assert the keymap from the outside — *"No codebase is
 * connected, so the keymap can't be pulled from source"* — and a sheet built
 * from that assertion is a second copy that starts drifting the first time
 * anyone adds a key and forgets the list.
 *
 * So the sheet renders from THIS, and adding a binding without describing it
 * is the thing that becomes hard, rather than the thing that happens by
 * accident.
 *
 * ## What it is not
 *
 * It is not a dispatcher. The handlers still live with the components that
 * own the behaviour, because `1–7` needs the chip list and `Enter` needs the
 * two cursors §12.46 reconciles. Centralising the *behaviour* would move that
 * logic away from the state it reads, which is worse than the duplication it
 * would remove. What is centralised is the DESCRIPTION and the GUARD.
 */

/**
 * The one typing guard (§14.3).
 *
 * All three existing copies checked `INPUT` and `TEXTAREA` and none checked
 * `contenteditable`, so a single-key binding would still fire inside a rich
 * text field. Nothing in the console is contenteditable today; the guard
 * covers it because the next thing that is will not come with a reminder.
 *
 * `closest` rather than a tag check on the target alone: a click inside a
 * contenteditable can leave the event target on a child node.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

/**
 * The one window guard: is a window open, so the board's keys are not the board's
 * to answer?
 *
 * `isTypingTarget` alone let them through whenever focus was on a BUTTON in a
 * window. `G H` behind the edit window left the page with the typed work in it and
 * no question, and "gh" is in ordinary words. `⌘K` and `?` opened a second window
 * underneath the first and took the focus into it.
 *
 * It reads the page rather than any one component's state, so a window nobody here
 * has heard of counts the moment it is drawn. What it reads is `aria-modal`, which
 * every `DialogFrame` carries (`window-keys-guard.test.ts` holds them to it):
 *
 * - **A menu is not a window.** It has no `aria-modal`, and the board's keys work
 *   around it as they always did.
 * - **The fading copy does not count.** `dialog-motion.ts` strips its `aria-*`, so
 *   keys work again the moment a window closes, not when its copy has faded.
 * - **A window nobody can see does not count.** The phone sheets are `md:hidden` and
 *   stay mounted, so one left open and widened past 768 is still in the document,
 *   marked modal, with no way to close it. Counted, it would kill every shortcut on
 *   the board with nothing on the screen. Where `checkVisibility` is missing (Safari
 *   before 17.4) a window counts as seen: the hidden sheet is the rare case.
 *
 * The guard goes INSIDE a handler, never around its registration: `phone.spec.ts`
 * holds the phone to the same number of listeners as the desktop.
 *
 * A window's own keys never ask this. A press that CLOSES a window is the one thing
 * it cannot see: the close lands in a microtask, before the next listener runs, so
 * that press has to be stopped by the window that took it.
 */
export function isWindowOpen(): boolean {
  return [...document.querySelectorAll('[aria-modal="true"]')].some(
    (el) => typeof el.checkVisibility !== 'function' || el.checkVisibility(),
  );
}

/** Which surface a binding belongs to, and the order groups are shown in. */
export const KEY_GROUPS = ['list', 'filters', 'search', 'overlays', 'pages'] as const;
export type KeyGroup = (typeof KEY_GROUPS)[number];

export interface Binding {
  /**
   * What the sheet prints. An array renders as separate caps: ['↑', '↓'].
   *
   * These are the KEY VALUES as `KeyboardEvent.key` reports them wherever a
   * handler matches on one, so the sheet and the handler cannot disagree
   * about `?` vs `/` on a US layout (§14.3).
   */
  keys: readonly string[];
  /** Imperative, and the verb the design brief uses where it gave one. */
  label: string;
  group: KeyGroup;
  /**
   * Where the binding is implemented. Not rendered — it is here so that a
   * reader of the sheet can find the behaviour, and so a deleted handler
   * leaves an obviously dangling reference.
   */
  owner: string;
  /** Bindings that are proposed by §14 but not yet built are marked. */
  planned?: true;
}

/**
 * The `2g` keymap plus §14's additions.
 *
 * `planned` entries appear in the sheet greyed, because a sheet that lists a
 * key which does nothing is worse than one that admits the key is coming. As
 * of §14 feature 10 there are none left — the field stays because the next
 * proposed binding will need it, and because the sheet's greyed branch is
 * asserted rather than hypothetical.
 */
export const KEYMAP: readonly Binding[] = [
  { keys: ['↑', '↓'], label: 'Move the selection', group: 'list', owner: 'Console' },
  { keys: ['Enter'], label: 'Open the selected truck', group: 'list', owner: 'Console' },
  {
    keys: ['Esc'],
    label: 'Clear the search, then the selection',
    group: 'list',
    owner: 'Console',
  },
  {
    keys: ['1', '–', '7'],
    label: 'Toggle a status filter',
    group: 'filters',
    owner: 'FilterChips',
  },
  { keys: ['8'], label: 'Drivers only — hide trucks with no driver and nothing waiting', group: 'filters', owner: 'FilterChips' },
  { keys: ['0'], label: 'Reset to All', group: 'filters', owner: 'FilterChips' },
  /** §12.91. Bound to nothing before; the scope button's menu. */
  { keys: ['V'], label: 'Open the list and view menu', group: 'filters', owner: 'ScopeMenu' },
  {
    keys: ['/'],
    label: 'Filter the list in place',
    group: 'search',
    owner: 'SearchField',
  },
  { keys: ['?'], label: 'Show this sheet', group: 'overlays', owner: 'ShortcutSheet' },
  {
    keys: ['⌘', 'K'],
    label: 'Jump to a truck, driver or view',
    group: 'overlays',
    owner: 'CommandPalette',
  },
  { keys: ['P'], label: 'Pin the selected truck', group: 'list', owner: 'usePinned' },
  { keys: ['X'], label: 'Check the selected row', group: 'list', owner: 'Console' },
  { keys: ['D'], label: 'Toggle row density', group: 'list', owner: 'ListToolbar' },
  /** §12.101. Two keys in turn, not together. Neither clashed with a binding. */
  { keys: ['G', 'H'], label: 'Open driver history', group: 'pages', owner: 'useGoKeys' },
  { keys: ['G', 'B'], label: 'Back to the board', group: 'pages', owner: 'useGoKeys' },
];

/** Group label as the sheet prints it. */
export const GROUP_LABEL: Record<KeyGroup, string> = {
  list: 'The list',
  filters: 'Filters',
  search: 'Search',
  overlays: 'Overlays',
  pages: 'Pages',
};

/** The bindings of one group, in declaration order. */
export function bindingsIn(group: KeyGroup): Binding[] {
  return KEYMAP.filter((b) => b.group === group);
}
