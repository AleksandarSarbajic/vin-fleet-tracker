/**
 * §14 feature 7 — better empty and loading states.
 *
 * **Interpretation.** Turn 5 listed the feature and drew no screen for it, so
 * the shape here comes from the rest of the console rather than from a brief:
 * say the fact, then say the way out, and never make a dispatcher guess which
 * of five reasons produced an empty list.
 *
 * That is the whole argument for this file existing. "No trucks match" is one
 * sentence covering five different situations, four of which have a different
 * fix and one of which is not the dispatcher's fault at all. The list is empty
 * because the fleet is empty; because every truck is inactive and the default
 * view is active-only (§12.9); because the chips exclude everything; because
 * the search does; or because everything that survived is pinned above.
 *
 * Deciding that here, as a pure function of five counts, is what makes it
 * testable — and the ordering is the part worth testing, because the reasons
 * nest. A search that matches nothing inside a chip set that matches nothing
 * has to report the chips, since clearing the search would not help.
 *
 * ## Loading has no state on this console
 *
 * Deliberately. `src/app/page.tsx` renders on the server with the fleet
 * already loaded and hands it to `useFleet` as `initialData`, and the query
 * keeps the last good fleet through every refetch (`placeholderData`). So
 * `data` is never undefined and a skeleton would be dead code from the day it
 * shipped. The two moments that ARE a wait — a refetch in flight, and a
 * refetch that failed — are told by the header's fetch age and by
 * `FetchErrorBanner` respectively.
 */

export type EmptyAction = 'clear-chips' | 'clear-search' | 'show-inactive';

export type EmptyKind = 'fleet' | 'inactive' | 'chips' | 'search' | 'pinned';

export interface EmptyState {
  kind: EmptyKind;
  headline: string;
  detail: string;
  action: { label: string; key: EmptyAction } | null;
}

export interface EmptyInput {
  /** Every truck the fleet query returned, inactive included. */
  total: number;
  /** Survivors of the chips — which, with none selected, means active only. */
  afterChips: number;
  /** Survivors of the search box. */
  afterSearch: number;
  /** What the virtualiser is actually given: survivors minus the pinned. */
  listed: number;
  /** The settled query, not what is being typed. */
  query: string;
  chipCount: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The reason the list is empty, or null when it is not.
 *
 * Ordered widest cause first, because the causes nest: clearing a search that
 * matches nothing does not help if the chips already matched nothing.
 */
export function emptyState(input: EmptyInput): EmptyState | null {
  const { total, afterChips, afterSearch, listed, query, chipCount } = input;
  if (listed > 0) return null;

  if (total === 0) {
    return {
      kind: 'fleet',
      headline: 'No trucks on the board',
      /*
       * Not "something went wrong". An empty fleet is the correct answer
       * before the first Samsara poll lands, and saying so is more useful
       * than implying a fault that may not exist. If the feed really is
       * broken, §9.8's banner is already saying so above this.
       */
      detail:
        'Nothing has come back from the vehicle feed yet. The board fills in as soon as it does.',
      action: null,
    };
  }

  /**
   * §12.9: with no chip selected the view is active trucks. So an empty list
   * against a non-empty fleet, with nothing selected, means every truck is
   * marked inactive — which reads as a broken console unless it is named.
   */
  if (afterChips === 0 && chipCount === 0) {
    return {
      kind: 'inactive',
      headline: `Every truck is marked inactive`,
      detail: `The board shows active trucks unless you ask otherwise. ${plural(total, 'truck is', 'trucks are')} on file.`,
      action: { label: 'Show inactive', key: 'show-inactive' },
    };
  }

  if (afterChips === 0) {
    return {
      kind: 'chips',
      headline: 'No trucks in this filter',
      detail: `${plural(chipCount, 'filter is', 'filters are')} on, and ${plural(total, 'truck', 'trucks')} on the board matched none of them.`,
      action: { label: 'Clear filters', key: 'clear-chips' },
    };
  }

  if (afterSearch === 0) {
    return {
      kind: 'search',
      headline: `Nothing matches “${query}”`,
      detail: `${plural(afterChips, 'truck', 'trucks')} passed the filters; none of them matched the search.`,
      action: { label: 'Clear search', key: 'clear-search' },
    };
  }

  /**
   * The one empty list that is not a dead end: everything that survived is in
   * the pinned block, a few pixels above this message. Without saying so, a
   * dispatcher who pinned their four problem trucks and filtered to Late sees
   * an empty list under a block of four and concludes the filter is broken.
   */
  return {
    kind: 'pinned',
    headline: 'Everything here is pinned',
    detail: `All ${plural(afterSearch, 'matching truck is', 'matching trucks are')} in the pinned block above. Pinned trucks are never repeated in the list.`,
    action: null,
  };
}
