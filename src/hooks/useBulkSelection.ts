'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

/**
 * Multi-select for the list (§14, feature 2).
 *
 * §14.3 settled the mechanism before anything was drawn:
 *
 * > Multi-select is checkboxes in a 28px leading column; shift-click on a
 * > checkbox extends a range. **Plain shift-click on rows was rejected**: a
 * > row click already means select + map follow, and ↑↓ own the selection.
 *
 * So there are two independent cursors on this list and they must not be
 * confused: `selectedId` (one row, drives the map) and this (a set, drives
 * the bulk bar). A row can be selected and unchecked, or checked and not
 * selected, and both are ordinary states.
 *
 * The anchor for a range is the last checkbox the user actually touched, not
 * the selection — shift-clicking after moving the selection with the arrow
 * keys would otherwise select a range the user never indicated.
 */
export function useBulkSelection(orderedIds: readonly string[]) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  const anchor = useRef<string | null>(null);

  /**
   * Rows can leave the list — a filter change, a delivered load, a truck
   * going inactive. A checked id that is no longer on screen would keep the
   * bulk bar open over a selection nobody can see, so the visible set is
   * derived rather than stored.
   */
  const visible = useMemo(() => {
    const present = new Set(orderedIds);
    const kept = new Set<string>();
    for (const id of checked) if (present.has(id)) kept.add(id);
    return kept;
  }, [checked, orderedIds]);

  const toggle = useCallback(
    (id: string, extend = false) => {
      setChecked((current) => {
        const next = new Set(current);
        const from = anchor.current;

        if (extend && from !== null && from !== id) {
          const a = orderedIds.indexOf(from);
          const b = orderedIds.indexOf(id);
          if (a !== -1 && b !== -1) {
            // The range takes the state the CLICKED end is moving to, so a
            // shift-click that unchecks unchecks the whole span. Matching the
            // anchor's state instead would make the same gesture mean two
            // different things depending on where it started.
            const checking = !current.has(id);
            for (let i = Math.min(a, b); i <= Math.max(a, b); i += 1) {
              const rowId = orderedIds[i];
              if (rowId === undefined) continue;
              if (checking) next.add(rowId);
              else next.delete(rowId);
            }
            anchor.current = id;
            return next;
          }
        }

        if (next.has(id)) next.delete(id);
        else next.add(id);
        anchor.current = id;
        return next;
      });
    },
    [orderedIds],
  );

  const clear = useCallback(() => {
    setChecked(new Set());
    anchor.current = null;
  }, []);

  return {
    /** Checked AND still in the list. */
    checked: visible,
    count: visible.size,
    toggle,
    clear,
    /** §14.5: the bar replaces the footer at two, not one. */
    barOpen: visible.size >= 2,
  };
}
