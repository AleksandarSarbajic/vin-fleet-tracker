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
import { ConsoleHeader, type HeaderNote } from './ConsoleHeader';
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
import { OnboardingTour } from '@/components/overlay/OnboardingTour';
import { useDensity } from '@/hooks/useDensity';
import { nextDensity } from '@/lib/density';
import { ListToolbar } from './ListToolbar';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { BulkActionModal } from './BulkActionModal';
import { usePinned } from '@/hooks/usePinned';
import { TruckTimeline } from './TruckTimeline';
import { useRowFlash } from '@/hooks/useRowFlash';
import { FetchErrorBanner } from './FetchErrorBanner';
import { emptyState, type EmptyAction } from '@/lib/empty-state';
import { useFleetHealth } from '@/hooks/useFleetHealth';
import type { FleetHealth } from '@/server/health';
import { flashView, type RowFlashView } from '@/lib/flash';
import { can } from '@/lib/roles';
import {
  outsideList,
  outsideListShort,
  outsideListText,
  scopeToList,
  type TruckList,
} from '@/lib/truck-lists';
import { useTruckLists } from '@/hooks/useTruckLists';
import { TruckListEditor, type EditorMode } from './TruckListEditor';
import { AddToListModal } from './AddToListModal';
import { useEditingAllowed } from '@/hooks/useEditingAllowed';
import { editingAllowedNow } from '@/lib/editing';
import { useResumeRefetch } from '@/hooks/useResumeRefetch';
import { PhoneTopBar } from './phone/PhoneTopBar';
import { PhoneNotes, PhoneTiles } from './phone/PhoneTiles';
import { PhoneMoreSheet } from './phone/PhoneMoreSheet';
import { PhoneCardList } from './phone/PhoneCardList';
import { TruckSheet } from './phone/TruckSheet';
import { dialableTel } from '@/lib/dial';
import { isPhoneNow } from '@/lib/phone';

/**
 * Stable identity, so an empty fleet does not churn every memo downstream.
 * Typed as FleetRow[] because it only ever stands in for one.
 */
const NO_ROWS: FleetRow[] = [];
const NO_LISTS: TruckList[] = [];

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
  /** §12.90. The shared lists, server-rendered so a list link paints filtered. */
  initialLists?: TruckList[];
  /** §12.90. `?list=<id>` — by id, so renaming a list does not break links. */
  initialList?: string | null;
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
  initialLists = NO_LISTS,
  initialList = null,
  drivers,
  role,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();

  /** Search and selection both live in the URL so a link carries the view. */
  const syncUrl = useCallback(
    (next: { q?: string; truck?: string | null; chips?: FilterKey[]; list?: string | null }) => {
      const search = new URLSearchParams(window.location.search);
      if (next.list !== undefined) {
        if (next.list) search.set('list', next.list);
        else search.delete('list');
      }
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
   * §12.96. Back from the background: refetch now, and say so until it
   * lands. The phone's top bar shows the marker; the desktop draws nothing
   * new, and the refetch joins the one React Query sends on focus anyway.
   */
  const updating = useResumeRefetch(refetch);
  /**
   * Every truck, inactive included, so the Inactive chip (§12.14) has
   * something to filter to. The default view is active only — applied on the
   * real column in `passesFilters`, not hidden inside the chip.
   */
  const all = useMemo(() => data?.fleet ?? NO_ROWS, [data]);

  /* ----------------------------- shared lists (§12.90) ------------------- */

  const { data: lists = initialLists } = useTruckLists(initialLists);
  const [listId, setListId] = useState<string | null>(initialList);
  /** Said, never silent: the list in the link, or the one on screen, is gone. */
  const [listNotice, setListNotice] = useState<{ text: string; warn: boolean } | null>(null);
  const activeList = useMemo(
    () => (listId === null ? null : (lists.find((l) => l.id === listId) ?? null)),
    [lists, listId],
  );

  const applyList = useCallback(
    (id: string | null) => {
      setListId(id);
      setListNotice(null);
      syncUrl({ list: id });
    },
    [syncUrl],
  );

  /**
   * A list that is not there any more — a link to a deleted list, or the list
   * on screen deleted by someone else and gone from the next poll. The board
   * falls back to the full fleet and says so; it is never left blank.
   */
  useEffect(() => {
    if (listId === null || activeList !== null) return;
    setListId(null);
    setListNotice({ text: 'This list no longer exists — showing the full fleet.', warn: true });
    syncUrl({ list: null });
  }, [listId, activeList, syncUrl]);

  /**
   * The list scopes the board FIRST; the chips and the search then narrow it
   * (list AND chips AND search). The chip counts are taken over `scoped` too
   * (§12.8), so a chip reading N shows N rows with the list on; what the
   * list leaves out that matters is said in the header (`outside`).
   */
  const members = useMemo(
    () => (activeList ? new Set(activeList.truckIds) : null),
    [activeList],
  );
  const scoped = useMemo(() => scopeToList(all, members), [all, members]);
  /** §12.8. Late and Unassigned trucks the list is not showing, or null. */
  const outside = useMemo(() => outsideList(all, members), [all, members]);

  /**
   * Nothing selected means "active trucks, any status" (§12.9). The filter
   * runs over the real `active` column rather than being special-cased inside
   * the Inactive chip.
   */
  const rows = useMemo(
    () => scoped.filter((row) => passesFilters(row, chips)),
    [scoped, chips],
  );

  /**
   * §12.90. A list's inactive trucks follow the Inactive chip rule like any
   * other — hidden unless that chip is on — and the header says how many, so
   * a truck in the list is never missing without a word.
   */
  const listInactiveHidden = useMemo(
    () =>
      activeList && !chips.has('inactive') ? scoped.filter((row) => !row.active).length : 0,
    [activeList, chips, scoped],
  );
  /** The list's size as the default rule shows it: its active trucks. */
  const listShown = useMemo(() => scoped.filter((row) => row.active).length, [scoped]);

  const canEditLists = can(role, 'dispatcher');
  const [listEditor, setListEditor] = useState<EditorMode | null>(null);
  const [addingToList, setAddingToList] = useState(false);

  /**
   * §12.78. How many trucks Drivers only is hiding RIGHT NOW: the rows the
   * other chips let through that it then took out. Said in the list header,
   * so a hidden truck is never hidden silently.
   */
  const hiddenDriverless = useMemo(() => {
    if (!chips.has('drivers')) return 0;
    const without = new Set([...chips].filter((k) => k !== 'drivers'));
    return scoped.filter((row) => passesFilters(row, without)).length - rows.length;
  }, [scoped, chips, rows.length]);

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
  /**
   * Counts selections, so the map can pan when the SAME truck is selected
   * again — clicking the row of the already-selected truck is a request to
   * see it, and the id alone does not change to say so.
   */
  const [panRequest, setPanRequest] = useState(0);
  /** §12.10: Enter opens the edit modal on the selected row. */
  const [editingId, setEditingId] = useState<string | null>(null);
  /**
   * §12.94. Editing is a desktop job: below 768px nothing opens the Edit
   * Stop modal (and so Clear stop) or the bulk edits. Every route goes
   * through `openEditor`, which asks the width at the moment it is called.
   */
  const editingAllowed = useEditingAllowed();
  const openEditor = useCallback((id: string) => {
    if (editingAllowedNow()) setEditingId(id);
  }, []);
  /** §14 feature 15. Read-only, so it needs no dirty state and no confirm. */
  const [timelineId, setTimelineId] = useState<string | null>(null);
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
      if (id !== null) setPanRequest((n) => n + 1);
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

  const timelineRow = useMemo(
    () => (timelineId ? (rows.find((r) => r.id === timelineId) ?? null) : null),
    [timelineId, rows],
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
        openEditor(targetId);
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
  }, [ordered, selectedId, select, query, editingId, openEditor]);

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
        total: scoped.length,
        afterChips: rows.length,
        afterSearch: filtered.length,
        listed: unpinnedRows.length,
        query,
        chipCount: chips.size,
      }),
    [scoped.length, rows.length, filtered.length, unpinnedRows.length, query, chips],
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
   * §12.94. A window narrowed below the editing width while an editor is open
   * closes it: the trap the rule exists to prevent is an editor on a screen
   * too narrow to save or cancel it. Unsaved edits in it are lost, which only
   * a desktop window shrunk mid-edit can meet.
   */
  useEffect(() => {
    if (editingAllowed) return;
    setEditingId(null);
    setBulkAction(null);
  }, [editingAllowed]);

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

  /* ------------------------- the header's scope (§12.91) ---------------- */

  const fleetCount = useMemo(() => all.filter((row) => row.active).length, [all]);
  /**
   * What the scope button counts: a view's rows when a view is on (within
   * the list, if there is one), else the list's trucks, else the fleet's.
   * Never "4 of 12" — the chips and the footer's "of N" carry the narrowing.
   */
  const scopeCount = savedViews.active
    ? filtered.length
    : activeList
      ? listShown
      : fleetCount;
  const viewCount = useCallback(
    (view: SavedView) => {
      const set = new Set(viewChips(view));
      return filterRows(
        scoped.filter((row) => passesFilters(row, set)),
        view.query,
      ).length;
    },
    [scoped],
  );
  /** × on the scope button: a list keeps the chips; a view resets chips and search. */
  const clearScope = useCallback(() => {
    if (savedViews.active) {
      resetChips();
      setTyped('');
    }
    if (activeList) applyList(null);
  }, [savedViews.active, activeList, resetChips, applyList]);

  /** Row 2's notes (§12.91): nothing hidden without a word, each undoes itself. */
  const headerNotes = useMemo((): HeaderNote[] => {
    const notes: HeaderNote[] = [];
    if (listInactiveHidden > 0) {
      notes.push({
        id: 'inactive',
        text: `${listInactiveHidden} inactive hidden`,
        short: `${listInactiveHidden} inactive hidden`,
        tone: 'quiet',
        title: 'Inactive trucks are hidden unless the Inactive chip is on. Click to show them.',
        onClick: () => toggleChip('inactive'),
      });
    }
    if (outside) {
      notes.push({
        id: 'outside',
        text: outsideListText(outside),
        short: outsideListShort(outside),
        tone: 'warn',
        title: 'The chips count this list only. Click to show the full fleet.',
        onClick: () => applyList(null),
      });
    }
    if (chips.has('drivers')) {
      notes.push({
        id: 'drivers',
        text: `${hiddenDriverless} without a driver hidden`,
        short: `${hiddenDriverless} no-driver hidden`,
        tone: 'quiet',
        title:
          'Drivers only is on. Trucks with no driver AND no live appointment are hidden; an Unassigned truck is always shown. Click to show them.',
        onClick: () => toggleChip('drivers'),
      });
    }
    return notes;
  }, [listInactiveHidden, outside, chips, hiddenDriverless, toggleChip, applyList]);

  /** §12.96. The phone's More sheet: the filters, Today and density off the first screen. */
  const [moreOpen, setMoreOpen] = useState(false);

  /** The scope menu's lists and views, for the desktop header and the phone's top bar. */
  const headerViews = {
    saved: savedViews.views,
    active: savedViews.active,
    onApply: applyView,
    onSave: saveView,
    onRemove: savedViews.remove,
    onRename: (id: string, name: string) => {
      const refusal = savedViews.rename(id, name);
      return refusal === null ? null : refusalMessage(refusal, name);
    },
    // Nothing to save when the board already IS a saved view; the
    // save would only be refused as a duplicate a moment later.
    canSaveCurrent: savedViews.active === null,
    lists: {
      items: lists,
      activeId: activeList?.id ?? null,
      canEdit: canEditLists,
      onApply: applyList,
      onNew: () =>
        setListEditor({
          kind: 'create',
          initialIds: [],
        }),
      onEdit: (id: string) => {
        const list = lists.find((l) => l.id === id);
        if (list) setListEditor({ kind: 'edit', list });
      },
    },
  };

  /** Bumped on split drag-end; the map reflows then and only then. */
  const [resizeSignal, setResizeSignal] = useState(0);
  const onResizeEnd = useCallback(() => setResizeSignal((n) => n + 1), []);

  /**
   * §12.96, stage 2. The phone's List | Map tabs, list first. The map stays
   * mounted behind its tab (Split hides it with CSS), so showing it asks it
   * to measure again, the same signal a split drag sends.
   */
  const [phonePane, setPhonePane] = useState<'list' | 'map'>('list');
  const showPane = useCallback(
    (pane: 'list' | 'map') => {
      setPhonePane(pane);
      if (pane === 'map') onResizeEnd();
    },
    [onResizeEnd],
  );
  /**
   * §12.96, stage 3. The phone's truck sheet, in place of the map popup: a
   * card's tap opens it over the list, a marker's over the map.
   */
  const [sheetOpen, setSheetOpen] = useState(false);
  const tapCard = useCallback(
    (id: string) => {
      select(id);
      setSheetOpen(true);
    },
    [select],
  );
  /**
   * The map's own selection. On a phone a marker's tap opens the sheet; at
   * 768px and up nothing changes — the popup is the map's, as before. Asked
   * at the moment of the tap, the way the editing rule is (§12.94).
   */
  const selectFromMap = useCallback(
    (id: string | null) => {
      select(id);
      if (id !== null && isPhoneNow()) setSheetOpen(true);
    },
    [select],
  );
  /** "Show on map": the sheet steps aside and the map pans to the truck. */
  const showOnMap = useCallback(
    (id: string) => {
      setSheetOpen(false);
      showPane('map');
      // Selecting again asks the map to pan, even to the truck already selected.
      select(id);
    },
    [select, showPane],
  );
  /** The phone lists every truck in order, pinned ones in place: it has no pinned block. */
  const phoneEmpty = useMemo(
    () =>
      emptyState({
        total: scoped.length,
        afterChips: rows.length,
        afterSearch: filtered.length,
        listed: ordered.length,
        query,
        chipCount: chips.size,
      }),
    [scoped.length, rows.length, filtered.length, ordered.length, query, chips],
  );

  return (
    /*
     * §14.5. One layer for the cheat sheet, the palette and the tour, so two
     * of them can never be on screen at once. The edit modal stays outside
     * it: it holds unsaved state and sits above, at z-40.
     */
    <OverlayProvider>
      {/*
        `overflow-hidden` states the rule — the shell is exactly the viewport
        and never scrolls as a page — but it is NOT the fix, and must not be
        read as one.

        Measured: with the two structural fixes reverted and only this in
        place, the page-scroll symptom disappears while the list still cannot
        scroll and the map still overflows its pane. That is a worse state
        than the bug it appears to cure, because the rows below the fold
        become unreachable instead of merely awkward.

        The fix is `grid-rows-[minmax(0,1fr)]` in Split.tsx and `min-h-0` on
        the wrapper below, either of which is sufficient on its own. This line
        is the statement of intent, and `e2e/layout.spec.ts` asserts the real
        property — that the LIST scrolls and the MAP stays bounded — so a
        future structural break fails a test rather than hiding behind this.
      */}
      <div className="flex h-dvh flex-col overflow-hidden bg-surface-base">
        <ConsoleHeader
          rows={scoped}
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
          scope={{ count: scopeCount, fleetCount, viewCount, onClear: clearScope }}
          notes={headerNotes}
          selected={selectedId !== null}
          views={headerViews}
        />

        {/*
          §12.96, stage 1. The phone's own top bar, tiles and notes: `md:hidden`
          each, beside the desktop header (`max-md:hidden`). The server sends
          both and CSS shows one. They read and write the same state as the
          desktop's, and handle no keys.
        */}
        <PhoneTopBar
          query={typed}
          onQueryChange={setTyped}
          matchCount={filtered.length}
          totalCount={rows.length}
          fetchedAt={data?.fetchedAt ?? null}
          feedNewestAt={data?.feedNewestAt ?? null}
          feedStale={feedStale}
          updating={updating}
          user={user}
          views={headerViews}
          scope={{ count: scopeCount, fleetCount, viewCount, onClear: clearScope }}
        />
        <PhoneTiles
          rows={scoped}
          chips={chips}
          onToggle={toggleChip}
          onReset={resetChips}
          onMore={() => setMoreOpen(true)}
          moreOpen={moreOpen}
          pane={phonePane}
          onPane={showPane}
        />
        <PhoneNotes notes={headerNotes} />
        {sheetOpen && selectedRow ? (
          <TruckSheet
            row={selectedRow}
            fetchedAt={data?.fetchedAt ?? null}
            feedStale={feedStale}
            // The number from the drivers list the console already holds, by
            // the truck its driver is on: no new data reaches the browser.
            tel={dialableTel(drivers.find((d) => d.truckId === selectedRow.id)?.phone)}
            onClose={() => setSheetOpen(false)}
            onTimeline={setTimelineId}
            onShowOnMap={showOnMap}
          />
        ) : null}
        {moreOpen ? (
          <PhoneMoreSheet
            rows={scoped}
            chips={chips}
            onToggle={toggleChip}
            health={health}
            density={density}
            onDensity={setDensity}
            onClose={() => setMoreOpen(false)}
          />
        ) : null}

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

        {listNotice ? (
          <div
            role="status"
            data-list-notice=""
            className={`flex shrink-0 items-center gap-3 border-b px-4 py-2 text-body ${
              listNotice.warn
                ? 'border-status-risk-bd bg-status-risk-bg text-status-risk-fg'
                : 'border-status-neutral-bd bg-status-neutral-bg text-text'
            }`}
          >
            <span className="flex-1">{listNotice.text}</span>
            <button
              type="button"
              onClick={() => setListNotice(null)}
              className="font-cond text-micro uppercase tracking-[.08em] text-text"
            >
              Dismiss
            </button>
          </div>
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

        {/*
          §12.91. The list-title row that sat here ("Fleet — list: Bob's
          trucks — 4 of 12 trucks · …") is gone: the scope button names the
          list and the view, and its notes moved to the header's row 2.
        */}
        <div className="flex min-h-0 flex-1 flex-col">
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
              phonePane={phonePane}
              /*
               * `min-h-0` beside `h-full` on the wrapper below.
               *
               * §14 feature 5 introduced that wrapper to sit the density
               * toolbar above the list. A flex child's default
               * `min-height: auto` refuses to shrink below its content, so
               * FleetList's own `flex-1 overflow-y-auto` resolved against an
               * unbounded height and grew to 1,920px instead of scrolling.
               * The scroll container was there the whole time; it simply
               * never had a height it was required to stay inside.
               */
              list={
                <div className="flex h-full min-h-0 flex-col">
                  {/* §14.5: the strip is read with the list, not the header. */}
                  <ListToolbar density={density} onDensity={setDensity} health={health} />
                  {/* §12.96: below 768px the cards stand in for it. `contents`
                      gives the wrapper no box of its own at 768 and up. */}
                  <div className="contents max-md:hidden">
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
                        onForceStatus: editingAllowed ? () => setBulkAction('status') : null,
                        onAddNote: editingAllowed ? () => setBulkAction('note') : null,
                        ...(canEditLists ? { onAddToList: () => setAddingToList(true) } : {}),
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
                      onEdit={editingAllowed ? openEditor : null}
                    />
                  </div>
                  <PhoneCardList
                    rows={ordered}
                    selectedId={selectedId}
                    feedStale={feedStale}
                    fetchedAt={data?.fetchedAt ?? null}
                    reducedMotion={reducedMotion}
                    empty={phoneEmpty}
                    onTap={tapCard}
                  />
                </div>
              }
              map={
                <FleetMap
                  rows={filtered}
                  fetchedAt={data?.fetchedAt ?? null}
                  feedStale={data?.feedStale ?? false}
                  selectedId={selectedId}
                  panRequest={panRequest}
                  onSelect={selectFromMap}
                  onEdit={editingAllowed ? openEditor : null}
                  onTimeline={setTimelineId}
                  resizeSignal={resizeSignal}
                  sheetOpen={sheetOpen && selectedRow !== null}
                  reducedMotion={reducedMotion}
                />
              }
            />

            <Toasts
              toasts={toasts}
              onOpen={(truckId) => {
                select(truckId);
                // Below the editing width a toast shows the truck, nothing more.
                openEditor(truckId);
              }}
              onExpire={dismissToast}
              reducedMotion={reducedMotion}
            />
          </div>
        </div>

        {timelineRow ? (
          <TruckTimeline
            truckId={timelineRow.id}
            truckLabel={String(timelineRow.truckNumber ?? timelineRow.samsaraName)}
            dispatchTz={dispatchTz}
            onClose={() => setTimelineId(null)}
          />
        ) : null}

        {editingRow && editingAllowed ? (
          <EditStopModal
            row={editingRow}
            drivers={drivers}
            role={role}
            dispatchTz={dispatchTz}
            onClose={() => setEditingId(null)}
          />
        ) : null}

        {bulkAction && editingAllowed ? (
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

        {listEditor ? (
          <TruckListEditor
            mode={listEditor}
            fleet={all}
            checkedIds={ordered.filter((r) => bulk.checked.has(r.id)).map((r) => r.id)}
            canEdit={canEditLists}
            onClose={() => setListEditor(null)}
            onSaved={(id, created) => {
              setListEditor(null);
              // A new list is shown at once; an edited one stays as it was.
              if (created && id) applyList(id);
            }}
            onDeleted={(id) => {
              setListEditor(null);
              // Our own delete: back to the fleet quietly, not "no longer exists".
              if (listId === id) applyList(null);
            }}
          />
        ) : null}

        {addingToList ? (
          <AddToListModal
            trucks={ordered.filter((r) => bulk.checked.has(r.id))}
            lists={lists}
            onClose={() => setAddingToList(false)}
            onDone={(message) => {
              setAddingToList(false);
              bulk.clear();
              // A confirmation, not a warning: neutral, not the risk amber.
              setListNotice({ text: message, warn: false });
            }}
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
        <OnboardingTour />
      </div>
    </OverlayProvider>
  );
}
