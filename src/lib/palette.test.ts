import { describe, expect, it } from 'vitest';
import {
  ACTION,
  KIND_ORDER,
  PER_SECTION,
  moveCursor,
  paletteCommands,
  sectionsOf,
  viewOnlyActions,
  type Command,
  type PaletteTruck,
} from './palette';
import type { SavedView } from './views';

/** §14 feature 10. */

const truck = (
  id: string,
  number: number,
  driver: string,
  city: string,
): PaletteTruck => ({
  id,
  truckNumber: number,
  samsaraName: `Truck #${number}`,
  driverName: driver,
  cityState: city,
  nextStop: null,
  formattedLocation: null,
});

const TRUCKS = [
  truck('t1', 101, 'M. Kowalczyk', 'Joliet, IL'),
  truck('t2', 202, 'R. Alvarez', 'Fargo, ND'),
  truck('t3', 303, 'P. Osei', 'Joliet, IL'),
];

const VIEWS: SavedView[] = [
  { id: 'v1', name: 'Late today', query: '', chips: ['late'] },
  { id: 'v2', name: 'Joliet runs', query: 'joliet', chips: [] },
];

const ACTIONS = viewOnlyActions({
  selectedLabel: 'Truck 101',
  pinned: false,
  density: 'comfortable',
});

const run = (query: string, over: Partial<Parameters<typeof paletteCommands>[0]> = {}) =>
  paletteCommands({ query, trucks: TRUCKS, views: VIEWS, actions: ACTIONS, ...over });

const kinds = (commands: Command[]) => [...new Set(commands.map((c) => c.kind))];

describe('the no-writes rule (§14.3)', () => {
  /**
   * > **⌘K is navigation plus view-only actions** — pin, density, apply a
   * > saved view, open shortcuts. **No status writes**: a write from the
   * > palette would skip the reason and expiry form.
   *
   * Enforced where the catalogue is built, so adding a writing command means
   * adding an `ACTION` entry and failing here — rather than remembering the
   * rule at a call site.
   */
  it('offers exactly the three actions §14.3 names, and no more', () => {
    expect(Object.values(ACTION).sort()).toEqual(
      [ACTION.pin, ACTION.density, ACTION.shortcuts].sort(),
    );
    const ids = viewOnlyActions({
      selectedLabel: 'Truck 101',
      pinned: false,
      density: 'comfortable',
    }).map((a) => a.id);
    for (const id of ids) expect(Object.values(ACTION)).toContain(id);
  });

  it('has no kind that could carry a write', () => {
    expect([...KIND_ORDER].sort()).toEqual(['action', 'truck', 'view']);
  });

  it('offers no pin action while nothing is selected', () => {
    const ids = viewOnlyActions({
      selectedLabel: null,
      pinned: false,
      density: 'compact',
    }).map((a) => a.id);
    expect(ids).not.toContain(ACTION.pin);
  });

  /** A menu entry reading "Comfortable" on a comfortable board is a label. */
  it('names what the density action will do, not what the board is', () => {
    const comfortable = viewOnlyActions({
      selectedLabel: null,
      pinned: false,
      density: 'comfortable',
    });
    expect(comfortable[0]?.label).toContain('compact');
    const compact = viewOnlyActions({
      selectedLabel: null,
      pinned: false,
      density: 'compact',
    });
    expect(compact[0]?.label).toContain('comfortable');
  });

  it('says unpin when the selected truck is already pinned', () => {
    const pinned = viewOnlyActions({
      selectedLabel: 'Truck 101',
      pinned: true,
      density: 'compact',
    });
    expect(pinned[0]?.label).toBe('Unpin Truck 101');
  });
});

describe('with nothing typed', () => {
  /**
   * It opens as a MENU, not as an empty box. Six arbitrary trucks on open
   * would suggest the first one is a suggestion.
   */
  it('lists views and actions, and no trucks', () => {
    expect(kinds(run(''))).toEqual(['view', 'action']);
  });
});

describe('matching', () => {
  it('finds trucks the way the list does', () => {
    // `filterRows` is the list's own matcher, so the two boxes can never
    // disagree about what "matches" — only about what happens next (§14.5).
    const found = run('joliet').filter((c) => c.kind === 'truck');
    expect(found.map((c) => c.label).sort()).toEqual(['Truck 101', 'Truck 303']);
  });

  it('finds a truck by its driver', () => {
    expect(run('alvarez').some((c) => c.label === 'Truck 202')).toBe(true);
  });

  it('finds a saved view by name', () => {
    expect(run('late').some((c) => c.id === 'view:v1')).toBe(true);
  });

  it('finds an action by a word it does not print', () => {
    // "spacing" is in `terms`, not in the label — the words a person reaches
    // for are not always the words the row shows.
    expect(run('spacing').some((c) => c.id === ACTION.density)).toBe(true);
  });

  it('says nothing matches rather than falling back to everything', () => {
    expect(run('zzzzz')).toEqual([]);
  });
});

describe('the shape of the list', () => {
  it('caps each section so one cannot fill the palette', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      truck(`x${i}`, 900 + i, 'Driver', 'Joliet, IL'),
    );
    const found = run('joliet', { trucks: many }).filter((c) => c.kind === 'truck');
    expect(found).toHaveLength(PER_SECTION);
  });

  /**
   * Asserted on a jumbled list rather than on a query, because no realistic
   * query hits all three kinds — and a test that happened to find one would
   * be asserting the query as much as the grouping.
   */
  it('groups in a fixed order, trucks first, whatever order it is given', () => {
    const jumbled: Command[] = [
      { id: 'a', kind: 'action', label: 'A', detail: '' },
      { id: 'v', kind: 'view', label: 'V', detail: '' },
      { id: 't', kind: 'truck', label: 'T', detail: '' },
    ];
    expect(sectionsOf(jumbled).map((s) => s.kind)).toEqual(['truck', 'view', 'action']);
  });

  it('leaves out a section that matched nothing', () => {
    expect(sectionsOf(run('alvarez')).map((s) => s.kind)).toEqual(['truck']);
  });
});

describe('the cursor', () => {
  it('wraps at both ends, because six rows that stop dead read as frozen', () => {
    expect(moveCursor(2, 1, 3)).toBe(0);
    expect(moveCursor(0, -1, 3)).toBe(2);
  });

  it('stays at zero on an empty list', () => {
    expect(moveCursor(0, 1, 0)).toBe(0);
  });
});
