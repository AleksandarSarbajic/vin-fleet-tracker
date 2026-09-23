// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from './test-render';
import { useResortHold } from './useResortHold';
import { RESORT_HOLD_MS } from '@/lib/flash';

/** §14.5's re-sort hold, on the surface this console actually re-sorts from. */

interface Args {
  drift: number;
  pointerOver: boolean;
  checked: number;
}

const mount = (args: Args) => {
  const h = renderHook(
    (a: Args) => useResortHold(a.drift, a.pointerOver, a.checked),
    args,
  );
  return {
    held: () => h.current(),
    /**
     * `rerender` already wraps itself in `act`, and wrapping it in a second
     * one swallows the flush — the effect runs, the state updates, and the
     * probe never re-renders to see it. Cost an hour once; not again.
     */
    set: (a: Args) => h.rerender(a),
  };
};

const QUIET: Args = { drift: 0, pointerOver: false, checked: 0 };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('when the offer is withheld', () => {
  it('holds while the pointer is over the list', () => {
    const h = mount(QUIET);
    h.set({ drift: 3, pointerOver: true, checked: 0 });
    expect(h.held()).toBe(true);
  });

  it('holds while two or more rows are checked, pointer or not', () => {
    const h = mount(QUIET);
    h.set({ drift: 3, pointerOver: false, checked: 2 });
    expect(h.held()).toBe(true);
  });

  /** One checked row is not a bulk act in progress — §14.5 says 2+. */
  it('does not hold for a single checked row', () => {
    const h = mount(QUIET);
    h.set({ drift: 3, pointerOver: false, checked: 1 });
    expect(h.held()).toBe(false);
  });

  it('does not hold when there is nothing to offer', () => {
    const h = mount(QUIET);
    h.set({ drift: 0, pointerOver: true, checked: 4 });
    expect(h.held()).toBe(false);
  });
});

describe('when the hold ends', () => {
  it('ends the moment the pointer leaves', () => {
    const h = mount(QUIET);
    h.set({ drift: 3, pointerOver: true, checked: 0 });
    h.set({ drift: 3, pointerOver: false, checked: 0 });
    expect(h.held()).toBe(false);
  });

  it('ends after ten seconds even if nothing moves', () => {
    const h = mount(QUIET);
    h.set({ drift: 3, pointerOver: true, checked: 0 });
    expect(h.held()).toBe(true);
    act(() => void vi.advanceTimersByTime(RESORT_HOLD_MS));
    expect(h.held()).toBe(false);
  });

  /**
   * The bug this shape exists to prevent: the pointer leaves, the pill
   * appears, the pointer comes back to CLICK it, and the pill vanishes under
   * the cursor. That is a worse version of the defect the hold prevents.
   */
  it('does not hold again when the pointer returns', () => {
    const h = mount(QUIET);
    h.set({ drift: 3, pointerOver: true, checked: 0 });
    h.set({ drift: 3, pointerOver: false, checked: 0 });
    h.set({ drift: 3, pointerOver: true, checked: 0 });
    expect(h.held()).toBe(false);
  });

  /**
   * "Max 10s" has to mean ten seconds. The drift COUNT changes on most polls
   * of a moving fleet, and a timer keyed on the number instead of on
   * "there is drift" would restart with it and never fire.
   */
  it('does not restart the ten seconds when the drift count changes', () => {
    const h = mount(QUIET);
    h.set({ drift: 3, pointerOver: true, checked: 0 });
    act(() => void vi.advanceTimersByTime(RESORT_HOLD_MS - 1_000));
    h.set({ drift: 5, pointerOver: true, checked: 0 });
    h.set({ drift: 7, pointerOver: true, checked: 0 });
    act(() => void vi.advanceTimersByTime(1_000));
    expect(h.held()).toBe(false);
  });

  /** A fresh episode of drift gets a fresh hold. */
  it('holds again after the drift clears and returns', () => {
    const h = mount(QUIET);
    h.set({ drift: 3, pointerOver: true, checked: 0 });
    act(() => void vi.advanceTimersByTime(RESORT_HOLD_MS));
    h.set({ drift: 0, pointerOver: true, checked: 0 });
    h.set({ drift: 2, pointerOver: true, checked: 0 });
    expect(h.held()).toBe(true);
  });
});
