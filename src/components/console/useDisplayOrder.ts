'use client';

import { useCallback, useMemo, useState } from 'react';
import type { FleetRow } from '@/server/fleet-query';
import { compareFleet, type SortMode } from '@/lib/fleet-order';

export type { SortMode };

export interface DisplayOrder {
  /** Rows in the order actually on screen. */
  ordered: FleetRow[];
  /** How many rows would move if the order were recomputed now. */
  drift: number;
  /** Adopt the recomputed order — what the "N rows would reorder" bar does. */
  resort: () => void;
  /** Counts `resort`, so a glide can name the reorder bar as its cause (§12.149). */
  resorts: number;
}

/**
 * design-spec §12.4: **the list does not re-sort on refresh.**
 *
 * Order is computed on mount, on filter or search change, and on explicit
 * user action. Nothing else. Status colours, ETAs and positions update in
 * place; rows never move under a click.
 *
 * That forces order to live apart from data: this holds an array of ids, and
 * a poll only refreshes the values behind them. When the recomputed order
 * differs, `drift` is non-zero and the toolbar offers the bar.
 *
 * The new order is adopted while rendering rather than in an effect (§12.149), so
 * the commit a chip changes holds the whole of its change. In an effect there was a
 * commit between, with the rows that left gone and the rows that came not yet there.
 */
export function useDisplayOrder(
  rows: FleetRow[],
  mode: SortMode,
  /** Changing this adopts the new order immediately — filters may reorder. */
  resetKey: string,
): DisplayOrder {
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  const computed = useMemo(
    () => [...rows].sort(compareFleet(mode)).map((r) => r.id),
    [rows, mode],
  );

  const [held, setHeld] = useState({ displayed: computed, resetKey });
  const [resorts, setResorts] = useState(0);

  let displayed = held.displayed;
  if (held.resetKey !== resetKey) {
    displayed = computed;
    setHeld({ displayed, resetKey });
  } else {
    const known = new Set(displayed);
    // Trucks that appeared since the last sort go to the end rather than
    // reshuffling everything; trucks that vanished drop out.
    const kept = displayed.filter((id) => byId.has(id));
    const added = computed.filter((id) => !known.has(id));
    if (added.length > 0 || kept.length !== displayed.length) {
      displayed = [...kept, ...added];
      setHeld({ displayed, resetKey });
    }
  }

  const ordered = useMemo(
    () => displayed.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
    [displayed, byId],
  );

  const drift = useMemo(() => {
    if (displayed.length !== computed.length) return 0;
    let moved = 0;
    for (let i = 0; i < computed.length; i += 1) {
      if (computed[i] !== displayed[i]) moved += 1;
    }
    return moved;
  }, [computed, displayed]);

  const resort = useCallback(() => {
    setHeld((was) => ({ ...was, displayed: computed }));
    setResorts((n) => n + 1);
  }, [computed]);

  return { ordered, drift, resort, resorts };
}
