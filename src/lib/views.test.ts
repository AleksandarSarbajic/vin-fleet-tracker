// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  VIEW_CAP,
  VIEW_NAME_MAX,
  VIEW_STORAGE_KEY,
  activeView,
  addView,
  normalizeName,
  readViews,
  removeView,
  renameView,
  sameView,
  writeViews,
  type SavedView,
} from './views';

/** §14 feature 11. */

const CHIPS = ['late', 'risk', 'ontime', 'tomorrow', 'arrived', 'issues', 'inactive'];

const view = (over: Partial<SavedView> = {}): SavedView => ({
  id: 'v1',
  name: 'Late today',
  query: '',
  chips: ['late'],
  ...over,
});

const save = (views: SavedView[], name: string, state = { query: '', chips: ['late'] }) =>
  addView(views, { name, state, id: `id-${views.length}` });

describe('what a view is', () => {
  it('is the same view however the chips were clicked together', () => {
    expect(
      sameView(
        { query: '', chips: ['risk', 'late'] },
        { query: '', chips: ['late', 'risk'] },
      ),
    ).toBe(true);
  });

  it('is not the same view with a different search', () => {
    expect(sameView({ query: 'joliet', chips: [] }, { query: '', chips: [] })).toBe(
      false,
    );
  });

  /** The field is debounced and trimmed everywhere else; it is here too. */
  it('ignores whitespace around the search term', () => {
    expect(
      sameView({ query: ' joliet ', chips: [] }, { query: 'joliet', chips: [] }),
    ).toBe(true);
  });

  it('knows which saved view the board is showing', () => {
    const views = [
      view({ id: 'a', chips: ['late'] }),
      view({ id: 'b', chips: ['risk'] }),
    ];
    expect(activeView(views, { query: '', chips: ['risk'] })?.id).toBe('b');
    expect(activeView(views, { query: '', chips: ['arrived'] })).toBeNull();
  });
});

describe('names', () => {
  it('collapses whitespace so two spellings of one name are one name', () => {
    expect(normalizeName('  Late   today  ')).toBe('Late today');
  });

  it('caps the length rather than letting a name break the menu', () => {
    expect(normalizeName('x'.repeat(200))).toHaveLength(VIEW_NAME_MAX);
  });

  it('refuses a name that is only whitespace', () => {
    expect(save([], '   ').refused).toBe('empty-name');
  });

  /**
   * Same ruling as the pin cap. A saved view replaced without a word is a
   * thing someone deliberately made, gone — and unlike a pin it took typing.
   */
  it('refuses a duplicate name rather than overwriting it', () => {
    const first = save([], 'Late today').views;
    const second = save(first, 'LATE  TODAY');
    expect(second.refused).toBe('duplicate-name');
    expect(second.views).toHaveLength(1);
  });
});

describe('renaming (§12.81)', () => {
  const two = () => {
    let views: SavedView[] = [];
    views = save(views, 'Late today').views;
    return save(views, 'On time').views;
  };

  it('renames one view and nothing else', () => {
    const views = two();
    const out = renameView(views, views[0]!.id, '  Late   this morning ');
    expect(out.refused).toBeNull();
    expect(out.views.map((v) => v.name)).toEqual(['Late this morning', 'On time']);
    expect(out.views[0]!.chips).toEqual(views[0]!.chips);
  });

  it('refuses another view’s name, in any case', () => {
    const views = two();
    expect(renameView(views, views[1]!.id, 'LATE TODAY').refused).toBe('duplicate-name');
  });

  it('allows its own name in different case — a correction, not a collision', () => {
    const views = two();
    expect(renameView(views, views[0]!.id, 'late TODAY').refused).toBeNull();
  });

  it('refuses an empty name', () => {
    const views = two();
    expect(renameView(views, views[0]!.id, '   ').refused).toBe('empty-name');
  });
});

describe('the cap', () => {
  it('refuses one past the cap rather than dropping the first', () => {
    let views: SavedView[] = [];
    for (let i = 0; i < VIEW_CAP; i += 1) views = save(views, `View ${i}`).views;
    const result = save(views, 'One more');
    expect(result.refused).toBe('cap');
    expect(result.views).toHaveLength(VIEW_CAP);
    expect(result.views[0]?.name).toBe('View 0');
  });

  it('lets a new one in once something is deleted', () => {
    let views: SavedView[] = [];
    for (let i = 0; i < VIEW_CAP; i += 1) views = save(views, `View ${i}`).views;
    const after = removeView(views, views[3]!.id);
    expect(save(after, 'One more').refused).toBeNull();
  });
});

describe('storage', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
        key: () => null,
        length: 0,
      },
    });
  });

  afterEach(() => store.clear());

  it('round-trips', () => {
    writeViews([view()]);
    expect(readViews(CHIPS)).toEqual([view()]);
  });

  it('is empty before anything is saved', () => {
    expect(readViews(CHIPS)).toEqual([]);
  });

  /**
   * The load-bearing one. `passesFilters` indexes a record by the chip key,
   * so ONE junk chip from a hand-edited localStorage throws inside a render
   * and the console shows an error boundary instead of a fleet.
   */
  it('drops a chip that is not a filter any more', () => {
    store.set(
      VIEW_STORAGE_KEY,
      JSON.stringify([{ id: 'v1', name: 'Old', query: '', chips: ['late', 'unicorn'] }]),
    );
    expect(readViews(CHIPS)[0]?.chips).toEqual(['late']);
  });

  it('drops an entry that is not a view at all', () => {
    store.set(VIEW_STORAGE_KEY, JSON.stringify([null, 42, { id: 'v', name: 'Keep me' }]));
    const views = readViews(CHIPS);
    expect(views).toHaveLength(1);
    expect(views[0]?.name).toBe('Keep me');
    // The missing fields come back as their quietest values, not undefined.
    expect(views[0]?.query).toBe('');
    expect(views[0]?.chips).toEqual([]);
  });

  it('survives a stored value that is not JSON', () => {
    store.set(VIEW_STORAGE_KEY, '{oh dear');
    expect(readViews(CHIPS)).toEqual([]);
  });

  it('enforces the cap on read as well as on write', () => {
    const tooMany = Array.from({ length: VIEW_CAP + 4 }, (_, i) =>
      view({ id: `v${i}`, name: `View ${i}` }),
    );
    store.set(VIEW_STORAGE_KEY, JSON.stringify(tooMany));
    expect(readViews(CHIPS)).toHaveLength(VIEW_CAP);
  });

  it('does not throw when storage is unavailable', () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('private browsing');
      },
    });
    expect(() => readViews(CHIPS)).not.toThrow();
    expect(readViews(CHIPS)).toEqual([]);
    expect(() => writeViews([view()])).not.toThrow();
  });
});
