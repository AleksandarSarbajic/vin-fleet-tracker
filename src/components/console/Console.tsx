'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { FLEET_POLL_MS, useFleet, type FleetResponse } from '@/hooks/useFleet';
import type { FleetRow } from '@/server/fleet-query';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { SEARCH_DEBOUNCE_MS, filterRows } from '@/lib/search';
import { passesFilters, type FilterKey } from './FilterChips';
import type { BoardDriver } from '@/server/assignments';
import type { Role } from '@/lib/roles';
import { EditStopModal } from '@/components/edit/EditStopModal';
import { ConsoleHeader } from './ConsoleHeader';
import { FeedBanner } from './FeedBanner';
import type { AccountUser } from './AccountMenu';
import { Toasts } from './Toasts';
import {
  detectToasts,
  dispatchDay,
  type FleetSnapshot,
  type StatusToast,
} from '@/lib/toast';
import { FleetList } from './FleetList';
import { Split } from './Split';
import { FleetMap } from './map/FleetMap';
import { useDisplayOrder } from './useDisplayOrder';
import { useChipFilters } from './useChipFilters';
import { useSavedViews, viewChips } from './useSavedViews';
import { refusalMessage, type SavedView } from '@/lib/views';
import { isTypingTarget } from '@/lib/keymap';
import { OverlayProvider } from '@/components/overlay/OverlayLayer';
import { ShortcutSheet } from '@/components/overlay/ShortcutSheet';
import { CommandPalette } from '@/components/overlay/CommandPalette';
import { useDensity } from '@/hooks/useDensity';
import { nextDensity } from '@/lib/density';
import { ListToolbar } from './ListToolbar';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { BulkActionModal } from './BulkActionModal';
import { usePinned } from '@/hooks/usePinned';
import { useRowFlash } from '@/hooks/useRowFlash';
import { FetchErrorBanner } from './FetchErrorBanner';
import { emptyState, type EmptyAction } from '@/lib/empty-state';
import { useFleetHealth } from '@/hooks/useFleetHealth';
import type { FleetHealth } from '@/server/health';
import { flashView, type RowFlashView } from '@/lib/flash';

/**
 * Stable identity, so an empty fleet does not churn every memo downstream.
 * Typed as FleetRow[] because it only ever stands in for one.
 */
const NO_ROWS: FleetRow[] = [];

interface Props {
  initial: FleetResponse;
  /** §14 feature 8. Server-rendered, so the strip never flashes empty. */
  initialHealth: FleetHealth;
  dispatchTz: string;
  user: AccountUser;
  /**
   * Read on the SERVER and passed down, not read here with
   * `useSearchParams`. That hook opts its whole subtree out of server
   * rendering, which silently threw away the server-side loadFleet() prefetch
   * — the first paint carried no fleet at all and the console had to refetch
   * from /api/fleet on mount.
   */
  initialQuery: string;
  initialTruck: string | null;
  /** Filter chips ride in the URL so a link carries the whole view (§9.6). */
  initialChips: string[];
  /** For the edit modal's driver picker. */
  drivers: BoardDriver[];
  role: Role;
}

export function Console({
  initial,
  initialHealth,
  dispatchTz,
  user,
  initialQuery,
  initialTruck,
  initialChips,
  drivers,
  role,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();

  /** Search and selection both live in the URL so a link carries the view. */
  const syncUrl = useCallback(
    (next: { q?: string; truck?: string | null; chips?: FilterKey[] }) => {
      const search = new URLSearchParams(window.location.search);
      if (next.chips !== undefined) {
        if (next.chips.length > 0) search.set('chips', next.chips.join(','));
        else search.delete('chips');
      }
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

  /**
   * §12.29: the chips own their state and write the URL FROM THE CLICK. The
   * toggle used to call syncUrl inside a setChips updater, which React runs
   * during render — so router.replace fired mid-render.
   */
  const { chips, toggleChip, applyChips, resetChips } = useChipFilters(
    initialChips,
    syncUrl,
  );

  const { data, refetch, isFetching, isError } = useFleet(initial);
  /**
   * Every truck, inactive included, so the Inactive chip (§12.14) has
   * something to filter to. The default view is active only — applied on the
   * real column in `passesFilters`, not hidden inside the chip.
   */
  const all = useMemo(() => data?.fleet ?? NO_ROWS, [data]);

  /**
   * Nothing selected means "active trucks, any status" (§12.9). The filter
   * runs over the real `active` column rather than being special-cased inside
   * the Inactive chip.
   */
  const rows = useMemo(
    () => all.filter((row) => passesFilters(row, chips)),
    [all, chips],
  );

  /* --------------------------- status toasts (§12.50) -------------------- */

  const [toasts, setToasts] = useState<StatusToast[]>([]);
  /** The previous poll, as the only thing a transition can be measured against. */
  const lastSeen = useRef<Map<string, FleetSnapshot> | null>(null);
  const lastFeedStale = useRef<boolean>(false);
  /**
   * Which truck+stop pairs have already toasted today, persisted so a mid-shift
   * refresh does not re-announce a truck the dispatcher has already dealt with.
   * Keyed by dispatch day, which is also how the TOMORROW rule counts days.
   */
  const ledgerKey = `ft.toasted.${dispatchDay(new Date(), dispatchTz)}`;
  const ledger = useRef<Set<string> | null>(null);
  if (ledger.current === null) {
    let stored: string[] = [];
    try {
      const raw = window.localStorage.getItem(ledgerKey);
      stored = raw === null ? [] : (JSON.parse(raw) as string[]);
      // Yesterday's ledgers are dead weight; drop them on the way past.
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const k = window.localStorage.key(i);
        if (k !== null && k.startsWith('ft.toasted.') && k !== ledgerKey) {
          window.localStorage.removeItem(k);
        }
      }
    } catch {
      // Private browsing, or storage disabled. A forgotten ledger costs one
      // repeat toast; a crash costs the console.
      stored = [];
    }
    ledger.current = new Set(stored);
  }

  const feedStale = data?.feedStale ?? false;
  const snapshot = useMemo<FleetSnapshot[]>(
    () =>
      all.map((row) => ({
        id: row.id,
        truckNumber: row.truckNumber,
        samsaraName: row.samsaraName,
        status: row.status,
        stopId: row.nextStop?.stopId ?? null,
        forced: row.override !== null,
      })),
    [all],
  );

  useEffect(() => {
    const found = detectToasts({
      previous: lastSeen.current,
      next: snapshot,
      feedStaleBefore: lastFeedStale.current,
      feedStaleNow: feedStale,
      alreadyToday: ledger.current ?? new Set<string>(),
    });

    lastSeen.current = new Map(snapshot.map((row) => [row.id, row]));
    lastFeedStale.current = feedStale;
    if (found.length === 0) return;

    for (const toast of found) ledger.current?.add(toast.id);
    try {
      window.localStorage.setItem(ledgerKey, JSON.stringify([...(ledger.current ?? [])]));
    } catch {
      // See above: the ledger is a convenience, never a correctness guarantee.
    }
    // Newest first, capped at the spec's three.
    setToasts((current) => [...found, ...current].slice(0, 3));
  }, [snapshot, feedStale, ledgerKey]);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

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
  /** §12.10: Enter opens the edit modal on the selected row. */
  const [editingId, setEditingId] = useState<string | null>(null);
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

  /**
   * The search box is debounced, so the URL follows the SETTLED query rather
   * than every keystroke. That makes this a genuine effect — it reacts to a
   * value changing over time, not to a render — and the guard keeps it from
   * writing when the URL already says what it would say.
   */
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

  /** §14 feature 10. The palette prints the selected truck's own label. */
  const selectedRow = useMemo(
    () => (selectedId ? (rows.find((r) => r.id === selectedId) ?? null) : null),
    [selectedId, rows],
  );

  const editingRow = useMemo(
    () => (editingId ? (rows.find((r) => r.id === editingId) ?? null) : null),
    [editingId, rows],
  );

  const filtered = useMemo(() => filterRows(rows, query), [rows, query]);
  const { ordered, drift, resort } = useDisplayOrder(
    filtered,
    'urgency',
    // §12.4: order recomputes on a filter or search change, never on a poll.
    `${query}|${[...chips].sort().join(',')}`,
  );

  /** Arrow keys move the selection and the map follows (§8.1). */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // §14.1. One guard, shared: the three copies of this check all missed
      // contenteditable.
      if (isTypingTarget(event.target)) return;
      // The modal owns the keyboard while it is open — Esc there raises the
      // discard confirm rather than clearing the console's selection.
      if (editingId) return;

      /**
       * §12.46. The ONLY Enter handler. The row no longer has one.
       *
       * Two cursors exist and can disagree: DOM focus, which Tab moves, and
       * `selectedId`, which a click or the arrow keys move. Enter means the
       * focused row when there is one, and the selection otherwise — and it
       * selects what it opens, so the map is never showing a different truck
       * from the modal.
       */
      if (event.key === 'Enter') {
        const focused = (event.target as HTMLElement | null)?.closest?.('[data-row-id]');
        const targetId = focused?.getAttribute('data-row-id') ?? selectedId;
        if (!targetId) return;
        event.preventDefault();
        if (targetId !== selectedId) select(targetId);
        setEditingId(targetId);
        return;
      }

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
  }, [ordered, selectedId, select, query, editingId]);

  /**
   * §14 feature 6. Which rows changed since the last poll.
   *
   * Reads the same `snapshot` the toasts do — one derivation of "what the
   * board looked like a poll ago", so the two can never disagree about which
   * trucks moved. What they do with it differs, and deliberately: see
   * `lib/flash`'s note on the three toast rules it drops.
   */
  const flashes = useRowFlash(snapshot, feedStale, reducedMotion);

  /**
   * Resolved once per poll rather than once per row. The dispatch zone and
   * the motion preference are both needed to format a flash and neither is
   * about a truck, so they stop here instead of reaching every row.
   */
  const flashViews = useMemo(() => {
    const views = new Map<string, RowFlashView>();
    for (const [id, flash] of flashes) {
      views.set(id, flashView(flash, dispatchTz, reducedMotion));
    }
    return views;
  }, [flashes, dispatchTz, reducedMotion]);
  const flashFor = useCallback((id: string) => flashViews.get(id) ?? null, [flashViews]);

  /**
   * §14 feature 8. Its own query on its own interval: the strip counts
   * arrivals, which happen a few times a shift, and the fleet poll is twenty
   * seconds. See `useFleetHealth`.
   */
  const { data: health } = useFleetHealth(initialHealth);

  /** §14 feature 5. Persisted, and bound to D. */
  const { density, setDensity } = useDensity();

  /**
   * §14 feature 2. A second cursor over the same list: `selectedId` drives
   * the map, this drives the bulk bar, and a row can be in either without the
   * other (§14.3).
   */
  /**
   * §14 feature 4. The pinned rows come OUT of the list rather than being
   * repeated at the top of it (§14.5). If they were in both places the fold
   * footer, the chip counts and "showing 1–20 of 23" would each have to
   * decide whether to count a pinned truck once or twice, and they would not
   * all decide the same way.
   */
  const pins = usePinned(selectedId);
  const pinnedRows = useMemo(
    () =>
      pins.pinned
        .map((id) => ordered.find((r) => r.id === id))
        .filter((r): r is FleetRow => r !== undefined),
    [pins.pinned, ordered],
  );
  const unpinnedRows = useMemo(
    () => ordered.filter((r) => !pins.isPinned(r.id)),
    [ordered, pins],
  );

  /**
   * §14 feature 7. Every count the decision needs exists here and nowhere
   * else: `all` before the chips, `rows` after them, `filtered` after the
   * search, and `unpinnedRows` after the pinned block took its share.
   */
  const empty = useMemo(
    () =>
      emptyState({
        total: all.length,
        afterChips: rows.length,
        afterSearch: filtered.length,
        listed: unpinnedRows.length,
        query,
        chipCount: chips.size,
      }),
    [all.length, rows.length, filtered.length, unpinnedRows.length, query, chips],
  );

  /**
   * §14 feature 11. A view is the chip set and the search term — the two
   * things that decide which trucks are on screen — and nothing else. Not the
   * selected truck, which is a cursor; not density or pins, which belong to a
   * person rather than to a slice of the fleet. See `lib/views`.
   */
  const viewState = useMemo(() => ({ query, chips: [...chips] }), [query, chips]);
  const savedViews = useSavedViews(viewState);

  const applyView = useCallback(
    (view: SavedView) => {
      // `setTyped`, not `setQuery`: the field is the source and the debounce
      // carries it through. Setting the derived value would leave the search
      // box showing the term the previous view was filtered by.
      setTyped(view.query);
      applyChips(viewChips(view));
    },
    [applyChips],
  );

  const saveView = useCallback(
    (name: string) => {
      const refusal = savedViews.save(name);
      return refusal === null ? null : refusalMessage(refusal, name);
    },
    [savedViews],
  );

  const onEmptyAction = useCallback(
    (action: EmptyAction) => {
      if (action === 'clear-chips') resetChips();
      // `setTyped`, not `setQuery`: the field is the source and the debounce
      // carries it through. Clearing the derived value alone would leave the
      // box still showing what it no longer filters by.
      else if (action === 'clear-search') setTyped('');
      else if (action === 'show-inactive') toggleChip('inactive');
    },
    [resetChips, toggleChip],
  );

  const orderedIds = useMemo(() => ordered.map((r) => r.id), [ordered]);
  const bulk = useBulkSelection(orderedIds);
  const [bulkAction, setBulkAction] = useState<'status' | 'note' | null>(null);

  /**
   * §14's `X` binding, and Esc's new first job.
   *
   * `X` checks the SELECTED row — the keyboard's way into a gesture the
   * design gave only to the mouse. Without it every binding that moves the
   * selection dead-ends at a checkbox needing a click.
   *
   * Esc clears the checks BEFORE the search and the selection, because the
   * checks are the most recently made state and the bar names the key. It
   * runs in the capture phase and stops there, so Console's own Esc handler
   * does not also clear the search in the same press.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (editingId) return;
      if ((event.key === 'x' || event.key === 'X') && selectedId) {
        event.preventDefault();
        bulk.toggle(selectedId, event.shiftKey);
        return;
      }
      if (event.key === 'Escape' && bulk.count > 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        bulk.clear();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [bulk, selectedId, editingId]);

  /** Bumped on split drag-end; the map reflows then and only then. */
  const [resizeSignal, setResizeSignal] = useState(0);
  const onResizeEnd = useCallback(() => setResizeSignal((n) => n + 1), []);

  return (
    /*
     * §14.5. One layer for the cheat sheet, the palette and the tour, so two
     * of them can never be on screen at once. The edit modal stays outside
     * it: it holds unsaved state and sits above, at z-40.
     */
    <OverlayProvider>
      <div className="flex h-dvh flex-col bg-surface-base">
        <ConsoleHeader
          rows={all}
          chips={chips}
          onToggleChip={toggleChip}
          onResetChips={resetChips}
          query={typed}
          onQueryChange={setTyped}
          matchCount={filtered.length}
          totalCount={rows.length}
          fetchedAt={data?.fetchedAt ?? null}
          feedNewestAt={data?.feedNewestAt ?? null}
          feedStale={feedStale}
          dispatchTz={dispatchTz}
          user={user}
          views={{
            saved: savedViews.views,
            active: savedViews.active,
            onApply: applyView,
            onSave: saveView,
            onRemove: savedViews.remove,
            // Nothing to save when the board already IS a saved view; the
            // save would only be refused as a duplicate a moment later.
            canSaveCurrent: savedViews.active === null,
          }}
        />

        {/**
         * §9.8. The half that makes §5.9's dimming legible: the board going
         * grey says something is wrong, and only this says what, since when,
         * and that an ETA read off this screen must not be quoted to a broker.
         */}
        {feedStale ? (
          <FeedBanner
            feedNewestAt={data?.feedNewestAt ?? null}
            fetchedAt={data?.fetchedAt ?? null}
            pollMs={FLEET_POLL_MS}
            dispatchTz={dispatchTz}
            onRetry={() => void refetch()}
            retrying={isFetching}
          />
        ) : null}

        {/*
          §14 feature 7. Distinct from the feed banner above and able to show
          alongside it: that one says the POSITIONS are old, this says the
          console stopped being able to ask. Different causes, different fixes.
        */}
        {isError ? (
          <FetchErrorBanner
            fetchedAt={data?.fetchedAt ?? null}
            dispatchTz={dispatchTz}
            pollMs={FLEET_POLL_MS}
            onRetry={() => void refetch()}
            retrying={isFetching}
          />
        ) : null}

        {missingTruck ? (
          <div className="flex shrink-0 items-center gap-3 border-b border-status-risk-bd bg-status-risk-bg px-4 py-2 text-body text-status-risk-fg">
            <span className="flex-1">
              Truck {missingTruck} is not in the active fleet — it may be inactive or the
              number may be wrong. Showing the whole fleet instead.
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

          {/*
            §14 feature 14. The toast stack anchors HERE, to the split area,
            not to the window: bottom-left belongs to the bulk bar now
            (§14.5), and the replacement is "the map's top-right". On a wide
            screen that is the right pane; below 1086px the map becomes a
            toggle and this is the only box that is the visible pane either
            way. Fixed to the viewport it would float over the header instead.
          */}
          <div className="relative flex min-h-0 flex-1 flex-col">
            <Split
              onResizeEnd={onResizeEnd}
              list={
                <div className="flex h-full flex-col">
                  {/* §14.5: the strip is read with the list, not the header. */}
                  <ListToolbar density={density} onDensity={setDensity} health={health} />
                  <FleetList
                    density={density}
                    checked={bulk.checked}
                    onCheck={bulk.toggle}
                    pinnedRows={pinnedRows}
                    flashFor={flashFor}
                    reducedMotion={reducedMotion}
                    isPinned={pins.isPinned}
                    onPin={pins.toggle}
                    pinRefused={pins.refused}
                    bulk={{
                      barOpen: bulk.barOpen,
                      onForceStatus: () => setBulkAction('status'),
                      onAddNote: () => setBulkAction('note'),
                      onClear: bulk.clear,
                    }}
                    rows={unpinnedRows}
                    fetchedAt={data?.fetchedAt ?? null}
                    feedStale={data?.feedStale ?? false}
                    selectedId={selectedId}
                    query={query}
                    empty={empty}
                    onEmptyAction={onEmptyAction}
                    drift={drift}
                    onResort={resort}
                    onSelect={select}
                    onEdit={setEditingId}
                  />
                </div>
              }
              map={
                <FleetMap
                  rows={filtered}
                  fetchedAt={data?.fetchedAt ?? null}
                  feedStale={data?.feedStale ?? false}
                  selectedId={selectedId}
                  onSelect={select}
                  onEdit={setEditingId}
                  resizeSignal={resizeSignal}
                  reducedMotion={reducedMotion}
                />
              }
            />

            <Toasts
              toasts={toasts}
              onOpen={(truckId) => {
                select(truckId);
                setEditingId(truckId);
              }}
              onExpire={dismissToast}
              reducedMotion={reducedMotion}
            />
          </div>
        </div>

        {editingRow ? (
          <EditStopModal
            row={editingRow}
            drivers={drivers}
            role={role}
            dispatchTz={dispatchTz}
            onClose={() => setEditingId(null)}
          />
        ) : null}

        {bulkAction ? (
          <BulkActionModal
            action={bulkAction}
            rows={ordered}
            checked={bulk.checked}
            onDone={() => {
              setBulkAction(null);
              // The checks go with the act. Leaving them would invite the same
              // override to be applied twice to the same trucks.
              bulk.clear();
            }}
            onClose={() => setBulkAction(null)}
          />
        ) : null}

        {/*
          §14 feature 10. Inside the provider, and it builds its own action
          list: "Show keyboard shortcuts" is a move on the overlay layer, and
          the layer is only reachable from within its own provider — which
          Console renders and therefore cannot read.
        */}
        <CommandPalette
          trucks={ordered}
          views={savedViews.views}
          selectedLabel={
            selectedRow === null
              ? null
              : `Truck ${selectedRow.truckNumber ?? selectedRow.samsaraName}`
          }
          selectedPinned={selectedId !== null && pins.isPinned(selectedId)}
          density={density}
          onSelectTruck={select}
          onApplyView={applyView}
          onTogglePin={() => {
            if (selectedId) pins.toggle(selectedId);
          }}
          onToggleDensity={() => setDensity(nextDensity(density))}
        />

        <ShortcutSheet />
      </div>
    </OverlayProvider>
  );
}
