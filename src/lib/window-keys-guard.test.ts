import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Board shortcuts behind a window (phase 3bc follow-up). `G H` left the edit window
 * with the typed work in it because its listener asked only whether the caret was in
 * a field, and nothing would have noticed the next listener doing the same.
 *
 * So every keydown listener on a window or a document is accounted for, one by one.
 * A listener answers for the board, and asks `isWindowOpen`, or it is on the short
 * list of what is left out and why. A new one, even in a file already here, fails.
 */
const ROOT = join(__dirname, '..');

/** How many listeners in each file answer for the board. Each asks the guard. */
const GUARDED: Record<string, number> = {
  'hooks/useGoKeys.ts': 1,
  'hooks/useDensity.ts': 1,
  'hooks/usePinned.ts': 1,
  'components/console/FilterChips.tsx': 1,
  'components/console/SearchField.tsx': 1,
  'components/console/SavedViews.tsx': 1, // V; its menu's Esc is below
  'components/console/Console.tsx': 2, // the arrows, Enter and Esc; X and the checks' Esc
  'components/assignments/AssignmentBoard.tsx': 2, // Cmd/Ctrl+Enter; /
  'components/history/HistoryPage.tsx': 1,
  'components/overlay/ShortcutSheet.tsx': 1, // ?, except that it closes its own sheet
  'components/overlay/CommandPalette.tsx': 1, // ⌘K, except that the layer gives way to it
};

const A_WINDOWS_OWN = "the window's own keys: registered only while it is open";
const A_MENUS_OWN = "the menu's own Esc: registered only while it is open, and a menu is no window";

/** What does not ask, and why. Short on purpose: a board shortcut has no place here. */
const LEFT_OUT: Record<string, { count: number; why: string }> = {
  'components/edit/useModalChrome.ts': { count: 1, why: "every window's Tab trap" },
  'components/edit/EditStopModal.tsx': { count: 2, why: A_WINDOWS_OWN },
  'components/edit/DiscardConfirm.tsx': { count: 1, why: A_WINDOWS_OWN },
  'components/edit/ClearStopConfirm.tsx': { count: 1, why: A_WINDOWS_OWN },
  'components/edit/ReopenConfirm.tsx': { count: 1, why: A_WINDOWS_OWN },
  'components/edit/PreviousLoadQuestion.tsx': { count: 1, why: A_WINDOWS_OWN },
  'components/edit/ReachedStopQuestion.tsx': { count: 1, why: A_WINDOWS_OWN },
  'components/overlay/OverlayLayer.tsx': { count: 1, why: A_WINDOWS_OWN },
  'components/console/BulkActionModal.tsx': { count: 1, why: A_WINDOWS_OWN },
  'components/console/AddToListModal.tsx': { count: 1, why: A_WINDOWS_OWN },
  'components/console/TruckListEditor.tsx': { count: 1, why: A_WINDOWS_OWN },
  'components/console/TruckTimeline.tsx': { count: 1, why: A_WINDOWS_OWN },
  'components/console/AccountMenu.tsx': { count: 1, why: A_MENUS_OWN },
  'components/console/SavedViews.tsx': { count: 1, why: A_MENUS_OWN },
  'components/history/HistoryToolbar.tsx': { count: 1, why: A_MENUS_OWN },
};

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });

/** `addEventListener('keydown'`, any quote, any spacing, and the old `onkeydown =`. */
const LISTENER =
  /\.addEventListener\(\s*['"`]key(?:down|press|up)['"`]|\.onkey(?:down|press|up)\s*=/g;

const sources = walk(ROOT).map((path) => ({
  file: relative(ROOT, path),
  source: readFileSync(path, 'utf8'),
}));
const count = (source: string, pattern: RegExp) => (source.match(pattern) ?? []).length;

describe('every keydown listener asks the window guard, or says why not', () => {
  it('finds them in every form it claims to', () => {
    for (const form of [
      "window.addEventListener('keydown', onKey)",
      'document.addEventListener("keydown", onKey, true)',
      "node.addEventListener(\n  'keyup',\n  onKey,\n)",
      'window.addEventListener(`keypress`, onKey)',
      'window.onkeydown = onKey',
    ]) {
      expect(count(form, LISTENER), form).toBe(1);
    }
    expect(count("window.addEventListener('resize', onMove)", LISTENER)).toBe(0);
  });

  it('accounts for each one, and a new one fails', () => {
    const found = Object.fromEntries(
      sources
        .map(({ file, source }) => [file, count(source, LISTENER)] as const)
        .filter(([, n]) => n > 0),
    );
    const named: Record<string, number> = {};
    for (const [file, n] of Object.entries(GUARDED)) named[file] = (named[file] ?? 0) + n;
    for (const [file, { count: n }] of Object.entries(LEFT_OUT)) {
      named[file] = (named[file] ?? 0) + n;
    }
    expect(found).toEqual(named);
  });

  for (const [file, n] of Object.entries(GUARDED)) {
    it(`${file}: ${n} listener${n === 1 ? '' : 's'}, and as many asks`, () => {
      const source = readFileSync(join(ROOT, file), 'utf8');
      expect(count(source, /\bisWindowOpen\(\)/g)).toBe(n);
    });
  }

  it('what is left out does not ask, and says why', () => {
    const onlyLeftOut = Object.keys(LEFT_OUT).filter((file) => !(file in GUARDED));
    for (const file of onlyLeftOut) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      expect(count(source, /\bisWindowOpen\(\)/g), file).toBe(0);
    }
    for (const [file, { why }] of Object.entries(LEFT_OUT)) expect(why, file).toBeTruthy();
  });

  it('there is one guard: nothing else reads aria-modal to decide about a key', () => {
    const readers = sources
      .filter(({ source }) => /querySelector(All)?\(\s*['"`]\[aria-modal/.test(source))
      .map(({ file }) => file);
    expect(readers).toEqual(['lib/keymap.ts']);
  });

  it('every window carries what the guard reads', () => {
    for (const { file, source } of sources) {
      if (file === 'components/overlay/DialogFrame.tsx') continue;
      const frames = count(source, /<DialogFrame\b/g);
      if (frames === 0) continue;
      const marks = count(source, /aria-modal="true"|'aria-modal': true/g);
      expect(marks, file).toBe(frames);
    }
  });
});
