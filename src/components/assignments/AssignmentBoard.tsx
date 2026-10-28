'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Role } from '@/lib/roles';
import { can } from '@/lib/roles';
import { CONFLICT_HEADLINE, type AssignmentConflict } from '@/lib/assignments';
import { isTypingTarget } from '@/lib/keymap';
import type { AssignmentBoard as Board } from '@/server/assignments';
import { DriverSelect, type DriverSelectHandle } from './DriverSelect';
import { DriverName, NoEldTag } from '@/components/DriverName';
import { isEldBacked } from '@/lib/driver';
import { MergePrompt } from './MergePrompt';
import { DriverPhone } from './DriverPhone';
import {
  BOARD_FILTERS,
  filterCounts,
  inFilter,
  matchesSearch,
  sharedPhones,
  type BoardFilter,
  type BoardRow,
} from './boardView';
import { LockIcon, SearchIcon, WarningIcon } from './icons';
import { formatPhone } from '@/lib/dial';
import { useFleet, type FleetResponse } from '@/hooks/useFleet';
import { Currently } from './Currently';

/**
 * Day-one data entry, and the screen a dispatcher returns to whenever the
 * board drifts.
 *
 * Samsara returns `data: null` for driver-vehicle assignments in this org, so
 * nothing can be seeded: all 23 pairs are typed here once. Both sides are on
 * screen — trucks without drivers and drivers without trucks — because the
 * gaps are the whole point.
 *
 * Not in the design document. It exists because the data does not.
 */

interface Props {
  board: Board;
  role: Role;
  /**
   * §12.145. The console's fleet, loaded with the board, then polled by the
   * console's own hook. Only "Currently" reads it.
   */
  initialFleet: FleetResponse;
}

const label = (t: Board['trucks'][number]) =>
  t.truckNumber === null ? t.samsaraName : String(t.truckNumber);

/**
 * The table's columns, shared by its header and every row (§12.131, §12.135,
 * §12.140, §12.145).
 *
 * Truck, driver, ELD, the driver's phone, Currently. The ELD column holds the
 * `No ELD` tag that sat inside the picker's field (§12.129). Currently is the
 * truck's live chip and position, and takes the slack.
 *
 * Minimums, each for a reason:
 * - the picker's 240 holds an empty row's 104px field, its 8px gap and
 *   "+ Assign driver" (92px);
 * - the phone keeps 220 for its inline editor (field, Save, Cancel), and is
 *   capped at 260;
 * - Currently's 120 holds the widest chip whole, a forced one ("Arrived ·
 *   forced", 111px; the widest unforced is "Tomorrow", 79px). Its position
 *   truncates, with the whole of it on hover.
 *
 * With 4 gaps of 16 and the rows' 3px edge, that is 775. The widths below
 * come from measuring the chips in the built Barlow Condensed. The column
 * pixel figures are worked out from the grid's rules: free space goes to the
 * picker (up to 360) and the phone (up to 260) before Currently's 1fr gets
 * any.
 * - 1440 and up: the table is capped at 1000 (the section's `max-w`).
 *   Picker 360, phone 260, Currently 185.
 * - 1280: the panels sit beside the table, which is 960 wide. Currently is
 *   145.
 * - 1100: the table is 780 wide. The picker and phone are near their
 *   minimums and Currently is 120: the chip whole, the position cut.
 * - 1024: the panels sit above the table (§12.132), which is 984 wide.
 *   Currently is 169.
 * - Below 840 it does not fit. At 768 the table is 728 wide, 47 short of 775,
 *   so Currently is hidden and the row is the four columns it was (639).
 *   Nothing else gives way: none of the minimums above has 47px to spare.
 *   The console shows the same chip.
 *
 * 3al settled the picker on screen: flexible, it ran 845px wide at 1920, so
 * it is capped at 360; and from 1100px up the whole table is capped at
 * 1000px so its rows stop where their content does.
 */
const COLUMNS =
  'grid-cols-[64px_minmax(240px,360px)_64px_minmax(220px,1fr)] min-[840px]:grid-cols-[64px_minmax(240px,360px)_64px_minmax(220px,260px)_minmax(120px,1fr)]';
/** §12.145: where Currently has its 120px (above); below, hidden. */
const CURRENTLY_SHOWN = 'hidden min-[840px]:flex';

/** "124 and 130", "124, 130 and 138". */
function listed(labels: string[]): string {
  return labels.length < 2
    ? (labels[0] ?? '')
    : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

export function AssignmentBoard({ board, role, initialFleet }: Props) {
  const router = useRouter();

  /**
   * §12.145. The console's poll, the same hook and the same 20s. When a
   * refresh brings this page a newer fleet than the last poll (a save, a
   * retire, a new driver), the newer one is shown, so Currently follows the
   * saved assignment at once rather than at the next poll. No second status
   * engine, no request of its own.
   */
  const polled = useFleet(initialFleet).data;
  const fleet = polled.fetchedAt >= initialFleet.fetchedAt ? polled : initialFleet;
  const live = useMemo(() => new Map(fleet.fleet.map((row) => [row.id, row])), [fleet.fleet]);
  const mayEdit = can(role, 'dispatcher');
  const lockedReason = `Your role is ${role}. Assignments need dispatcher.`;

  const initial = useMemo(
    () => new Map(board.trucks.map((t) => [t.id, t.driverId])),
    [board.trucks],
  );
  const [draft, setDraft] = useState<Map<string, string | null>>(initial);

  /**
   * Which trucks the dispatcher has touched since the last save (§12.38).
   *
   * A ref, not state: it must not itself trigger the rebase below, and it is
   * read at the moment new server data arrives rather than rendered.
   */
  const edited = useRef<Set<string>>(new Set());
  const [conflicts, setConflicts] = useState<AssignmentConflict[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  /**
   * REBASE, not reset (§12.38).
   *
   * This was `setDraft(initial)`, which threw away every local edit whenever
   * new server data arrived — and `router.refresh()` resolves BEFORE the new
   * props land, so anything edited in that gap was silently lost. It is how
   * "Add and assign" created a driver and left the truck empty, and the same
   * race sits behind every other refresh on this board: retiring a driver
   * refreshes, and would have wiped a half-finished set of assignments with
   * no warning and no error.
   *
   * So server data becomes the new base, and the dispatcher's own edits are
   * replayed on top. Their pending change wins over a concurrent one; the
   * save's conflict detection is what adjudicates that, not a silent
   * overwrite here.
   */
  useEffect(() => {
    setDraft((current) => {
      const next = new Map(initial);
      for (const truckId of edited.current) {
        // A truck that has left the board cannot be rebased onto it.
        if (next.has(truckId) && current.has(truckId)) {
          next.set(truckId, current.get(truckId) ?? null);
        }
      }
      return next;
    });
  }, [initial]);

  /** Every local edit goes through here, so the rebase knows what to keep. */
  const editDraft = useCallback((truckId: string, driverId: string | null) => {
    edited.current.add(truckId);
    setDraft((d) => new Map(d).set(truckId, driverId));
  }, []);

  /** After a save or a discard, the server IS the truth again. */
  const clearEdits = useCallback(() => {
    edited.current = new Set();
  }, []);

  /**
   * Every truck, in the draft. The save below reads `board.trucks` and never
   * this list's filtered view: a changed row the search or a tab hides is
   * still counted in the footer and still saved (§12.137).
   */
  const changed = useMemo(
    () => board.trucks.filter((t) => (draft.get(t.id) ?? null) !== t.driverId),
    [board.trucks, draft],
  );
  const dirty = changed.length > 0;

  /** Dirty-state guard. A closed tab is a lost shift of data entry. */
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /** Which truck each driver is on IN THE DRAFT — shown inside the picker. */
  const claimedBy = useMemo(() => {
    const map = new Map<string, string>();
    for (const truck of board.trucks) {
      const driverId = draft.get(truck.id) ?? null;
      if (driverId) map.set(driverId, label(truck));
    }
    return map;
  }, [board.trucks, draft]);

  /**
   * The same rule the server enforces, run early so Save can refuse first.
   * Grouped by driver, so the footer can say WHICH trucks share one: "a
   * driver is on two trucks" sent the dispatcher hunting down 22 rows.
   */
  const doubleBookedGroups = useMemo(() => {
    const byDriver = new Map<string, Board['trucks']>();
    for (const truck of board.trucks) {
      const driverId = draft.get(truck.id) ?? null;
      if (!driverId) continue;
      byDriver.set(driverId, [...(byDriver.get(driverId) ?? []), truck]);
    }
    return [...byDriver.values()].filter((trucks) => trucks.length > 1);
  }, [board.trucks, draft]);
  const doubleBooked = useMemo(
    () => new Set(doubleBookedGroups.flat().map((t) => t.id)),
    [doubleBookedGroups],
  );

  /** Something to send, that the server's one-driver-one-truck rule will not refuse. */
  const savable = mayEdit && dirty && !saving && doubleBooked.size === 0;

  const conflictedTrucks = useMemo(
    () => new Set([...doubleBooked, ...conflicts.flatMap((c) => c.truckIds)]),
    [doubleBooked, conflicts],
  );

  const save = useCallback(async () => {
    setSaving(true);
    setFailure(null);
    setSaved(null);
    setConflicts([]);
    try {
      const response = await fetch('/api/assignments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          changes: changed.map((t) => ({
            truckId: t.id,
            driverId: draft.get(t.id) ?? null,
          })),
        }),
      });

      if (response.status === 409) {
        const body = (await response.json()) as { conflicts: AssignmentConflict[] };
        // Nothing was written. Every conflict, not the first.
        setConflicts(body.conflicts);
        return;
      }
      if (!response.ok) {
        const body = (await response.json()) as { error?: string; reference?: string };
        setFailure(
          `${body.error ?? 'The save failed.'}${body.reference ? ` (${body.reference})` : ''}`,
        );
        return;
      }

      const result = (await response.json()) as {
        assigned: number;
        cleared: number;
        unchanged: number;
      };
      setSaved(
        `Saved — ${result.assigned} assigned, ${result.cleared} cleared` +
          `${result.unchanged ? `, ${result.unchanged} unchanged` : ''}.`,
      );
      // Saved, so the server is the truth again and the rebase has nothing
      // to preserve.
      clearEdits();
      router.refresh();
    } catch (error: unknown) {
      setFailure(error instanceof Error ? error.message : 'The save failed.');
    } finally {
      setSaving(false);
    }
  }, [changed, draft, router, clearEdits]);

  /** Cmd/Ctrl+Enter saves, as everywhere else that writes (§8.1). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && dirty && mayEdit && !saving) {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, mayEdit, saving, save]);

  const driversWithoutTruck = board.drivers.filter((d) => !claimedBy.has(d.id));
  const driversById = useMemo(
    () => new Map(board.drivers.map((d) => [d.id, d])),
    [board.drivers],
  );

  /**
   * §12.137. The search and the tabs only choose which rows are on screen.
   * They are worked out from the draft (what the dispatcher sees), and
   * neither touches the draft or the save.
   */
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<BoardFilter>('all');
  const searchField = useRef<HTMLInputElement>(null);
  /** Each row's picker, so its "+ Assign driver" can open it (§12.139). */
  const pickers = useRef(new Map<string, DriverSelectHandle>());
  const rows = useMemo<BoardRow[]>(
    () =>
      board.trucks.map((truck) => {
        const driverId = draft.get(truck.id) ?? null;
        return {
          truck,
          label: label(truck),
          driverId,
          driver: driverId === null ? null : (driversById.get(driverId) ?? null),
        };
      }),
    [board.trucks, draft, driversById],
  );
  /** §12.138: by DRIVER. A double-booked driver is one person with one phone. */
  const sharedGroups = useMemo(() => sharedPhones(board.drivers), [board.drivers]);
  const sharedDriverIds = useMemo(
    () => new Set([...sharedGroups.values()].flat().map((d) => d.id)),
    [sharedGroups],
  );
  /** Every truck a driver is on in the draft (a double-booked one is on two). */
  const trucksOf = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const truck of board.trucks) {
      const driverId = draft.get(truck.id) ?? null;
      if (driverId) map.set(driverId, [...(map.get(driverId) ?? []), label(truck)]);
    }
    return map;
  }, [board.trucks, draft]);
  /**
   * What a driver's phone says when another driver has the same number: the
   * other drivers' trucks ("also 433"), or the name of one on no truck.
   */
  const sharedNote = (driverId: string) => {
    const group = [...sharedGroups.values()].find((g) => g.some((d) => d.id === driverId));
    if (group === undefined) return undefined;
    const others = group.filter((d) => d.id !== driverId);
    return {
      also: `also ${listed(others.flatMap((d) => trucksOf.get(d.id) ?? [d.name]))}`,
      title: `The same number as ${listed(
        others.map((d) => {
          const trucks = trucksOf.get(d.id);
          return `${d.name} (${trucks ? `truck ${listed(trucks)}` : 'no truck'})`;
        }),
      )}`,
    };
  };
  const counts = useMemo(() => filterCounts(rows, sharedDriverIds), [rows, sharedDriverIds]);
  const visible = rows.filter(
    (row) => inFilter(row, filter, sharedDriverIds) && matchesSearch(row, query),
  );
  const narrowed = filter !== 'all' || query.trim() !== '';

  /**
   * A truck's picker, opened from outside its row (the no-driver chips,
   * §12.139). A row the tab or search hides is not rendered and has no
   * picker, so the view goes back to All with no search first, rendered at
   * once, and then the same `open()` "+ Assign driver" calls.
   */
  const openPickerFor = (truckId: string) => {
    if (!visible.some((row) => row.truck.id === truckId)) {
      flushSync(() => {
        setFilter('all');
        setQuery('');
      });
    }
    pickers.current.get(truckId)?.open();
  };

  /** "/" focuses the search, as on the console (§8.1), unless typing elsewhere. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '/' && !isTypingTarget(event.target)) {
        event.preventDefault();
        searchField.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const canRetire = can(role, 'admin');

  /**
   * §12.37. Never a delete — `assignments.driver_id` is ON DELETE RESTRICT and
   * the history is the record of who drove what. Confirmed first, because it
   * is the one control here that removes something from the board.
   */
  const retire = async (driverId: string, name: string) => {
    if (!window.confirm(`Retire ${name}? Their assignment history is kept.`)) return;
    const response = await fetch('/api/drivers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'retire', driverId, retired: true }),
    });
    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      window.alert(body.error ?? 'That driver could not be retired.');
      return;
    }
    router.refresh();
  };
  const trucksWithoutDriver = board.trucks.filter((t) => !(draft.get(t.id) ?? null));

  return (
    /**
     * §12.131. The window's height, not at least it: the header and the
     * footer stay put and only the board between them scrolls. It was
     * `min-h-dvh`, so the page itself scrolled and Save, Discard and the
     * count of changes sat under the last of 22 rows.
     */
    <main className="flex h-dvh flex-col bg-surface-base">
      {/*
        §12.106. Assignments are a desktop job (§12.94), and this page has no
        phone layout: nothing on the phone view links here, and an address
        typed on a phone gets this instead of a board it cannot use. CSS, not
        a width read, so the server's first paint is already the right one.
      */}
      <div
        data-assignments-desktop-only=""
        className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center md:hidden"
      >
        <p className="text-body text-text">Assignments are on the desktop console.</p>
        <Link
          href="/"
          className="inline-flex h-11 items-center border border-line-rule px-4 font-cond text-[13px] font-semibold uppercase leading-none tracking-[.08em] text-text"
        >
          Back to the board
        </Link>
      </div>
      <header className="flex h-14 shrink-0 max-md:hidden items-center justify-between border-b border-line-hair bg-surface-raised px-[18px]">
        {/*
          At 768 the header is about full: title and counts ~330px, the
          search and Back ~300. So below 1100 the search is 160px (the
          console's own narrow box, §12.91) without its "/" cap, and the
          counts truncate rather than wrap, which a viewer's badge needs.
        */}
        <div className="flex min-w-0 items-baseline gap-4">
          <h1 className="shrink-0 font-cond text-header font-semibold uppercase tracking-[.14em] text-text">
            Assignments
          </h1>
          <span className="truncate text-body text-text-secondary">
            {board.trucks.length} active trucks · {board.drivers.length} active drivers
          </span>
          {/**
           * §12.141. A viewer's board offers nothing to press: no "+ Assign
           * driver", "Assign to", pencil, Add or Retire, and the pickers are
           * locked as before. This says why, once, instead of a tooltip on
           * each control (§12.14's rule, which this page departs from).
           */}
          {mayEdit ? null : (
            <span
              data-view-only=""
              title={lockedReason}
              className="inline-flex h-[22px] shrink-0 items-center gap-[5px] self-center border border-status-neutral-bd px-2 font-cond text-micro font-semibold uppercase tracking-[.08em] text-status-neutral-fg"
            >
              <LockIcon />
              View only
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {/* The console's search field (§12.91), at the console's 260px. */}
          <label className="relative flex h-8 w-[160px] items-center min-[1100px]:w-[260px] gap-2 border border-line-rule bg-surface-base px-[10px] focus-within:border-accent">
            <SearchIcon className="shrink-0 text-text-mutedOnOverlay" />
            <input
              ref={searchField}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query !== '') {
                  e.stopPropagation();
                  setQuery('');
                }
              }}
              /*
               * The placeholder is drawn by the two spans after the field,
               * so it can be "Search" in the 160px box below 1100 and the
               * full hint in the 260px one, by CSS alone: "Truck, driver or
               * phone" was cut to "…phon" at 1024 and 768. The real
               * placeholder is a space, which keeps `:placeholder-shown`
               * true while the field is empty.
               */
              placeholder=" "
              aria-label="Search trucks, drivers or phones"
              className="peer min-w-0 flex-1 bg-transparent font-sans text-[13px] text-text outline-none"
            />
            <span
              aria-hidden="true"
              data-search-hint="short"
              className="pointer-events-none absolute left-[32px] hidden whitespace-nowrap font-sans text-[13px] text-text-mutedOnOverlay peer-placeholder-shown:inline min-[1100px]:peer-placeholder-shown:hidden"
            >
              Search
            </span>
            <span
              aria-hidden="true"
              data-search-hint="long"
              className="pointer-events-none absolute left-[32px] hidden whitespace-nowrap font-sans text-[13px] text-text-mutedOnOverlay min-[1100px]:peer-placeholder-shown:inline"
            >
              Truck, driver or phone
            </span>
            {query !== '' ? (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  searchField.current?.focus();
                }}
                aria-label="Clear search"
                className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center border border-line-hair text-text-secondary"
              >
                ×
              </button>
            ) : (
              <span className="shrink-0 whitespace-nowrap border border-line-control px-[5px] py-px font-mono text-[11px] font-medium text-text-secondary max-[1099px]:hidden">
                /
              </span>
            )}
          </label>
          <Link
            href="/"
            className="border border-line-hair px-3 py-1.5 font-cond text-micro uppercase tracking-[.09em] text-text-secondary hover:bg-row-hover"
          >
            Back to console
          </Link>
        </div>
      </header>

      {/*
        §12.137. The tabs, each with its count in the draft, in the console's
        chip style (§12.91). One tab at a time; the search narrows within it.
      */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-hair px-5 py-2.5 max-md:hidden">
        <div role="group" aria-label="Filter the trucks" className="flex flex-wrap items-center gap-[6px]">
          {BOARD_FILTERS.map(({ key, label: name }) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={`flex h-7 shrink-0 items-center gap-[6px] whitespace-nowrap border px-[9px] font-cond text-[11.5px] font-semibold uppercase leading-none tracking-[.08em] transition-colors duration-ground ${
                filter === key
                  ? 'border-accent bg-surface-overlay text-text'
                  : 'border-line-control text-text-secondary hover:bg-row-hover'
              }`}
            >
              {name}
              <span className="font-sans text-[12px] font-semibold leading-none tabular-nums">
                {counts[key]}
              </span>
            </button>
          ))}
        </div>
        {narrowed ? (
          <span data-shown-count="" className="text-small tabular-nums text-text-muted">
            {visible.length} of {rows.length} trucks
          </span>
        ) : null}
      </div>

      {/*
        No top padding here: a sticky child sticks inside the scroll region's
        padding, so with `p-5` a scrolled row showed through the 20px above
        the column headers. The 20px is the sticky things' own `pt-5` instead.

        §12.132. Below 1100px the two panels sit above the table, side by side,
        instead of beside it. The four columns needed 722px at their minimums
        when 1100 was chosen, which beside the 260px aside left nothing for
        the picker under about 1042px. With Currently (§12.145) they need 775,
        and at 1100 the table is 780: every column near its minimum (COLUMNS
        has the budget). The DOM order (table, then panels) is kept, so the
        keyboard reaches the pickers first.
      */}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto px-5 pb-5 max-md:hidden min-[1100px]:flex-row min-[1100px]:gap-5">
        {/*
          §12.135. From 1100px up the table stops at 1000px and the panels
          follow it: a four-column table stretched to 1600px at 1920 ran its
          rules 900px past its last value, and put the gaps panel 900px from
          the phone column. The ground beyond the panels is left empty.
        */}
        <section className="min-w-0 min-[1100px]:max-w-[1000px] min-[1100px]:flex-1">
          {/* §12.37: above the board, where a dispatcher is already thinking
              about who is on what. Renders nothing when there is nothing to
              ask. */}
          <div className="pt-5 empty:hidden">
            <MergePrompt role={role} />
          </div>
          {/* Sticky, so a dispatcher 15 rows down still knows which name is the picker's. */}
          <div
            className={`sticky top-0 z-10 grid ${COLUMNS} items-center gap-x-4 border-b border-l-[3px] border-line-hair border-l-transparent bg-surface-base pb-2 pt-5 font-cond text-micro uppercase tracking-[.11em] text-text-muted`}
          >
            {/* 8px clear of the rows' 3px left edge, on every row, so the numbers line up. */}
            <span className="pl-2">Truck</span>
            {/* Over the name, not the field's edge: at rest the field has no box (§12.134). */}
            <span className="pl-2.5">Driver</span>
            <span>ELD</span>
            <span>Driver&rsquo;s phone</span>
            <span className={CURRENTLY_SHOWN}>Currently</span>
          </div>

          {/* §12.106: a row's `driver` is the picker's, so the phone shown is theirs, not the truck's. */}
          {visible.map(({ truck, driverId: value, driver }) => {
            const isChanged = value !== truck.driverId;
            const isConflicted = conflictedTrucks.has(truck.id);
            /** §12.139: an empty truck offers "+ Assign driver", to whoever may assign. */
            const assignable = value === null && mayEdit;
            return (
              <div
                key={truck.id}
                /**
                 * §12.134. The console's 44px row (`row-comfortable`, §14.4),
                 * at least: a row with the phone editor open, or a "was"
                 * under its driver, grows to fit.
                 *
                 * §12.140. A 3px left edge says the row's state before its
                 * ground does: conflict (the late ink), changed (the accent,
                 * the selection's colour), empty (muted ink). The conflict
                 * wins, then the change, as the grounds do.
                 */
                className={`grid ${COLUMNS} min-h-row-comfortable items-center gap-x-4 border-b border-l-[3px] border-line-soft py-1 ${
                  isConflicted
                    ? 'border-l-status-late-fg bg-status-late-bg'
                    : isChanged
                      ? 'border-l-accent bg-row-selected'
                      : // The console's own ground for a truck with nobody on it
                        // (design 4a): marginally sunken, inert, not urgent.
                        value === null
                        ? 'border-l-text-muted bg-row-unassigned'
                        : 'border-l-transparent'
                }`}
              >
                {/* A truck with no number shows its Samsara name, which can be long. */}
                <span
                  title={label(truck)}
                  className="truncate pl-2 font-sans text-data font-bold tabular-nums text-text"
                >
                  {label(truck)}
                </span>
                <div className="flex min-w-0 flex-col justify-center">
                  <div className="flex min-w-0 items-center gap-2">
                    {/*
                      An empty truck's field is as wide as "Unassigned", with
                      its button beside it; while the field has focus (open,
                      or being typed in) it takes the column and the button
                      steps aside. CSS only, so the picker keeps every rule.
                    */}
                    <div
                      className={
                        assignable
                          ? 'peer w-[104px] shrink-0 focus-within:w-auto focus-within:min-w-0 focus-within:flex-1'
                          : 'min-w-0 flex-1'
                      }
                    >
                      <DriverSelect
                        ref={(handle) => {
                          if (handle) pickers.current.set(truck.id, handle);
                          else pickers.current.delete(truck.id);
                        }}
                        drivers={board.drivers}
                        value={value}
                        claimedBy={claimedBy}
                        truckLabel={label(truck)}
                        disabled={!mayEdit || saving}
                        disabledReason={mayEdit ? undefined : lockedReason}
                        onChange={(driverId) => editDraft(truck.id, driverId)}
                        quiet
                        size="row"
                        // §12.140: the tag has its own column on the board.
                        fieldTag={false}
                        /**
                         * §12.37: the board refreshes BEFORE the select points at
                         * the new driver, so `board.drivers` already contains them.
                         * Only passed where a refresh is possible — a picker that
                         * offered "+ Add driver" and then could not show the result
                         * would look broken.
                         */
                        /**
                         * §12.38: only when the truck is EMPTY. On an occupied
                         * truck the driver is only created and selected here; the
                         * change of driver is then a row in this board's draft like
                         * any other, and goes out with Save in the batch. There is
                         * no two-sided confirm on this screen: the board's batch
                         * save is its own confirmation (HANDOFF 3ai, answered
                         * 2026-10-19). §9.10's confirm and its preview token are
                         * the edit modal's.
                         */
                        assignToTruckId={truck.driverId === null ? truck.id : null}
                        onDriverCreated={(_driverId, _name, assignedTruckId) => {
                          // Assigned server-side, so pull the new truth in. The
                          // draft rebases rather than resetting, so the selection
                          // and every other pending edit survive.
                          if (assignedTruckId !== null) clearEdits();
                          router.refresh();
                        }}
                      />
                    </div>
                    {assignable ? (
                      <button
                        type="button"
                        disabled={saving}
                        // §12.139: this row's picker, opened as a click on its field opens it.
                        onClick={() => pickers.current.get(truck.id)?.open()}
                        className="inline-flex h-7 shrink-0 items-center whitespace-nowrap border border-line-control px-2 font-cond text-micro font-semibold uppercase tracking-[.08em] text-accent hover:border-accent hover:bg-row-hover disabled:opacity-45 peer-focus-within:hidden"
                      >
                        + Assign driver
                      </button>
                    ) : null}
                  </div>
                  {/**
                   * §12.130, moved under the name (§12.140). Only on a row
                   * changed in the draft: what the truck had before, struck
                   * through, as §9.10 writes the losing side — including its
                   * "—" for a truck that had nobody. In line with the name
                   * above it, which sits 10px into its field.
                   */}
                  {isChanged ? (
                    <span
                      data-was=""
                      className="flex min-w-0 items-baseline gap-1.5 pl-2.5 text-small text-text-muted"
                    >
                      <span className="shrink-0">was</span>
                      {/* §12.133: the name struck, not its No ELD tag. */}
                      <span className="min-w-0 truncate">
                        <DriverName
                          name={truck.driverName}
                          source={truck.driverSource}
                          samsaraDriverId={truck.driverSamsaraId}
                          fallback="—"
                          struck
                        />
                      </span>
                    </span>
                  ) : null}
                </div>
                {/* §12.140: the tag the picker's field carried (§12.129), in a column of its own. */}
                <span data-eld="" className="flex">
                  {driver !== null && !isEldBacked(driver) ? <NoEldTag /> : null}
                </span>
                {driver ? (
                  <DriverPhone
                    key={driver.id}
                    driverId={driver.id}
                    driverName={driver.name}
                    phone={driver.phone}
                    mayEdit={mayEdit}
                    onSaved={() => router.refresh()}
                    truckLabel={label(truck)}
                    shared={sharedNote(driver.id)}
                  />
                ) : (
                  <span />
                )}
                {/* §12.145: the SAVED truck's live state, by its id; the draft never reaches it. */}
                <div data-currently="" className={`${CURRENTLY_SHOWN} min-w-0 items-center gap-2`}>
                  <Currently
                    row={live.get(truck.id)}
                    feedStale={fleet.feedStale}
                    fetchedAt={fleet.fetchedAt}
                  />
                </div>
              </div>
            );
          })}
          {visible.length === 0 ? (
            <p className="px-2.5 py-6 text-body text-text-muted">No trucks match.</p>
          ) : null}
        </section>

        {/*
          Beside the table, sticky: the gaps stay in view while the board
          scrolls past them. Below 1100px, every panel in one row above the
          table, as many equal columns as there are panels (two, or three
          with a shared phone, §12.140).
        */}
        <aside className="order-first grid auto-cols-fr grid-flow-col gap-5 pt-5 min-[1100px]:sticky min-[1100px]:top-0 min-[1100px]:order-none min-[1100px]:block min-[1100px]:w-[260px] min-[1100px]:shrink-0 min-[1100px]:space-y-5 min-[1100px]:self-start">
          <Panel
            title="Drivers without a truck"
            count={driversWithoutTruck.length}
            empty="Every active driver has a truck."
            items={driversWithoutTruck.map((d) => ({
              key: d.id,
              node: (
                /**
                 * At every width: name and Retire, the phone under them, then
                 * "Assign to". Below 1100px it was one line (name, phone,
                 * Retire, §12.135), which with three panels in the row (about
                 * 230px each at 768, §12.140) cut a normal name to "Lior
                 * Mb…" (3ao polish).
                 */
                <span
                  data-free-driver=""
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1"
                >
                  {/* Only a truly long name truncates; the whole of it is the title. */}
                  <span title={d.name} className="col-start-1 row-start-1 flex min-w-0">
                    <DriverName
                      name={d.name}
                      source={d.source}
                      samsaraDriverId={d.samsaraDriverId}
                      className="min-w-0"
                    />
                  </span>
                  <span className="col-span-2 col-start-1 row-start-2 min-w-0">
                    <DriverPhone
                      driverId={d.id}
                      driverName={d.name}
                      phone={d.phone}
                      mayEdit={mayEdit}
                      onSaved={() => router.refresh()}
                      shared={sharedNote(d.id)}
                    />
                  </span>
                  {/**
                   * §12.37: ADMIN only — it takes someone off the board.
                   * Offered only for a driver with no truck, because retiring
                   * one that is assigned is refused server-side anyway and a
                   * control that always errors is worse than no control.
                   */}
                  {canRetire ? (
                    <button
                      type="button"
                      onClick={() => void retire(d.id, d.name)}
                      title={`Retire ${d.name} — keeps their history, removes them from the board.`}
                      className="col-start-2 row-start-1 -mr-1.5 inline-flex h-7 shrink-0 items-center px-1.5 font-cond text-micro uppercase tracking-[.08em] text-text-muted hover:text-status-late-fg"
                    >
                      Retire
                    </button>
                  ) : null}
                  {/**
                   * §12.139. One button per truck that is empty IN THE DRAFT.
                   * A click puts this driver on that truck in the draft only,
                   * exactly as picking them in that row's picker does; nothing
                   * is sent until Save. The driver then leaves this panel and
                   * the truck its chip.
                   */}
                  {mayEdit && trucksWithoutDriver.length > 0 ? (
                    <span
                      data-assign-to=""
                      className="col-span-2 col-start-1 row-start-3 mt-1 flex flex-wrap items-center gap-1.5"
                    >
                      <span className="mr-0.5 font-cond text-micro uppercase tracking-[.11em] text-text-muted">
                        Assign to
                      </span>
                      {trucksWithoutDriver.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          disabled={saving}
                          aria-label={`Assign ${d.name} to truck ${label(t)}`}
                          onClick={() => editDraft(t.id, d.id)}
                          className="inline-flex h-7 min-w-[44px] items-center justify-center border border-line-control px-2 font-sans text-body font-semibold tabular-nums text-text hover:border-accent hover:bg-row-hover disabled:opacity-45"
                        >
                          {label(t)}
                        </button>
                      ))}
                    </span>
                  ) : null}
                </span>
              ),
            }))}
          />
          <Panel
            title="Trucks without a driver"
            count={trucksWithoutDriver.length}
            empty="Every active truck has a driver."
            items={trucksWithoutDriver.map((t) => ({
              key: t.id,
              node: (
                /**
                 * A chip, on the empty rows' own ground. §12.139, changed by
                 * Alex on 2026-10-22 (it replaces 3al question 3's "no jump
                 * to the row" for these chips): a click opens that truck's
                 * picker as its "+ Assign driver" does. A viewer has no
                 * picker to open, so their chip stays inert.
                 */
                mayEdit ? (
                  <button
                    type="button"
                    disabled={saving}
                    aria-label={`Assign a driver to truck ${label(t)}`}
                    onClick={() => openPickerFor(t.id)}
                    className="inline-flex h-7 min-w-[44px] items-center justify-center border border-line-soft bg-row-unassigned px-2 hover:border-accent hover:text-text disabled:opacity-45"
                  >
                    {label(t)}
                  </button>
                ) : (
                  <span className="inline-flex h-7 min-w-[44px] items-center justify-center border border-line-soft bg-row-unassigned px-2">
                    {label(t)}
                  </span>
                )
              ),
            }))}
            inline
          />
          {/**
           * §12.138. Only when two different drivers have one number: each
           * number, and under it every driver who has it, with their truck.
           */}
          {sharedGroups.size > 0 ? (
            <Panel
              title={
                <span className="inline-flex items-center gap-1.5">
                  <WarningIcon className="shrink-0 text-status-risk-fg" />
                  Shared phone number
                </span>
              }
              empty=""
              items={[...sharedGroups].map(([digits, drivers]) => ({
                key: digits,
                node: (
                  <span data-shared-group="" className="flex flex-col gap-0.5">
                    <span className="tabular-nums text-status-risk-fg">
                      {formatPhone(drivers[0]!.phone!)}
                    </span>
                    {drivers.map((d) => {
                      const trucks = trucksOf.get(d.id);
                      return (
                        <span key={d.id} className="flex min-w-0 items-baseline gap-2.5">
                          <span
                            className={`shrink-0 tabular-nums ${trucks ? 'font-semibold text-text' : 'text-text-muted'}`}
                          >
                            {trucks ? listed(trucks) : 'no truck'}
                          </span>
                          <span className="min-w-0 truncate" title={d.name}>
                            {d.name}
                          </span>
                        </span>
                      );
                    })}
                  </span>
                ),
              }))}
            />
          ) : null}
        </aside>
      </div>

      <footer className="shrink-0 border-t border-line-hair bg-surface-bar px-5 py-3 max-md:hidden">
        {conflicts.length > 0 ? (
          <ul className="mb-3 border border-status-late-bd bg-status-late-bg px-3 py-2">
            <li className="mb-1 font-cond text-micro uppercase tracking-[.11em] text-status-late-fg">
              Nothing was saved — {conflicts.length} conflict
              {conflicts.length === 1 ? '' : 's'}
            </li>
            {conflicts.map((conflict, i) => (
              <li key={i} className="text-body text-text">
                <span className="font-semibold">{CONFLICT_HEADLINE[conflict.reason]}:</span>{' '}
                {conflict.message}
              </li>
            ))}
          </ul>
        ) : null}

        {failure ? (
          <p className="mb-3 border border-status-late-bd bg-status-late-bg px-3 py-2 text-body text-status-late-fg">
            {failure}
          </p>
        ) : null}

        <div className="flex items-center justify-between">
          {/* While rows are changed, this is the sentence that matters: primary ink. */}
          <span className={`text-body ${dirty ? 'text-text' : 'text-text-secondary'}`}>
            {dirty
              ? `${changed.length} row${changed.length === 1 ? '' : 's'} changed${doubleBookedGroups
                  .map((trucks) => ` · a driver is on trucks ${listed(trucks.map(label))}`)
                  .join('')}`
              : (saved ?? 'No changes.')}
          </span>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => {
                clearEdits();
                setDraft(initial);
                setConflicts([]);
              }}
              className="h-10 border border-line-hair px-4 font-cond text-micro uppercase tracking-[.09em] text-text-secondary disabled:opacity-45"
            >
              Discard
            </button>
            {/**
             * §12.140. The solid accent only when there is something valid to
             * save; otherwise disabled, and drawn exactly as a disabled Discard. At 45% the accent
             * still read as the thing to press on a board with nothing to
             * save, or with a double-booking it would refuse.
             */}
            <button
              type="button"
              disabled={!savable}
              title={mayEdit ? undefined : lockedReason}
              onClick={() => void save()}
              className={`h-10 border px-4 font-cond text-micro font-semibold uppercase tracking-[.09em] ${
                savable
                  ? 'border-accent bg-accent text-text-inverse hover:border-accent-hover hover:bg-accent-hover'
                  : // Discard's own disabled look, so the two read alike (3ao polish).
                    'border-line-hair text-text-secondary disabled:opacity-45'
              }`}
            >
              {saving ? 'Saving…' : 'Save assignments'}
            </button>
          </div>
        </div>
      </footer>
    </main>
  );
}

function Panel({
  title,
  count,
  items,
  empty,
  inline = false,
}: {
  title: React.ReactNode;
  /** Shown at the title's right end, as the design has it; absent for the shared phones. */
  count?: number;
  /**
   * Nodes, not strings — the drivers panel renders a name plus its `No ELD`
   * tag (§12.37), and a string list could only have shown the name.
   */
  items: { key: string; node: React.ReactNode }[];
  empty: string;
  /**
   * One wrapping line instead of one item per line: the truck numbers, which
   * stacked five tall in a 260px box (§12.132).
   */
  inline?: boolean;
}) {
  return (
    <div className="border border-line-hair bg-surface-raised p-3">
      <h2 className="mb-2 flex items-baseline justify-between gap-2 font-cond text-micro uppercase tracking-[.11em] text-text-muted">
        {title}
        {count === undefined ? null : (
          <span data-panel-count="" className="font-sans text-small font-semibold tracking-normal tabular-nums text-text">
            {count}
          </span>
        )}
      </h2>
      {items.length === 0 ? (
        <p className="text-body text-text-muted">{empty}</p>
      ) : (
        <ul className={inline ? 'flex flex-wrap gap-1.5 tabular-nums' : 'space-y-2.5'}>
          {items.map((item) => (
            /**
             * Not `truncate`: its `nowrap` reached the phone editor inside the
             * drivers panel, so "Blank clears the number." and a refusal could
             * not wrap in 236px and were cut. The name truncates on its own.
             */
            <li
              key={item.key}
              className={`text-body text-text-secondary ${inline ? 'whitespace-nowrap' : 'min-w-0'}`}
            >
              {item.node}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
