// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  TOUR,
  TOUR_STORAGE_KEY,
  TOUR_VERSION,
  markTourSeen,
  shouldAutoOpen,
  stepKeys,
} from './tour';
import { KEYMAP } from './keymap';

/** §14 feature 12. */

describe('the steps', () => {
  it('has a title and a body on every one', () => {
    for (const step of TOUR) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);
    }
  });

  it('gives every step a distinct id', () => {
    expect(new Set(TOUR.map((s) => s.id)).size).toBe(TOUR.length);
  });

  /**
   * The anti-drift rule, and the reason the steps name keys as `KEYMAP`
   * spells them rather than writing them out. A tour that advertises a
   * binding the console does not have is the cheat-sheet problem again
   * (§14.1), with nobody watching.
   */
  it('names no key the console does not have', () => {
    for (const step of TOUR) {
      const declared = step.keys?.length ?? 0;
      expect(stepKeys(step)).toHaveLength(declared);
    }
  });

  it('names no key that is only planned', () => {
    for (const step of TOUR) {
      for (const keys of stepKeys(step)) {
        const binding = KEYMAP.find((b) => b.keys.join('') === keys.join(''));
        expect(binding?.planned).toBeUndefined();
      }
    }
  });

  it('resolves a key that was removed from the keymap to nothing', () => {
    // Proving the guard bites: a step naming a key that is not in KEYMAP
    // drops it, and the test above then fails on the count.
    expect(stepKeys({ id: 'x', title: 't', body: 'b', keys: [['Q']] })).toEqual([]);
  });
});

describe('when it opens on its own', () => {
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

  it('opens for someone who has never seen it', () => {
    expect(shouldAutoOpen()).toBe(true);
  });

  it('does not open again once it has been seen', () => {
    markTourSeen();
    expect(shouldAutoOpen()).toBe(false);
  });

  /** Versioned, not a boolean: a new step can show itself to an old user. */
  it('opens again when the tour has moved on', () => {
    store.set(TOUR_STORAGE_KEY, String(TOUR_VERSION - 1));
    expect(shouldAutoOpen()).toBe(true);
  });

  it('opens when the stored value is nonsense', () => {
    store.set(TOUR_STORAGE_KEY, 'yes please');
    expect(shouldAutoOpen()).toBe(true);
  });

  /**
   * The one that matters most. A tour that cannot record having been seen
   * would open on EVERY load — worse than never opening — and private
   * browsing, a blocked origin and a server render all land here.
   */
  it('does not open at all when storage is unavailable', () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('private browsing');
      },
    });
    expect(shouldAutoOpen()).toBe(false);
    expect(() => markTourSeen()).not.toThrow();
  });

  it('does not open when storage can be read but not written', () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error('quota');
        },
        removeItem: () => {},
        clear: () => {},
        key: () => null,
        length: 0,
      },
    });
    expect(shouldAutoOpen()).toBe(false);
  });
});
