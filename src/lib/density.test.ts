// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import config from '../../tailwind.config';
import {
  CHIP_HEIGHT,
  DENSITIES,
  DENSITY_STORAGE_KEY,
  ROW_HEIGHT,
  isDensity,
  nextDensity,
  readDensity,
  writeDensity,
} from './density';

/**
 * §14 feature 5.
 *
 * happy-dom runs without localStorage unless node is given
 * `--localstorage-file`, which is exactly the condition the reads are written
 * to survive — so the store is stubbed here rather than assumed, and one test
 * removes the stub again to check the unavailable path.
 */
const store = new Map<string, string>();
const stub = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as unknown as Storage;

beforeEach(() => {
  store.clear();
  Object.defineProperty(window, 'localStorage', {
    value: stub,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  store.clear();
  vi.restoreAllMocks();
});

describe('the density heights are the tokens, not a second copy', () => {
  it('matches spacing.row-* in the Tailwind config exactly', () => {
    // The failure this prevents: a component uses `h-row-compact` while the
    // virtualiser estimates something else, and scrollToIndex lands on the
    // wrong row — visible only when the list is long enough to scroll.
    const spacing = config.theme?.extend?.spacing as Record<string, string>;
    expect(spacing['row-comfortable']).toBe(`${ROW_HEIGHT.comfortable}px`);
    expect(spacing['row-compact']).toBe(`${ROW_HEIGHT.compact}px`);
    expect(spacing['chip-comfortable']).toBe(`${CHIP_HEIGHT.comfortable}px`);
    expect(spacing['chip-compact']).toBe(`${CHIP_HEIGHT.compact}px`);
  });

  it('is shorter when compact — the point of the feature', () => {
    // §14.5 measured it: 22 rows against 20 at 30 trucks.
    expect(ROW_HEIGHT.compact).toBeLessThan(ROW_HEIGHT.comfortable);
  });
});

describe('the stored preference', () => {
  it('defaults to comfortable when nothing is stored', () => {
    expect(readDensity()).toBe('comfortable');
  });

  it('round-trips a written value', () => {
    writeDensity('compact');
    expect(window.localStorage.getItem(DENSITY_STORAGE_KEY)).toBe('compact');
    expect(readDensity()).toBe('compact');
  });

  it('ignores a stored value that is not a density', () => {
    window.localStorage.setItem(DENSITY_STORAGE_KEY, 'enormous');
    expect(readDensity()).toBe('comfortable');
  });

  it('survives storage being unavailable, rather than taking the console down', () => {
    // Private browsing makes the accessor throw; this environment simply has
    // no localStorage at all. Both reach the same catch, and a forgotten row
    // height is a preference where an exception here is a blank console.
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('denied');
      },
      configurable: true,
    });
    expect(readDensity()).toBe('comfortable');
    expect(() => writeDensity('compact')).not.toThrow();
  });
});

describe('the toggle', () => {
  it('alternates, and only ever between the two declared densities', () => {
    expect(nextDensity('comfortable')).toBe('compact');
    expect(nextDensity('compact')).toBe('comfortable');
    for (const d of DENSITIES) expect(DENSITIES).toContain(nextDensity(d));
  });

  it('recognises exactly the declared densities', () => {
    for (const d of DENSITIES) expect(isDensity(d)).toBe(true);
    expect(isDensity('cosy')).toBe(false);
    expect(isDensity(null)).toBe(false);
  });
});
