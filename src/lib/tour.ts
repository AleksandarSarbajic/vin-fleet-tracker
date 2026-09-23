import { KEYMAP } from './keymap';

/**
 * §14 feature 12 — the onboarding tour. **Interpretation**: turn 5 listed it
 * and drew no screen.
 *
 * ## Why it is a panel and not a spotlight
 *
 * §14.5 put the tour on the shared overlay layer: *"Palette, cheat sheet and
 * tour share one scrim and one layer, only one open at a time."* A tour that
 * cuts a hole in the scrim to point at a control cannot share a scrim — it
 * needs its own geometry, measured against whichever element it is pointing
 * at, and the moment it has that it is a second layer wearing the first
 * one's name. The ruling chooses for us: it is a stepped panel that NAMES the
 * surfaces rather than a cutout that points at them.
 *
 * There is a second reason, and it is the stronger one. A spotlight has to
 * know where a control is, so every step becomes a ref into a component and
 * the tour breaks silently when that component moves. This breaks loudly
 * instead: every key a step names is looked up in `KEYMAP`, and a step that
 * names a key the console does not have fails a test.
 *
 * ## Why it is versioned rather than a boolean
 *
 * "Has seen the tour" is the wrong question once the tour changes. The stored
 * value is the version last completed, so adding a step to explain a new
 * feature can show it again — and the person who has seen v2 is not shown v1
 * a second time by accident.
 */

export const TOUR_STORAGE_KEY = 'ft.tour.seen';

/**
 * Bump when a step is added that an existing user needs to see. Leave it
 * alone for wording changes — reopening a tour to fix a typo is how people
 * learn to dismiss it without reading.
 */
export const TOUR_VERSION = 1;

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /**
   * Keys this step names, as `KEYMAP` spells them. Looked up rather than
   * written out, so a step cannot advertise a binding the console does not
   * have — the same argument that made the cheat sheet render from the
   * registry (§14.1).
   */
  keys?: readonly string[][];
}

export const TOUR: readonly TourStep[] = [
  {
    id: 'list',
    title: 'The list is sorted by urgency',
    body: 'Problems first, and it does not re-sort while you are looking at it. When new data would change the order, a bar offers the new one — nothing moves under your cursor until you ask.',
    keys: [['↑', '↓'], ['Enter']],
  },
  {
    id: 'filter',
    title: 'Two boxes, two verbs',
    body: 'The chips and the search field narrow the list in place. ⌘K does the opposite — it jumps to a truck, a saved view or an action and closes. Filter what you are watching; jump to what you are not.',
    keys: [['/'], ['⌘', 'K'], ['0']],
  },
  {
    id: 'row',
    title: 'Everything about a truck is on its row',
    body: 'Open a stop to edit it, pin a truck to keep it above the list, or check several and act on them together. Hovering a row shows controls for copying the address or the load details.',
    keys: [['E'], ['P'], ['X'], ['D']],
  },
  {
    id: 'map',
    title: 'The map and the list are one selection',
    body: 'Clicking a marker selects its row and clicking a row moves the map. The selected truck draws its last half hour as a trail, and its popup opens a read-only timeline of what has happened to it.',
  },
  {
    id: 'trust',
    title: 'When the board stops being trustworthy, it says so',
    body: 'If the vehicle feed goes quiet, every row loses its schedule colour and a banner says since when. Appointment times stay at full strength — they come from our own records, not from the feed.',
  },
  {
    id: 'shortcuts',
    title: 'That is the tour',
    body: 'The shortcut sheet lists every key the console has, and it is generated from the console itself — so it can never describe a key that does not work.',
    keys: [['?']],
  },
];

/**
 * Whether the tour should open on its own.
 *
 * **Not when storage is unavailable.** A tour that cannot record having been
 * seen would open on every single load, which is worse than never opening —
 * and private browsing, a blocked origin and a server render all land here.
 * The sheet still offers it, so it is never unreachable.
 */
export function shouldAutoOpen(): boolean {
  try {
    const raw = window.localStorage.getItem(TOUR_STORAGE_KEY);
    // A probe, because reading a missing key succeeds in environments where
    // writing one does not.
    window.localStorage.setItem(TOUR_STORAGE_KEY, raw ?? '0');
    if (raw === null) return true;
    const seen = Number.parseInt(raw, 10);
    return Number.isFinite(seen) ? seen < TOUR_VERSION : true;
  } catch {
    return false;
  }
}

export function markTourSeen(): void {
  try {
    window.localStorage.setItem(TOUR_STORAGE_KEY, String(TOUR_VERSION));
  } catch {
    // It will offer itself again next time. Nothing else is lost.
  }
}

/** The caps a step prints, resolved against the keymap. */
export function stepKeys(step: TourStep): string[][] {
  if (!step.keys) return [];
  return step.keys.flatMap((keys) => {
    const binding = KEYMAP.find(
      (b) => b.keys.length === keys.length && b.keys.every((k, i) => k === keys[i]),
    );
    // A step may not advertise a key the console does not have. Dropping it
    // silently would be the drift this lookup exists to prevent, so the test
    // beside this asserts every step resolves.
    return binding && !binding.planned ? [[...binding.keys]] : [];
  });
}
