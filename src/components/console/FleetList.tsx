'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { FleetRow } from '@/server/fleet-query';
import { GRID_6, GRID_8, ROW_HEIGHT, TruckRow } from './TruckRow';
import { ListFooter } from './ListFooter';

/**
 * design-spec §12.17: the six-column switch keys off the LIST PANEL's width,
 * not the viewport's.
 *
 * A media query cannot see this. The split is draggable, so a 1728px viewport
 * with the handle pulled left puts the list under 900px while every media
 * query still reports 1728. That would have shipped as "the columns don't drop
 * when I drag" with no obvious cause.
 */
const SIX_COLUMN_BELOW = 900;

const HEADERS_8 = [
  'Truck',
  'Driver',
  'Position',
  'Next stop',
  'Appt',
  'ETA',
  'Status',
] as const;
const HEADERS_6 = ['Truck', 'Driver', 'Next stop', 'Appt', 'Status'] as const;
const RIGHT_ALIGNED = new Set(['Appt', 'ETA', 'Status']);

interface Props {
  rows: FleetRow[];
  /** Reference instant for every age on a row — see TruckRow. */
  fetchedAt: string | null;
  /** §5.9: withdraws schedule colour from every row at once. */
  feedStale: boolean;
  selectedId: string | null;
  query: string;
  drift: number;
  onResort: () => void;
  onSelect: (id: string) => void;
  /** §12.48: double-click a row to edit, the mouse form of Enter. */
  onEdit: (id: string) => void;
}

export function FleetList({
  rows,
  fetchedAt,
  feedStale,
  selectedId,
  query,
  drift,
  onResort,
  onSelect,
  onEdit,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState<6 | 8>(8);

  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      setColumns(width > 0 && width < SIX_COLUMN_BELOW ? 6 : 8);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** Virtualized regardless of fleet size, per the brief. */
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    getItemKey: (index) => rows[index]?.id ?? index,
  });

  const items = virtualizer.getVirtualItems();
  const firstVisible = items[0]?.index ?? 0;
  const lastVisible = items[items.length - 1]?.index ?? -1;

  /** Marker click rails the row into view (§9.3, two-way selection). */
  const scrollToId = useCallback(
    (id: string) => {
      const index = rows.findIndex((r) => r.id === id);
      if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
    },
    [rows, virtualizer],
  );

  const lastSelected = useRef<string | null>(null);
  useEffect(() => {
    if (selectedId && selectedId !== lastSelected.current) scrollToId(selectedId);
    lastSelected.current = selectedId;
  }, [selectedId, scrollToId]);

  const headers = columns === 8 ? HEADERS_8 : HEADERS_6;

  return (
    <div ref={panelRef} className="flex min-h-0 min-w-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {/* Sticky INSIDE the scroller, so it survives every scroll position. */}
        <div
          role="row"
          className={`sticky top-0 z-[2] grid h-7 items-center gap-x-[14px] border-b border-line-hair bg-surface-raised pl-[3px] pr-4 ${columns === 8 ? GRID_8 : GRID_6}`}
        >
          <div />
          {headers.map((h) => (
            <div
              key={h}
              className={`font-cond text-micro uppercase ${RIGHT_ALIGNED.has(h) ? 'text-right ' : ''}${
                feedStale && h === 'Position' ? 'text-status-neutral-fg' : 'text-text-muted'
              }`}
            >
              {/* The column says so itself rather than only the rows (§5.9). */}
              {feedStale && h === 'Position' ? 'Position (frozen)' : h}
            </div>
          ))}
        </div>

        {drift > 0 ? (
          <button
            type="button"
            onClick={onResort}
            className="sticky top-7 z-[1] flex w-full items-center justify-center gap-2 border-b border-line-hair bg-surface-overlay py-1.5 font-cond text-micro uppercase tracking-[.08em] text-accent"
          >
            {drift} {drift === 1 ? 'row would' : 'rows would'} reorder — click to sort
          </button>
        ) : null}

        {/* The body dims as a whole: the schedule is not to be trusted. */}
        <div
          style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
          className={feedStale ? 'opacity-[.72]' : ''}
        >
          {items.map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            return (
              <div
                key={item.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${item.start}px)`,
                }}
              >
                <TruckRow
                  row={row}
                  fetchedAt={fetchedAt}
                  feedStale={feedStale}
                  columns={columns}
                  selected={row.id === selectedId}
                  query={query}
                  onSelect={onSelect}
                  onEdit={onEdit}
                />
              </div>
            );
          })}
        </div>
      </div>

      <ListFooter rows={rows} firstVisible={firstVisible} lastVisible={lastVisible} />
    </div>
  );
}
