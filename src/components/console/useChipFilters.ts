'use client';

import { useCallback, useState } from 'react';
import { FILTER_KEYS, type FilterKey } from './FilterChips';

/**
 * The filter chips and the URL they write to (§9.6, §12.29).
 *
 * Extracted from Console so the one rule that matters here can be tested:
 * **the URL is written from the event, never from the render.**
 */
export function useChipFilters(
  initialChips: string[],
  syncUrl: (next: { chips: FilterKey[] }) => void,
) {
  const [chips, setChips] = useState<Set<FilterKey>>(
    () =>
      new Set(
        initialChips.filter((c): c is FilterKey => FILTER_KEYS.includes(c as FilterKey)),
      ),
  );

  /**
   * The next set is computed HERE, in the handler, and the URL is written
   * HERE — not inside the `setChips` updater.
   *
   * It used to be inside it, and that is why `router.replace` ran during the
   * render phase: React invokes a functional updater while rendering, not
   * while handling the event. The `useCallback` around it made no difference,
   * because the callback was not the thing being called at the wrong time —
   * the updater it passed to React was.
   *
   * Reading `chips` directly is correct for an event handler: it always sees
   * the last committed value. The functional form buys atomicity across
   * several updates in one tick, which a click on one chip does not do.
   */
  const toggleChip = useCallback(
    (key: FilterKey) => {
      const next = new Set(chips);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      setChips(next);
      syncUrl({ chips: [...next] });
    },
    [chips, syncUrl],
  );

  /**
   * §14 feature 11. The whole set at once, for applying a saved view.
   *
   * Separate from `toggleChip` rather than a loop over it: toggling four
   * chips would write the URL four times and leave four entries where the
   * dispatcher made one choice. Same rule as above — the URL is written from
   * the event, once.
   */
  const applyChips = useCallback(
    (keys: readonly FilterKey[]) => {
      const next = new Set(keys);
      setChips(next);
      syncUrl({ chips: [...next] });
    },
    [syncUrl],
  );

  const resetChips = useCallback(() => {
    setChips(new Set());
    syncUrl({ chips: [] });
  }, [syncUrl]);

  return { chips, toggleChip, applyChips, resetChips };
}
