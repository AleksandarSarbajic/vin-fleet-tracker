// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { PIN_CAP, PIN_STORAGE_KEY, readPinned, togglePin, writePinned } from './pinned';

/** §14 feature 4. */

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage,
    configurable: true,
  });
});

describe('the pin list', () => {
  it('adds and removes', () => {
    expect(togglePin([], 'a').ids).toEqual(['a']);
    expect(togglePin(['a', 'b'], 'a').ids).toEqual(['b']);
  });

  it('keeps pin order, because the block is not re-sorted (5b)', () => {
    let ids: string[] = [];
    for (const id of ['c', 'a', 'b']) ids = togglePin(ids, id).ids;
    expect(ids).toEqual(['c', 'a', 'b']);
  });

  it('refuses a sixth rather than evicting the oldest', () => {
    /*
     * Evicting would look friendlier and lose a truck the dispatcher was
     * deliberately watching — the precise failure pinning exists to prevent.
     */
    const full = ['a', 'b', 'c', 'd', 'e'];
    expect(full).toHaveLength(PIN_CAP);
    const result = togglePin(full, 'f');
    expect(result.refused).toBe('cap');
    expect(result.ids).toEqual(full);
  });

  it('still unpins when full, so the cap is never a trap', () => {
    const result = togglePin(['a', 'b', 'c', 'd', 'e'], 'c');
    expect(result.refused).toBeNull();
    expect(result.ids).toEqual(['a', 'b', 'd', 'e']);
  });
});

describe('storage', () => {
  it('round-trips', () => {
    writePinned(['x', 'y']);
    expect(readPinned()).toEqual(['x', 'y']);
  });

  it('returns nothing when there is nothing', () => {
    expect(readPinned()).toEqual([]);
  });

  it('survives a corrupted value rather than throwing', () => {
    window.localStorage.setItem(PIN_STORAGE_KEY, '{not json');
    expect(readPinned()).toEqual([]);
    window.localStorage.setItem(PIN_STORAGE_KEY, '"a string"');
    expect(readPinned()).toEqual([]);
    window.localStorage.setItem(PIN_STORAGE_KEY, '[1, 2, "c"]');
    expect(readPinned()).toEqual(['c']);
  });

  it('caps what it reads, not only what it writes', () => {
    // A cap enforced on the way in only is a cap a stale key defeats.
    window.localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(['a','b','c','d','e','f','g']));
    expect(readPinned()).toHaveLength(PIN_CAP);
  });

  it('survives storage being unavailable', () => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('denied');
      },
      configurable: true,
    });
    expect(readPinned()).toEqual([]);
    expect(() => writePinned(['a'])).not.toThrow();
  });
});
