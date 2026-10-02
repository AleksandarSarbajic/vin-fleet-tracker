'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { elapsed, timeInZone, zoneAbbreviation } from '@/lib/format';
import { SearchField } from './SearchField';
import { FilterChips, type FilterKey } from './FilterChips';
import { AccountMenu, type AccountUser } from './AccountMenu';
import type { FleetRow } from '@/server/fleet-query';
import { ScopeMenu, type ListsMenu } from './SavedViews';
import { BRAND } from '@/lib/brand';
import type { SavedView } from '@/lib/views';

/**
 * design-spec §12.91 — header option 6a, "scope bar + filter row".
 *
 * Row 1 (48px) answers "where am I, and is the feed alive": brand, the scope
 * button, search, tools, sync, clocks, account. Row 2 (36px) does one job,
 * filtering: the chips, Drivers only, the notes that say what is hidden, and
 * the sort label. 84px in all — the 56px header and the 34px list-title row it
 * replaces were 90.
 *
 * Every width is fixed per breakpoint rather than negotiated by flex, so the
 * header test can hold each row to a measured spare room (never under 80px at
 * 1280 and up). Below 1440 things collapse in the spec's order: the sort
 * label, the wordmark, the local clock (its time moves to the dispatch
 * clock's tooltip), `⌘K jump` to `⌘K`, Assignments to its icon, "Synced 3s
 * ago" to "3s ago", and the notes to their short forms. A chip, a count, the
 * scope's kind tag and the red feed-down block never collapse.
 */

function Clock({
  instant,
  zone,
  label,
  primary,
  title,
}: {
  instant: Date;
  zone: string;
  label: string;
  primary?: boolean;
  title?: string;
}) {
  const clock = timeInZone(instant, zone).split(' ')[0] ?? '';
  const abbrev = zoneAbbreviation(instant, zone);
  return (
    <span className="flex flex-col items-end gap-[3px]" title={title}>
      <span
        className={
          primary
            ? 'font-sans text-[15px] font-semibold leading-none tabular-nums text-text'
            : 'font-sans text-[13px] leading-none tabular-nums text-text-secondary'
        }
      >
        {clock}
      </span>
      <span
        className={`whitespace-nowrap font-cond text-micro leading-none tracking-[.1em] ${primary ? 'font-semibold text-text-secondary' : 'text-text-mutedOnOverlay'}`}
      >
        {abbrev} · {label}
      </span>
    </span>
  );
}

/**
 * One of the row-2 notes that keep a hidden truck from being hidden silently
 * (§12.8, §12.78, §12.90). Each is a button that undoes what it reports.
 */
export interface HeaderNote {
  id: 'inactive' | 'outside' | 'drivers';
  /** At 1440 and up. */
  text: string;
  /** Below 1440 (§12.91). */
  short: string;
  /** `warn` is At-risk amber (the outside-list note); `quiet` is secondary ink. */
  tone: 'warn' | 'quiet';
  title: string;
  onClick: () => void;
}

interface Props {
  /** Every truck in scope — the fleet, or the active list's — for the chip counts (§12.8). */
  rows: FleetRow[];
  chips: Set<FilterKey>;
  onToggleChip: (key: FilterKey) => void;
  onResetChips: () => void;
  query: string;
  onQueryChange: (value: string) => void;
  matchCount: number;
  totalCount: number;
  fetchedAt: string | null;
  /**
   * `feed_health.newest_position_at`. This was DECLARED here and never
   * destructured — the sync dot was hardcoded to the healthy token, so a
   * dimmed §5.9 board sat under a green dot reading "Synced 12s ago" (§12.53).
   *
   * Two different ages, and the difference is the whole point: "Synced" is
   * how long ago the BROWSER talked to us, which stays healthy while the feed
   * is dead. `feedNewestAt` is how old the POSITIONS are, which is the number
   * a dispatcher is actually deciding on.
   */
  feedNewestAt: string | null;
  /** §5.9. True when the positions are too old to colour a schedule with. */
  feedStale: boolean;
  dispatchTz: string;
  /**
   * The whole account, not just its initials (§12.45). The circle used to be
   * a `<span>` with two letters and nothing behind it, so there was no way to
   * sign out and no way to see which account you were on.
   */
  user: AccountUser;
  /** §14 feature 11. A view IS a chip set and a search term, so it lives here. */
  views: {
    saved: SavedView[];
    active: SavedView | null;
    onApply: (view: SavedView) => void;
    onSave: (name: string) => string | null;
    onRemove: (id: string) => void;
    onRename: (id: string, name: string) => string | null;
    canSaveCurrent: boolean;
    /** §12.90. The shared truck lists, shown above the personal views. */
    lists?: ListsMenu;
  };
  /** §12.91. The scope button's count, and the menu's. */
  scope: {
    count: number;
    fleetCount: number;
    viewCount: (view: SavedView) => number;
    onClear: () => void;
  };
  /** §12.91. Row 2's right side, in order. */
  notes: HeaderNote[];
  /**
   * A truck is selected. The one place that says so and names the key that
   * clears it — the bulk bar speaks for CHECKED rows only.
   */
  selected: boolean;
}

export function ConsoleHeader({
  rows,
  chips,
  onToggleChip,
  onResetChips,
  query,
  onQueryChange,
  matchCount,
  totalCount,
  fetchedAt,
  feedNewestAt,
  feedStale,
  dispatchTz,
  user,
  views,
  scope,
  notes,
  selected,
}: Props) {
  /**
   * Seeded from the FETCH instant, not from the clock.
   *
   * The server renders this header and the browser hydrates it a second or
   * two later; `new Date()` on both sides gives "Synced 2s ago" against
   * "Synced 4s ago", which React reports as a hydration failure and recovers
   * from by re-rendering the tree. Deriving the first paint from a value both
   * sides already share makes the two renders identical, and the interval
   * below takes over immediately after mount.
   */
  const [now, setNow] = useState(() => (fetchedAt ? new Date(fetchedAt) : new Date(0)));
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const age = elapsed(fetchedAt, now);
  /** The age of the POSITIONS, which is a different number from `age`. */
  const feedAge = elapsed(feedNewestAt, now);
  // The browser's own zone — "CET · YOU" for a dispatcher working from Europe.
  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const lastSync = feedNewestAt
    ? timeInZone(new Date(feedNewestAt), dispatchTz, { zone: false })
    : null;
  const localTime = `${timeInZone(now, viewerZone).split(' ')[0] ?? ''} ${zoneAbbreviation(now, viewerZone)} · you`;

  /**
   * §12.100. Below 1024 the search is a 32px icon, and the field opens over
   * row 1 on a tap or "/". Esc closes it back to the icon; so does moving
   * focus anywhere else (a tablet has no Esc key). The query is the
   * console's, not the field's, so closing never clears it — the dot on the
   * icon says a filter is still on.
   */
  const [searchOpen, setSearchOpen] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const searchIcon = useRef<HTMLButtonElement | null>(null);
  const searchBox = useRef<HTMLDivElement | null>(null);
  const narrow = () => window.matchMedia('(max-width: 1023px)').matches;
  const openSearch = useCallback(() => {
    if (narrow()) setSearchOpen(true);
    setFocusTick((t) => t + 1);
  }, []);
  useEffect(() => {
    if (focusTick > 0) searchBox.current?.querySelector('input')?.focus();
  }, [focusTick]);
  const closeSearch = useCallback(() => {
    if (!searchOpen || !narrow()) return false;
    setSearchOpen(false);
    searchIcon.current?.focus();
    return true;
  }, [searchOpen]);
  const filtering = query.trim();

  return (
    // §12.96: below 768px the phone's top bar and tiles stand in for this.
    <header data-console-header="" className="shrink-0 max-md:hidden">
      <div
        data-header-row="1"
        className="relative flex h-12 items-center gap-3 border-b border-line-soft bg-surface-raised px-4"
      >
        <div className="flex shrink-0 items-center gap-[10px]">
          {/* The MONOGRAM, not the lockup (§12.71): at this size the lockup's
              script fails 5a's own 24px legibility rule. 26px here (§12.91).
              `unoptimized` because it is an SVG. */}
          <Image
            src={BRAND.monogram.src}
            width={BRAND.monogram.width}
            height={BRAND.monogram.height}
            alt={BRAND.alt}
            unoptimized
            priority
            className="h-[26px] w-[26px]"
          />
          <span className="hidden whitespace-nowrap font-cond text-[14px] font-semibold uppercase leading-none tracking-[.14em] text-text min-[1440px]:inline">
            Fleet Tracker
          </span>
        </div>

        <div aria-hidden="true" className="h-6 w-px shrink-0 bg-line-hair" />

        <ScopeMenu
          views={views.saved}
          active={views.active}
          onApply={views.onApply}
          onSave={views.onSave}
          onRemove={views.onRemove}
          onRename={views.onRename}
          canSaveCurrent={views.canSaveCurrent}
          {...(views.lists ? { lists: views.lists } : {})}
          scopeCount={scope.count}
          fleetCount={scope.fleetCount}
          viewCount={scope.viewCount}
          onClear={scope.onClear}
        />

        <button
          ref={searchIcon}
          type="button"
          onClick={openSearch}
          aria-label={filtering ? `Search, filtering “${filtering}”` : 'Search'}
          aria-expanded={searchOpen}
          title="Filter list ( / )"
          className="relative flex h-8 w-8 shrink-0 items-center justify-center border border-line-control text-text hover:bg-row-hover min-[1024px]:hidden"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          {filtering ? (
            <span
              data-search-active=""
              aria-hidden="true"
              className="absolute right-[3px] top-[3px] h-[6px] w-[6px] bg-accent"
            />
          ) : null}
        </button>

        <div
          ref={searchBox}
          data-header-search=""
          onBlur={(event) => {
            if (searchOpen && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setSearchOpen(false);
            }
          }}
          // Esc from anything inside it — the clear button included.
          onKeyDown={(event) => {
            if (event.key === 'Escape' && closeSearch()) event.stopPropagation();
          }}
          className={`w-[160px] shrink-0 min-[1280px]:w-[220px] min-[1440px]:w-[260px] min-[1680px]:w-[340px] min-[1920px]:w-[420px] ${
            searchOpen
              ? 'max-[1023px]:absolute max-[1023px]:inset-0 max-[1023px]:z-20 max-[1023px]:flex max-[1023px]:w-auto max-[1023px]:items-center max-[1023px]:bg-surface-raised max-[1023px]:px-4'
              : 'max-[1023px]:hidden'
          }`}
        >
          <SearchField
            value={query}
            onChange={onQueryChange}
            matchCount={matchCount}
            totalCount={totalCount}
            onSlash={openSearch}
            onEscape={closeSearch}
          />
        </div>

        {/* The spare room. Never under 80px at 1280 and up (header.spec.ts). */}
        <div data-spare="1" className="min-w-0 flex-1 self-stretch" />

        {/* Below 1440 the selection hint lives here: row 2 has no room for it
            beside three notes (§12.91, measured). */}
        {selected ? <SelectionHint row={1} /> : null}

        {/* The tools slot: new controls go here, right-aligned. */}
        <Link
          href="/assignments"
          aria-label="Assignments"
          title="Assignments — who drives which truck"
          className="flex h-8 w-8 shrink-0 items-center justify-center gap-[7px] border border-line-control font-cond text-[11.5px] font-semibold uppercase leading-none tracking-[.08em] text-text hover:bg-row-hover min-[1440px]:w-auto min-[1440px]:px-[10px]"
        >
          {/* Two people: the board pairs drivers with trucks. */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
            className="shrink-0"
          >
            <circle cx="9" cy="8" r="3.5" />
            <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
            <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.5A6.5 6.5 0 0 1 21.5 20" />
          </svg>
          <span className="hidden min-[1440px]:inline">Assignments</span>
        </Link>

        {/**
         * §9.1 / §12.80 / §12.91. Healthy: a green square and "Synced 3s ago".
         * Down: the red block, the instant over the age — "LAST SYNC 17:49 /
         * 25m ago" — which never shortens. No zone suffix: the dispatch clock
         * beside it names the zone.
         *
         * The visible block is not the live region: its age ticks every
         * minute, and a screen reader would read "26m ago" each time. The
         * region below is always in the DOM (a region inserted WITH its text
         * is not announced) and changes once, when the feed goes down.
         */}
        <span role="status" aria-live="polite" data-feed-announce="" className="sr-only">
          {feedStale
            ? lastSync
              ? `Feed down. Last sync ${lastSync}.`
              : 'Feed down. No positions yet.'
            : ''}
        </span>
        {feedStale ? (
          <div
            data-feed-down=""
            className="flex h-9 shrink-0 items-center gap-2 border border-status-late-bd bg-feed-downBg px-[10px]"
          >
            <span aria-hidden="true" className="h-[7px] w-[7px] shrink-0 bg-feed-down" />
            <span
              data-sync-label=""
              className="flex flex-col gap-[3px] whitespace-nowrap"
            >
              {lastSync ? (
                <>
                  <span className="font-cond text-micro font-semibold uppercase leading-none tracking-[.1em] text-status-late-fg">
                    Last sync {lastSync}
                  </span>
                  {feedAge ? (
                    <span className="font-sans text-[12.5px] font-semibold leading-none text-status-late-fg">
                      <span className="sr-only"> · </span>
                      {feedAge} ago
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="font-sans text-[12.5px] font-semibold leading-none text-status-late-fg">
                  No positions yet
                </span>
              )}
            </span>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-[7px] pl-1">
            <span
              aria-hidden="true"
              className="h-[7px] w-[7px] shrink-0 bg-status-ontime-fg"
            />
            <span
              data-sync-label=""
              {...(age ? { title: `Synced ${age} ago` } : {})}
              className="whitespace-nowrap font-sans text-[12px] text-text-secondary"
            >
              {age ? (
                <>
                  {/* §12.100. The whole sentence, for a screen reader at any width. */}
                  <span className="sr-only">Synced {age} ago</span>
                  <span aria-hidden="true" data-sync-visible="">
                  <span className="hidden min-[1440px]:inline">Synced </span>
                  {/*
                   * §12.99. The age resets every 20 s poll and crosses 9 → 10
                   * each time; sized to its text it moved the Assignments
                   * button. It reserves "88m" in tabular figures — every value
                   * from 0s to 59m — with the live value right-aligned over it.
                   */}
                  <span className="inline-grid tabular-nums">
                    <span aria-hidden="true" className="invisible [grid-area:1/1]">
                      88m
                    </span>
                    <span data-live-age="sync" className="justify-self-end [grid-area:1/1]">
                      {age}
                    </span>
                  </span>
                  {/* §12.100. Below 1024 the age alone, beside the dot; the
                      sentence is in the tooltip and the accessible name. */}
                  <span className="max-[1023px]:hidden"> ago</span>
                  </span>
                </>
              ) : (
                'Syncing…'
              )}
            </span>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-3 border-l border-line-hair pl-3">
          <Clock
            instant={now}
            zone={dispatchTz}
            label="DISPATCH"
            primary
            title={localTime}
          />
          <span className="hidden min-[1440px]:flex">
            <Clock instant={now} zone={viewerZone} label="YOU" />
          </span>
        </div>

        <AccountMenu user={user} />
      </div>

      <div
        data-header-row="2"
        className="flex h-9 items-center gap-[6px] border-b border-line-hair bg-surface-bar px-4 max-[1023px]:h-[72px] max-[1023px]:flex-wrap max-[1023px]:gap-y-0"
      >
        <FilterChips
          rows={rows}
          selected={chips}
          onToggle={onToggleChip}
          onReset={onResetChips}
        />

        <div data-spare="2" className="min-w-0 flex-1 self-stretch" />

        {notes.map((note) => (
          <button
            key={note.id}
            type="button"
            data-note={note.id}
            {...(note.id === 'outside' ? { 'data-outside-list': '' } : {})}
            onClick={note.onClick}
            title={note.title}
            aria-label={note.text}
            className={`ml-[6px] shrink-0 whitespace-nowrap font-sans text-[12px] hover:underline ${
              note.tone === 'warn' ? 'text-status-risk-fg' : 'text-text-secondary'
            }`}
          >
            {/* While a truck is selected the short forms hold to 1680, so the
                hint fits beside three notes at 1440 (§12.91). */}
            <span
              data-note-text=""
              className={
                selected ? 'hidden min-[1680px]:inline' : 'hidden min-[1440px]:inline'
              }
            >
              {note.text}
            </span>
            <span className={selected ? 'min-[1680px]:hidden' : 'min-[1440px]:hidden'}>
              {note.short}
            </span>
          </button>
        ))}

        {selected ? <SelectionHint row={2} /> : null}

        {/* Below 1440 it goes; below 1680 it gives way to the selection hint. */}
        <span
          className={`hidden shrink-0 whitespace-nowrap pl-[10px] font-cond text-micro font-semibold uppercase tracking-[.1em] text-text-mutedOnOverlay ${
            selected ? 'min-[1680px]:inline' : 'min-[1440px]:inline'
          }`}
        >
          Sorted by urgency
        </span>
      </div>
    </header>
  );
}

/**
 * "1 selected · Esc to clear" — the one place that says a truck is selected
 * and names the key that clears it; the bulk bar speaks for CHECKED rows
 * only. In row 2 at 1440 and up, in row 1 below, where there is room for it
 * beside the worst case's three notes (§12.91).
 */
function SelectionHint({ row }: { row: 1 | 2 }) {
  return (
    <span
      data-selection-hint={row}
      className={`shrink-0 whitespace-nowrap font-sans text-[12px] text-text-secondary ${
        row === 2 ? 'ml-[6px] hidden min-[1440px]:inline' : 'min-[1440px]:hidden'
      }`}
    >
      1 selected · <span className="text-accent">Esc</span> to clear
    </span>
  );
}
