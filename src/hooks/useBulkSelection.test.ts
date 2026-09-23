// @vitest-environment happy-dom
import { act, renderHook } from './test-render';
import { describe, expect, it } from 'vitest';
import { useBulkSelection } from './useBulkSelection';

/** §14 feature 2. */

const IDS = ['a', 'b', 'c', 'd', 'e'];

describe('bulk selection (§14.3)', () => {
  it('checks and unchecks one row', () => {
    const h = renderHook(() => useBulkSelection(IDS));
    act(() => h.current().toggle('b'));
    expect([...h.current().checked]).toEqual(['b']);
    act(() => h.current().toggle('b'));
    expect(h.current().count).toBe(0);
  });

  it('extends a range from the last checkbox touched', () => {
    const h = renderHook(() => useBulkSelection(IDS));
    act(() => h.current().toggle('b'));
    act(() => h.current().toggle('d', true));
    expect([...h.current().checked].sort()).toEqual(['b', 'c', 'd']);
  });

  it('extends backwards too', () => {
    const h = renderHook(() => useBulkSelection(IDS));
    act(() => h.current().toggle('d'));
    act(() => h.current().toggle('b', true));
    expect([...h.current().checked].sort()).toEqual(['b', 'c', 'd']);
  });

  it('a shift-click that unchecks unchecks that span, not the whole list', () => {
    /*
     * The gesture takes the state the CLICKED end is moving to, and it
     * applies over the range from the ANCHOR — which after the first
     * shift-click is `e`, not `a`.
     *
     * The first draft of this test expected everything to clear. That would
     * mean a shift-click reaching back past the anchor to wherever the
     * selection began, which is a different and much less predictable
     * gesture: the user would have to remember a row they touched two
     * actions ago to know what the next click will do.
     */
    const h = renderHook(() => useBulkSelection(IDS));
    act(() => h.current().toggle('a'));
    act(() => h.current().toggle('e', true));
    expect(h.current().count).toBe(5);
    act(() => h.current().toggle('c', true));
    expect([...h.current().checked].sort()).toEqual(['a', 'b']);
  });

  it('moves the anchor to the end of the last range', () => {
    const h = renderHook(() => useBulkSelection(IDS));
    act(() => h.current().toggle('a'));
    act(() => h.current().toggle('b', true));
    // Anchor is now b, so a shift from here covers b..d, not a..d.
    act(() => h.current().toggle('d', true));
    expect([...h.current().checked].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('shift with no anchor behaves as a plain check', () => {
    const h = renderHook(() => useBulkSelection(IDS));
    act(() => h.current().toggle('c', true));
    expect([...h.current().checked]).toEqual(['c']);
  });

  it('drops checks for rows that have left the list', () => {
    // A filter change, a delivered load, a truck going inactive. A checked id
    // nobody can see would keep the bar open over a selection that is not
    // on screen.
    const h = renderHook((ids: string[]) => useBulkSelection(ids), IDS);
    act(() => h.current().toggle('a'));
    act(() => h.current().toggle('e'));
    expect(h.current().count).toBe(2);
    h.rerender(['a', 'b', 'c']);
    expect([...h.current().checked]).toEqual(['a']);
  });

  it('opens the bar at two, not one (§14.5)', () => {
    const h = renderHook(() => useBulkSelection(IDS));
    act(() => h.current().toggle('a'));
    expect(h.current().barOpen).toBe(false);
    act(() => h.current().toggle('b'));
    expect(h.current().barOpen).toBe(true);
  });

  it('clear empties everything and forgets the anchor', () => {
    const h = renderHook(() => useBulkSelection(IDS));
    act(() => h.current().toggle('a'));
    act(() => h.current().clear());
    expect(h.current().count).toBe(0);
    // With the anchor gone, a shift-click is a plain check rather than a
    // range back to a row the user last touched before clearing.
    act(() => h.current().toggle('d', true));
    expect([...h.current().checked]).toEqual(['d']);
  });
});
