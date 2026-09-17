'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FleetRow } from '@/server/fleet-query';
import { urgencyRank } from '@/lib/status';

export type SortMode = 'urgency' | 'truck';

/** Ordering rules. Urgency is the default and the design's first segment. */
function compare(mode: SortMode) {
  return (a: FleetRow, b: FleetRow): number => {
    if (mode === 'urgency') {
      const byUrgency = urgencyRank(a.status) - urgencyRank(b.status);
      if (byUrgency !== 0) return byUrgency;
      // TODO(phase 4): the documented secondary sort is appointment time
      // ascending, nulls last (§12.4). No stop has an appointment yet, so
      // every row falls through to truck number, which is the stable
      // tiebreak underneath it either way.
    }
    return (a.truckNumber ?? Number.MAX_SAFE_INTEGER) -
      (b.truckNumber ?? Number.MAX_SAFE_INTEGER);
  };
}

export interface DisplayOrder {
  /** Rows in the order actually on screen. */
  ordered: FleetRow[];
  /** How many rows would move if the order were recomputed now. */
  drift: number;
  /** Adopt the recomputed order — what the "N rows would reorder" pill does. */
  resort: () => void;
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
 * differs, `drift` is non-zero and the UI offers the pill.
 */
export function useDisplayOrder(
  rows: FleetRow[],
  mode: SortMode,
  /** Changing this adopts the new order immediately — filters may reorder. */
  resetKey: string,
): DisplayOrder {
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  const computed = useMemo(
    () => [...rows].sort(compare(mode)).map((r) => r.id),
    [rows, mode],
  );

  const [displayed, setDisplayed] = useState<string[]>(computed);
  const lastReset = useRef(resetKey);

  useEffect(() => {
    if (lastReset.current !== resetKey) {
      lastReset.current = resetKey;
      setDisplayed(computed);
      return;
    }
    setDisplayed((current) => {
      const known = new Set(current);
      // Trucks that appeared since the last sort go to the end rather than
      // reshuffling everything; trucks that vanished drop out.
      const kept = current.filter((id) => byId.has(id));
      const added = computed.filter((id) => !known.has(id));
      if (added.length === 0 && kept.length === current.length) return current;
      return [...kept, ...added];
    });
  }, [computed, resetKey, byId]);

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

  const resort = useCallback(() => setDisplayed(computed), [computed]);

  return { ordered, drift, resort };
}
