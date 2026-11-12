'use client';

import { Component, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { FleetRow } from '@/server/fleet-query';
import { GRID_6, GRID_8, ROW_HEIGHT, TruckRow } from './TruckRow';
import { ListFooter } from './ListFooter';
import type { Density } from '@/lib/density';
import { BulkBar } from './BulkBar';
import { BulkBarSlot } from './BulkBarSlot';
import { openBoardOnce } from './board-opening';
import { landSelection, slideSelection } from './selection-slide';
import { createRowGlide } from './row-glide';
import { PIN_CAP } from '@/lib/pinned';
import type { RowFlashView } from '@/lib/flash';
import { EmptyList } from './EmptyList';
import type { EmptyAction, EmptyState } from '@/lib/empty-state';
import { MOTION_MS, MOTION_SHAPE } from '@/design/tokens';
import { dropIn } from '@/lib/appear-motion';
import { useOnAppear } from '@/hooks/useOnAppear';

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

/**
 * §12.149. A class, for the one thing only a class can do: run just before React changes
 * the page. Where a row is drawn has to be read then, and a row leaving the drawn window
 * has to be copied then. In a layout effect it is already gone.
 */
class BeforeCommit extends Component<{ cause: string; onCause: () => void }> {
  override getSnapshotBeforeUpdate(previous: { cause: string }): null {
    if (previous.cause !== this.props.cause) this.props.onCause();
    return null;
  }
  override componentDidUpdate(): void {}
  override render(): null {
    return null;
  }
}

interface Props {
  /** §12.149. Changes when rows are to glide to their new places, and at no other time. */
  glideCause: string;
  rows: FleetRow[];
  /** Reference instant for every age on a row — see TruckRow. */
  fetchedAt: string | null;
  /** §5.9: withdraws schedule colour from every row at once. */
  feedStale: boolean;
  selectedId: string | null;
  /** §14 feature 5. */
  density: Density;
  /** §14 feature 2. Checked rows — not the same cursor as selectedId. */
  checked: ReadonlySet<string>;
  onCheck: (id: string, extend: boolean) => void;
  /**
   * §14 feature 4. `rows` arrives with the pinned ones ALREADY REMOVED — see
   * §14.5, "removed from their group, not duplicated". The block above the
   * list renders them, and every count below stays about the list below.
   */
  pinnedRows: FleetRow[];
  /**
   * §14 feature 6. Null for a row that is not flashing. A lookup rather than
   * a field on the row, because the flash is about the LAST POLL and the row
   * is about now — putting it on the row would mean rebuilding every row
   * object when one of them changed.
   */
  flashFor: (id: string) => RowFlashView | null;
  /** §14 feature 14. One read at the top, not one matchMedia listener per row. */
  reducedMotion: boolean;
  isPinned: (id: string) => boolean;
  onPin: (id: string) => void;
  pinRefused: boolean;
  bulk: {
    barOpen: boolean;
    onForceStatus: (() => void) | null;
    onAddNote: (() => void) | null;
    /** §12.90. Absent for a viewer. */
    onAddToList?: () => void;
    onClear: () => void;
  };
  query: string;
  /**
   * §14 feature 7. Non-null when the list has nothing to show, carrying WHICH
   * of the five reasons it is. Decided in Console, which is the only place
   * that can see the counts before and after each stage of filtering.
   */
  empty: EmptyState | null;
  onEmptyAction: (action: EmptyAction) => void;
  onSelect: (id: string) => void;
  /** §12.48: double-click a row to edit, the mouse form of Enter. */
  /** §12.94. Null below the editing width: a row then opens nothing. */
  onEdit: ((id: string) => void) | null;
}

export function FleetList({
  glideCause,
  rows,
  fetchedAt,
  feedStale,
  selectedId,
  density,
  checked,
  onCheck,
  pinnedRows,
  flashFor,
  reducedMotion,
  isPinned,
  onPin,
  pinRefused,
  bulk,
  query,
  empty,
  onEmptyAction,
  onSelect,
  onEdit,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
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
    // §14 feature 5. The estimate has to track the rendered height or
    // scrollToIndex lands on the wrong row.
    estimateSize: () => ROW_HEIGHT[density],
    overscan: 8,
    getItemKey: (index) => rows[index]?.id ?? index,
  });

  const items = virtualizer.getVirtualItems();
  const firstVisible = items[0]?.index ?? 0;
  const lastVisible = items[items.length - 1]?.index ?? -1;

  // §12.149. In the commit the first rows are drawn in, ahead of their first frame.
  const hasRows = items.length > 0;
  useLayoutEffect(() => {
    if (hasRows && scrollRef.current && bodyRef.current) {
      openBoardOnce(scrollRef.current, bodyRef.current);
    }
  }, [hasRows]);

  /** Marker click rails the row into view (§9.3, two-way selection). */
  const scrollToId = useCallback(
    (id: string) => {
      const index = rows.findIndex((r) => r.id === id);
      if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
    },
    [rows, virtualizer],
  );

  /* §12.149. Rows glide when a cause is named, and only then. */
  const [glide] = useState(() =>
    createRowGlide(
      () => scrollRef.current,
      () => bodyRef.current,
    ),
  );

  /** §12.149. In the commit that changes it, ahead of the frame that would show it. */
  const lastDrawnSelection = useRef(selectedId);
  useLayoutEffect(() => {
    const was = lastDrawnSelection.current;
    lastDrawnSelection.current = selectedId;
    const box = scrollRef.current;
    if (!box || was === selectedId) return;
    // Selected during a glide, it just appears: the rows are on their way somewhere else.
    if (was && selectedId && !glide.isMoving()) slideSelection(box, was, selectedId);
    else landSelection(box);
    // Rows are drawn by the commit that changes it, so this runs with them in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const lastSelected = useRef<string | null>(null);
  useEffect(() => {
    if (selectedId && selectedId !== lastSelected.current) scrollToId(selectedId);
    lastSelected.current = selectedId;
  }, [selectedId, scrollToId]);

  const idsBefore = useRef<string[]>([]);
  useLayoutEffect(() => {
    if (scrollRef.current) landSelection(scrollRef.current);
    glide.run(
      rows.map((r) => r.id),
      ROW_HEIGHT[density],
    );
    // The cause alone. Everything else that changes a row's place must not start one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glideCause]);
  useLayoutEffect(() => {
    idsBefore.current = rows.map((r) => r.id);
    glide.checkTargets();
  });

  /**
   * §12.152. The empty list drops in when a person emptied it: a chip, a list or a search,
   * named the way `glideCause` names a glide. A poll that empties a filtered list changes
   * none of these, so then it is simply there. Compared with the commit before, never
   * guessed from timing.
   */
  const emptyCause = `${glideCause}|${query}`;
  const causeBefore = useRef(emptyCause);
  useOnAppear(empty !== null, () => {
    if (causeBefore.current === emptyCause) return;
    const list = scrollRef.current?.querySelector('[data-empty]');
    if (list) dropIn(list, MOTION_MS.emptyDrop, MOTION_SHAPE.emptyDropPx);
  });
  useLayoutEffect(() => {
    causeBefore.current = emptyCause;
  });

  const headers = columns === 8 ? HEADERS_8 : HEADERS_6;

  return (
    <div ref={panelRef} className="flex min-h-0 min-w-0 flex-col">
      <BeforeCommit
        cause={glideCause}
        onCause={() =>
          glide.capture(new Set(items.map((item) => String(item.key))), idsBefore.current)
        }
      />
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto">
        {/* Sticky INSIDE the scroller, so it survives every scroll position. */}
        <div
          role="row"
          className={`sticky top-0 z-[2] grid h-7 items-center gap-x-[14px] border-b border-line-hair bg-surface-raised pl-[3px] pr-4 ${columns === 8 ? GRID_8 : GRID_6}`}
        >
          {/*
            Two spacers: the checkbox column and the 3px rail. No select-all
            here -- §14 did not specify one, and a control that checks thirty
            trucks in one click wants a design rather than an assumption.
          */}
          <div />
          <div />
          {headers.map((h) => (
            <div
              key={h}
              className={`font-cond text-micro uppercase ${RIGHT_ALIGNED.has(h) ? 'text-right ' : ''}${
                feedStale && h === 'Position'
                  ? 'text-status-neutral-fg'
                  : 'text-text-muted'
              }`}
            >
              {/* The column says so itself rather than only the rows (§5.9). */}
              {feedStale && h === 'Position' ? 'Position (frozen)' : h}
            </div>
          ))}
        </div>

        {/*
          §14 feature 4. The pinned block, above the list and outside the
          virtualiser — five rows at most (PIN_CAP), so virtualising them
          would cost more than it saves.

          §5.7's urgency groups are specified and NOT built, so "above the
          first group header" resolves to "at the top of the flat list" today.
          The half of §14.5 that lands now is the one that matters: these rows
          are removed from the list below, never repeated in it, so every
          count below still describes what is below.
        */}
        {pinnedRows.length > 0 ? (
          <div className="border-b border-line-hair">
            <div className="relative flex h-6 items-center gap-2 bg-surface-raised px-3 font-cond text-micro uppercase tracking-[.11em] text-text-muted">
              <span className="text-accent">Pinned</span>
              <span className="tabular-nums">
                {pinnedRows.length} of {PIN_CAP}
              </span>
              <span className="text-text-muted">— not re-sorted, not repeated below</span>
              {pinRefused ? (
                <span className="ml-auto text-status-risk-fg">
                  {PIN_CAP} is the limit — unpin one first
                </span>
              ) : null}
            </div>
            {pinnedRows.map((row) => (
              <TruckRow
                key={row.id}
                row={row}
                fetchedAt={fetchedAt}
                feedStale={feedStale}
                columns={columns}
                density={density}
                selected={row.id === selectedId}
                checked={checked.has(row.id)}
                onCheck={onCheck}
                flash={flashFor(row.id)}
                reducedMotion={reducedMotion}
                pinned
                onPin={onPin}
                query={query}
                onSelect={onSelect}
                onEdit={onEdit}
              />
            ))}
          </div>
        ) : null}

        {/*
          §14 feature 7. Where an empty list says why.

          Inside the scroller and below the pinned block on purpose: the
          "everything here is pinned" case has to appear directly under the
          block it is talking about, or it reads as a contradiction.
        */}
        {empty ? <EmptyList state={empty} onAction={onEmptyAction} /> : null}

        {/* The body dims as a whole: the schedule is not to be trusted. */}
        <div
          ref={bodyRef}
          onPointerDownCapture={(event) => glide.pressed(event.nativeEvent)}
          onClick={(event) => {
            const id = glide.clicked(event.nativeEvent);
            if (id) onSelect(id);
          }}
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
                  density={density}
                  selected={row.id === selectedId}
                  checked={checked.has(row.id)}
                  onCheck={onCheck}
                  flash={flashFor(row.id)}
                  reducedMotion={reducedMotion}
                  pinned={isPinned(row.id)}
                  onPin={onPin}
                  query={query}
                  onSelect={onSelect}
                  onEdit={onEdit}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/*
        §14.5. One slot, one occupant. The bar REPLACES the footer at two
        checked rows rather than stacking above it, so the list never shifts
        under a cursor that is mid-click.
      */}
      {bulk.barOpen ? (
        <BulkBarSlot>
          <BulkBar
            rows={rows}
            checked={checked}
            lastVisible={lastVisible}
            onForceStatus={bulk.onForceStatus}
            onAddNote={bulk.onAddNote}
            {...(bulk.onAddToList ? { onAddToList: bulk.onAddToList } : {})}
            onClear={bulk.onClear}
          />
        </BulkBarSlot>
      ) : (
        <ListFooter rows={rows} firstVisible={firstVisible} lastVisible={lastVisible} />
      )}
    </div>
  );
}
