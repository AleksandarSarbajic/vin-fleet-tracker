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

/** Which surface a binding belongs to, and the order groups are shown in. */
export const KEY_GROUPS = ['list', 'filters', 'search', 'overlays'] as const;
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
 * The `2g` keymap plus §14's additions. `planned` entries appear in the sheet
 * greyed, because a sheet that lists a key which does nothing is worse than
 * one that admits the key is coming.
 */
export const KEYMAP: readonly Binding[] = [
  { keys: ['↑', '↓'], label: 'Move the selection', group: 'list', owner: 'Console' },
  { keys: ['Enter'], label: 'Open the selected truck', group: 'list', owner: 'Console' },
  { keys: ['E'], label: 'Edit the selected stop', group: 'list', owner: 'Console' },
  { keys: ['Esc'], label: 'Clear the search, then the selection', group: 'list', owner: 'Console' },
  { keys: ['1', '–', '7'], label: 'Toggle a status filter', group: 'filters', owner: 'FilterChips' },
  { keys: ['0'], label: 'Reset to All', group: 'filters', owner: 'FilterChips' },
  { keys: ['/'], label: 'Filter the list in place', group: 'search', owner: 'SearchField' },
  { keys: ['?'], label: 'Show this sheet', group: 'overlays', owner: 'ShortcutSheet' },
  { keys: ['⌘', 'K'], label: 'Jump to a truck, driver or view', group: 'overlays', owner: 'CommandPalette', planned: true },
  { keys: ['P'], label: 'Pin the selected truck', group: 'list', owner: 'FleetList', planned: true },
  { keys: ['X'], label: 'Check the selected row', group: 'list', owner: 'FleetList', planned: true },
  { keys: ['D'], label: 'Toggle row density', group: 'list', owner: 'FleetList', planned: true },
];

/** Group label as the sheet prints it. */
export const GROUP_LABEL: Record<KeyGroup, string> = {
  list: 'The list',
  filters: 'Filters',
  search: 'Search',
  overlays: 'Overlays',
};

/** The bindings of one group, in declaration order. */
export function bindingsIn(group: KeyGroup): Binding[] {
  return KEYMAP.filter((b) => b.group === group);
}
