import { describe, expect, it } from 'vitest';
import { emptyState, type EmptyInput } from './empty-state';

/**
 * §14 feature 7. The ordering is the point: the reasons nest, and reporting
 * the wrong one hands the dispatcher a fix that does not work.
 */

const input = (over: Partial<EmptyInput> = {}): EmptyInput => ({
  total: 23,
  afterChips: 23,
  afterSearch: 23,
  listed: 23,
  query: '',
  chipCount: 0,
  ...over,
});

const kindOf = (over: Partial<EmptyInput>) => emptyState(input(over))?.kind ?? null;

describe('when nothing is wrong', () => {
  it('says nothing at all', () => {
    expect(emptyState(input())).toBeNull();
  });

  /** One row is not an empty list, however many were filtered away to get it. */
  it('says nothing when a single row survived', () => {
    expect(emptyState(input({ afterChips: 1, afterSearch: 1, listed: 1 }))).toBeNull();
  });
});

describe('which reason wins', () => {
  it('reports the fleet before anything else', () => {
    expect(
      kindOf({
        total: 0,
        afterChips: 0,
        afterSearch: 0,
        listed: 0,
        chipCount: 2,
        query: 'ab',
      }),
    ).toBe('fleet');
  });

  /**
   * §12.9. With no chip selected the view is active-only, so this is not a
   * filter the dispatcher set — and telling them to "clear filters" when
   * there are none to clear is the worst version of this screen.
   */
  it('names the active-only default rather than blaming a filter', () => {
    expect(kindOf({ afterChips: 0, afterSearch: 0, listed: 0, chipCount: 0 })).toBe(
      'inactive',
    );
  });

  it('reports the chips when they are the wider cause', () => {
    expect(
      kindOf({ afterChips: 0, afterSearch: 0, listed: 0, chipCount: 2, query: 'kowal' }),
    ).toBe('chips');
  });

  /**
   * The nesting, stated. A search matching nothing INSIDE a chip set that
   * matched nothing has to report the chips: clearing the search leaves the
   * list just as empty, and the dispatcher learns the message is unreliable.
   */
  it('does not report the search when the chips already excluded everything', () => {
    expect(
      kindOf({ afterChips: 0, afterSearch: 0, listed: 0, chipCount: 3, query: '137' }),
    ).not.toBe('search');
  });

  it('reports the search when the chips let something through', () => {
    expect(kindOf({ afterChips: 9, afterSearch: 0, listed: 0, query: '137' })).toBe(
      'search',
    );
  });

  /**
   * The one empty list that is not a dead end — everything that matched is a
   * few pixels above, in the pinned block.
   */
  it('reports the pinned block when it holds everything that matched', () => {
    expect(kindOf({ afterChips: 4, afterSearch: 4, listed: 0 })).toBe('pinned');
  });
});

describe('what it offers', () => {
  it('offers the action that actually clears the cause', () => {
    expect(
      emptyState(input({ afterChips: 0, afterSearch: 0, listed: 0, chipCount: 2 }))
        ?.action?.key,
    ).toBe('clear-chips');
    expect(
      emptyState(input({ afterSearch: 0, listed: 0, query: 'x' }))?.action?.key,
    ).toBe('clear-search');
    expect(
      emptyState(input({ afterChips: 0, afterSearch: 0, listed: 0, chipCount: 0 }))
        ?.action?.key,
    ).toBe('show-inactive');
  });

  /** Nothing to click when there is nothing the dispatcher can do about it. */
  it('offers nothing when there is nothing to undo', () => {
    expect(
      emptyState(input({ total: 0, afterChips: 0, afterSearch: 0, listed: 0 }))?.action,
    ).toBeNull();
    expect(
      emptyState(input({ afterChips: 4, afterSearch: 4, listed: 0 }))?.action,
    ).toBeNull();
  });

  it('quotes the query back so it is clear what was searched for', () => {
    expect(
      emptyState(input({ afterSearch: 0, listed: 0, query: 'kowalczyk' }))?.headline,
    ).toContain('kowalczyk');
  });

  it('counts in singulars when there is one of something', () => {
    const one = emptyState(
      input({ afterChips: 0, afterSearch: 0, listed: 0, chipCount: 1 }),
    );
    expect(one?.detail).toContain('1 filter is on');
    const many = emptyState(
      input({ afterChips: 0, afterSearch: 0, listed: 0, chipCount: 3 }),
    );
    expect(many?.detail).toContain('3 filters are on');
  });
});
