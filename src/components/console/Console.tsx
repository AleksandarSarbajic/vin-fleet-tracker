'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useFleet, type FleetResponse } from '@/hooks/useFleet';
import type { FleetRow } from '@/server/fleet-query';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { SEARCH_DEBOUNCE_MS, filterRows } from '@/lib/search';
import { ConsoleHeader } from './ConsoleHeader';
import { FleetList } from './FleetList';
import { Split } from './Split';
import { FleetMap } from './map/FleetMap';
import { useDisplayOrder } from './useDisplayOrder';

/**
 * Stable identity, so an empty fleet does not churn every memo downstream.
 * Typed as FleetRow[] because it only ever stands in for one.
 */
const NO_ROWS: FleetRow[] = [];

interface Props {
  initial: FleetResponse;
  dispatchTz: string;
  userInitials: string;
  /**
   * Read on the SERVER and passed down, not read here with
   * `useSearchParams`. That hook opts its whole subtree out of server
   * rendering, which silently threw away the server-side loadFleet() prefetch
   * — the first paint carried no fleet at all and the console had to refetch
   * from /api/fleet on mount.
   */
  initialQuery: string;
  initialTruck: string | null;
}

export function Console({
  initial,
  dispatchTz,
  userInitials,
  initialQuery,
  initialTruck,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();

  const { data } = useFleet(initial);
  const rows = useMemo(() => data?.fleet ?? NO_ROWS, [data]);

  /** Typed immediately, applied 250ms later — the field never feels laggy. */
  const [typed, setTyped] = useState(initialQuery);
  const [query, setQuery] = useState(typed);
  useEffect(() => {
    const id = window.setTimeout(() => setQuery(typed), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [typed]);

  /**
   * The URL carries the truck NUMBER, not the internal id: a number is what a
   * dispatcher can read off the screen, verify, and say down a phone.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [missingTruck, setMissingTruck] = useState<string | null>(null);
  const resolvedInitialTruck = useRef(false);

  useEffect(() => {
    if (!initialTruck || resolvedInitialTruck.current || rows.length === 0) return;
    resolvedInitialTruck.current = true;
    const match = rows.find((r) => String(r.truckNumber) === initialTruck);
    if (match) setSelectedId(match.id);
    // Unknown or inactive: the console still loads, with a dismissible note.
    // A link a colleague sent you should never be a dead end.
    else setMissingTruck(initialTruck);
  }, [initialTruck, rows]);

  /** Search and selection both live in the URL so a link carries the view. */
  const syncUrl = useCallback(
    (next: { q?: string; truck?: string | null }) => {
      const search = new URLSearchParams(window.location.search);
      if (next.q !== undefined) {
        if (next.q.trim()) search.set('q', next.q);
        else search.delete('q');
      }
      if (next.truck !== undefined) {
        if (next.truck) search.set('truck', next.truck);
        else search.delete('truck');
      }
      const qs = search.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  useEffect(() => {
    const current = new URLSearchParams(window.location.search).get('q') ?? '';
    if (current !== query) syncUrl({ q: query });
  }, [query, syncUrl]);

  const select = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      setMissingTruck(null);
      const row = rows.find((r) => r.id === id);
      const number = row?.truckNumber;
      syncUrl({ truck: typeof number === 'number' ? String(number) : null });
    },
    [rows, syncUrl],
  );

  const filtered = useMemo(() => filterRows(rows, query), [rows, query]);
  const { ordered, drift, resort } = useDisplayOrder(filtered, 'urgency', query);

  /** Arrow keys move the selection and the map follows (§8.1). */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;

      if (event.key === 'Escape') {
        if (query) setTyped('');
        else select(null);
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

      event.preventDefault();
      const index = ordered.findIndex((r) => r.id === selectedId);
      const next =
        event.key === 'ArrowDown'
          ? Math.min(ordered.length - 1, index + 1)
          : Math.max(0, index - 1);
      const row = ordered[index === -1 ? 0 : next];
      if (row) select(row.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ordered, selectedId, select, query]);

  /** Bumped on split drag-end; the map reflows then and only then. */
  const [resizeSignal, setResizeSignal] = useState(0);
  const onResizeEnd = useCallback(() => setResizeSignal((n) => n + 1), []);

  return (
    <div className="flex h-dvh flex-col bg-surface-base">
      <ConsoleHeader
        query={typed}
        onQueryChange={setTyped}
        matchCount={filtered.length}
        totalCount={rows.length}
        fetchedAt={data?.fetchedAt ?? null}
        feedNewestAt={null}
        dispatchTz={dispatchTz}
        userInitials={userInitials}
      />

      {missingTruck ? (
        <div className="flex shrink-0 items-center gap-3 border-b border-status-risk-bd bg-status-risk-bg px-4 py-2 text-body text-status-risk-fg">
          <span className="flex-1">
            Truck {missingTruck} is not in the active fleet — it may be inactive
            or the number may be wrong. Showing the whole fleet instead.
          </span>
          <button
            type="button"
            onClick={() => {
              setMissingTruck(null);
              syncUrl({ truck: null });
            }}
            className="font-cond text-micro uppercase tracking-[.08em] text-text"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-[34px] shrink-0 items-center justify-between border-b border-line-soft px-4">
          <span className="font-cond text-[12px] font-semibold uppercase tracking-[.1em] text-text-secondary">
            Fleet — {rows.length} trucks · sorted by urgency
          </span>
          <span className="font-sans text-small text-text-muted">
            {selectedId ? (
              <>
                1 selected · <span className="text-accent">Esc</span> to clear
              </>
            ) : (
              <>
                <span className="text-accent">/</span> to search
              </>
            )}
          </span>
        </div>

        <Split
          onResizeEnd={onResizeEnd}
          list={
            <FleetList
              rows={ordered}
              selectedId={selectedId}
              query={query}
              drift={drift}
              onResort={resort}
              onSelect={select}
            />
          }
          map={
            <FleetMap
              rows={filtered}
              selectedId={selectedId}
              onSelect={select}
              resizeSignal={resizeSignal}
              reducedMotion={reducedMotion}
            />
          }
        />
      </div>
    </div>
  );
}
