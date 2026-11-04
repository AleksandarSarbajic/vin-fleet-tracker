import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * §12.148. A window or a menu drawn by hand opens with no motion and leaves no
 * copy, and nothing else would notice. Each file names its frames here, and any
 * other full-screen scrim has to be on the short list of what was left out.
 */
const ROOT = join(__dirname, '..');

const WINDOWS: Record<string, number> = {
  'edit/EditStopModal.tsx': 2, // reading panel, editor
  'edit/DiscardConfirm.tsx': 1,
  'edit/ClearStopConfirm.tsx': 1,
  'edit/ReassignConfirm.tsx': 1,
  'edit/ReopenConfirm.tsx': 1,
  'edit/PreviousLoadQuestion.tsx': 1,
  'edit/ReachedStopQuestion.tsx': 1,
  'overlay/OverlayLayer.tsx': 1, // palette, shortcut sheet, tour
  'console/BulkActionModal.tsx': 1,
  'console/AddToListModal.tsx': 1,
  'console/phone/TruckSheet.tsx': 1,
  'console/phone/PhoneMoreSheet.tsx': 1,
};

const MENUS: Record<string, number> = {
  'console/AccountMenu.tsx': 1,
  'console/SavedViews.tsx': 1,
  'assignments/DriverSelect.tsx': 1,
  'history/HistoryToolbar.tsx': 1,
};

/** Not in Alex's list for phase 3bb: they still open and close at once. */
const LEFT_OUT = [
  'console/TruckListEditor.tsx',
  'console/TruckTimeline.tsx',
  'history/PhoneHistory.tsx',
];

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });

describe('every window and menu draws through its frame (§12.148)', () => {
  for (const [file, count] of Object.entries(WINDOWS)) {
    it(`${file}: ${count} window frame${count === 1 ? '' : 's'}, and no scrim of its own`, () => {
      const source = readFileSync(join(ROOT, file), 'utf8');
      expect(source.match(/<DialogFrame\b/g) ?? []).toHaveLength(count);
      expect(source).not.toMatch(/<div[^>]*\bbg-scrim(Overlay)?\b/);
    });
  }

  for (const [file, count] of Object.entries(MENUS)) {
    it(`${file}: ${count} menu frame${count === 1 ? '' : 's'}`, () => {
      const source = readFileSync(join(ROOT, file), 'utf8');
      expect(source.match(/<PopFrame\b/g) ?? []).toHaveLength(count);
    });
  }

  it('the only full-screen scrims not on a frame are the ones left out on purpose', () => {
    const drawnByHand = walk(ROOT)
      .filter((path) => {
        const source = readFileSync(path, 'utf8');
        return /fixed inset-0/.test(source) && !/<DialogFrame\b/.test(source);
      })
      .map((path) => relative(ROOT, path))
      .filter((path) => !path.startsWith('overlay/DialogFrame'))
      .sort();
    expect(drawnByHand).toEqual([...LEFT_OUT].sort());
  });

  it('the Discard confirm says what it is', () => {
    const discard = readFileSync(join(ROOT, 'edit/DiscardConfirm.tsx'), 'utf8');
    expect(discard).toMatch(/role="dialog"/);
    expect(discard).toMatch(/aria-modal="true"/);
    expect(discard).toMatch(/aria-label="Discard changes\?"/);
  });
});
