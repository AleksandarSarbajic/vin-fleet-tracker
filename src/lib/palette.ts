import type { Searchable } from './search';
import { filterRows } from './search';
import type { SavedView } from './views';

/**
 * §14 feature 10 — what the command palette can do, and what it may not.
 *
 * §14.3 drew the line before anything was built:
 *
 * > **⌘K is navigation plus view-only actions** — pin, density, apply a saved
 * > view, open shortcuts. **No status writes**: a write from the palette would
 * > skip the reason and expiry form.
 *
 * That is a rule about the CATALOGUE, so it is enforced where the catalogue is
 * built rather than by remembering it at each call site. `Command` carries no
 * way to express a write: every entry is a `kind` from a closed set, and
 * adding a writing one means adding a kind and failing the test below it.
 *
 * §14.5 splits the two text boxes by verb: `/` filters the list in place,
 * `⌘K` **jumps and closes**. Both use `filterRows`, so they can never disagree
 * about what "matches" means — only about what happens next.
 */

export type CommandKind = 'truck' | 'view' | 'action';

export interface Command {
  id: string;
  kind: CommandKind;
  /** What the row prints. */
  label: string;
  /** The second line: why this row is here, or what the action will do. */
  detail: string;
  /** Extra text the query is matched against but which is not printed. */
  terms?: string;
}

export const KIND_LABEL: Record<CommandKind, string> = {
  truck: 'Trucks',
  view: 'Saved views',
  action: 'Actions',
};

/** The order sections appear in. Trucks first: it is a jump box before it is a menu. */
export const KIND_ORDER: readonly CommandKind[] = ['truck', 'view', 'action'] as const;

export interface PaletteTruck extends Searchable {
  id: string;
}

export interface PaletteInput<T extends PaletteTruck> {
  query: string;
  trucks: T[];
  views: readonly SavedView[];
  /**
   * The view-only actions available right now. Built by the caller, because
   * whether "Unpin" or "Pin" is offered depends on state the palette does not
   * own — but every one of them is still a `kind: 'action'` and therefore
   * still bound by the no-writes rule.
   */
  actions: Command[];
  /** How many rows to show per section, so one section cannot fill the list. */
  perSection?: number;
}

export const PER_SECTION = 6;

/**
 * The commands matching a query, grouped and capped.
 *
 * Trucks are matched with `filterRows` — the list's own matcher — and views
 * and actions by a plain substring on what they print plus their hidden
 * terms. Two matchers because they are two kinds of thing: a truck is matched
 * on five fields a dispatcher might type, and "Toggle row density" is matched
 * on the words it says.
 */
export function paletteCommands<T extends PaletteTruck>(
  input: PaletteInput<T>,
): Command[] {
  const { query, trucks, views, actions } = input;
  const cap = input.perSection ?? PER_SECTION;
  const needle = query.trim().toLowerCase();

  const truckCommands: Command[] = filterRows(trucks, query)
    .slice(0, cap)
    .map((truck) => ({
      id: `truck:${truck.id}`,
      kind: 'truck',
      label:
        truck.truckNumber === null ? truck.samsaraName : `Truck ${truck.truckNumber}`,
      detail:
        [truck.driverName, truck.cityState].filter(Boolean).join(' · ') || 'No driver',
    }));

  const hit = (command: Command) =>
    needle === '' ||
    `${command.label} ${command.detail} ${command.terms ?? ''}`
      .toLowerCase()
      .includes(needle);

  const viewCommands: Command[] = views
    .map((view): Command => ({
      id: `view:${view.id}`,
      kind: 'view',
      label: view.name,
      detail:
        [view.chips.join(', '), view.query && `“${view.query}”`]
          .filter(Boolean)
          .join(' · ') || 'The whole active fleet',
      terms: 'view filter saved',
    }))
    .filter(hit)
    .slice(0, cap);

  const actionCommands = actions.filter(hit).slice(0, cap);

  /**
   * Nothing typed means the palette opens as a MENU rather than as an empty
   * box: the saved views and the actions, and no trucks. Listing six
   * arbitrary trucks on open would suggest the first one is a suggestion.
   */
  if (needle === '') return [...viewCommands, ...actionCommands];

  return [...truckCommands, ...viewCommands, ...actionCommands];
}

/** The commands of one kind, in order — what the list renders per heading. */
export function sectionsOf(commands: readonly Command[]): {
  kind: CommandKind;
  commands: Command[];
}[] {
  return KIND_ORDER.map((kind) => ({
    kind,
    commands: commands.filter((c) => c.kind === kind),
  })).filter((section) => section.commands.length > 0);
}

/**
 * The next index for ↑/↓, wrapping at both ends.
 *
 * Wrapping because the list is short and capped: from the last row, ↓ to the
 * first is what a dispatcher means, and a cursor that stops dead at the end
 * of six rows reads as the palette having frozen.
 */
export function moveCursor(current: number, delta: number, length: number): number {
  if (length === 0) return 0;
  return (current + delta + length) % length;
}

/** The ids the palette's own actions use. Matched on, never parsed apart. */
export const ACTION = {
  pin: 'action:pin',
  density: 'action:density',
  shortcuts: 'action:shortcuts',
} as const;

export type ActionId = (typeof ACTION)[keyof typeof ACTION];

/**
 * §14.3's action list, in full and with nothing else in it:
 *
 * > pin, density, apply a saved view, open shortcuts.
 *
 * "Apply a saved view" is the `view` kind above, so three remain here. The
 * list is built rather than written inline so the no-writes rule has
 * something to be asserted against — a test can read this and check that
 * every entry is navigation or display, which it cannot do against JSX.
 *
 * Nothing here is added beyond the four §14.3 named. "Clear the filters" and
 * "Open the selected stop" were both obvious candidates and both left out:
 * the first is `0` and a saved view away, and the second opens a form that
 * writes, which is the line the rule draws.
 */
export function viewOnlyActions(state: {
  /** How the selected truck prints, or null when nothing is selected. */
  selectedLabel: string | null;
  pinned: boolean;
  density: 'comfortable' | 'compact';
}): Command[] {
  const out: Command[] = [];

  if (state.selectedLabel !== null) {
    out.push({
      id: ACTION.pin,
      kind: 'action',
      label: state.pinned ? `Unpin ${state.selectedLabel}` : `Pin ${state.selectedLabel}`,
      detail: 'Keeps it in the block above the list · P',
      terms: 'pin unpin watch',
    });
  }

  out.push({
    id: ACTION.density,
    kind: 'action',
    // Names what it will BECOME, not what it is. A menu entry that reads
    // "Comfortable" while the board is comfortable is a label, not a command.
    label:
      state.density === 'comfortable'
        ? 'Switch to compact rows'
        : 'Switch to comfortable rows',
    detail: 'Row height · D',
    terms: 'density rows compact comfortable spacing',
  });

  out.push({
    id: ACTION.shortcuts,
    kind: 'action',
    label: 'Show keyboard shortcuts',
    detail: 'Every binding the console has · ?',
    terms: 'keys keyboard help cheat sheet',
  });

  return out;
}
