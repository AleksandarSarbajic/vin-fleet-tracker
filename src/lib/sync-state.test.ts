import { describe, expect, it } from 'vitest';
import { NOT_UPDATING_AFTER_MS, RETURN_GRACE_MS, isNotUpdating, retryWaitSeconds } from './sync-state';

/** §12.123. When the board says it is not updating — with invented times. */

const T = 1_000_000_000_000;
const at = (lastSuccessAt: number, visible = true, visibleSince: number | null = null) => ({
  lastSuccessAt,
  visible,
  visibleSince,
});

describe('not updating', () => {
  it('after a minute with no successful poll, while the tab is visible', () => {
    expect(isNotUpdating(at(T), T + NOT_UPDATING_AFTER_MS)).toBe(false);
    expect(isNotUpdating(at(T), T + NOT_UPDATING_AFTER_MS + 1)).toBe(true);
    expect(isNotUpdating(at(T), T + 25 * 60_000)).toBe(true);
  });

  it('never while the tab is hidden: nobody is looking, and polling pauses by design', () => {
    expect(isNotUpdating(at(T, false), T + 30 * 60_000)).toBe(false);
  });

  it('not in the moments after the tab comes back, while the refetch on return lands', () => {
    const back = T + 30 * 60_000;
    expect(isNotUpdating(at(T, true, back), back + RETURN_GRACE_MS - 1)).toBe(false);
    expect(isNotUpdating(at(T, true, back), back + RETURN_GRACE_MS)).toBe(true);
  });

  it('is cleared by the next successful poll', () => {
    expect(isNotUpdating(at(T + 90_000), T + 95_000)).toBe(false);
  });
});

describe('Retry after a 429', () => {
  it('waits the seconds the server asked for, rounded up, then not at all', () => {
    expect(retryWaitSeconds({ retryBlockedUntil: null }, T)).toBe(0);
    expect(retryWaitSeconds({ retryBlockedUntil: T + 4_200 }, T)).toBe(5);
    expect(retryWaitSeconds({ retryBlockedUntil: T - 1 }, T)).toBe(0);
  });
});
