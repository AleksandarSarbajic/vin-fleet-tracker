'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { elapsed, timeInZone, zoneAbbreviation } from '@/lib/format';
import { SearchField } from './SearchField';
import { FilterChips, type FilterKey } from './FilterChips';
import { AccountMenu, type AccountUser } from './AccountMenu';
import type { FleetRow } from '@/server/fleet-query';
import { SavedViews } from './SavedViews';
import { BRAND } from '@/lib/brand';
import type { SavedView } from '@/lib/views';

/** design-spec §9.1. 56px, raised ground, hairline bottom. */

function Clock({
  instant,
  zone,
  label,
  primary,
}: {
  instant: Date;
  zone: string;
  label: string;
  primary?: boolean;
}) {
  const clock = timeInZone(instant, zone).split(' ')[0] ?? '';
  const abbrev = zoneAbbreviation(instant, zone);
  return (
    <span className="flex flex-col items-end">
      <span
        className={
          primary
            ? 'font-sans text-[15px] font-semibold leading-[1.05] tabular-nums text-text'
            : 'font-sans text-[13px] leading-[1.05] tabular-nums text-text-mutedOnSelected'
        }
      >
        {clock}
      </span>
      <span
        className={`font-cond text-micro leading-none tracking-[.1em] ${primary ? 'font-semibold text-text-secondary' : 'text-text-muted'}`}
      >
        {abbrev} · {label}
      </span>
    </span>
  );
}

interface Props {
  /** Every truck, so the chip counts stay fleet-wide (§12.8). */
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
  };
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

  return (
    <header className="grid h-14 shrink-0 grid-cols-[auto_1px_minmax(0,1fr)_auto] items-center gap-x-[14px] border-b border-line-hair bg-surface-raised px-[18px]">
      <div className="flex items-center gap-3">
        {/* The MONOGRAM, not the lockup (§12.71). At 30px on a 1x screen the
            lockup's script is ~9px tall with sub-pixel strokes — it fails 5a's
            own 24px legibility rule, and no re-export can fix artwork. The
            words beside it say what the product is; the login card carries
            the full lockup at 54px, where it reads. `unoptimized` because it
            is an SVG: there is nothing for the image optimiser to resize. */}
        <Image
          src={BRAND.monogram.src}
          width={BRAND.monogram.width}
          height={BRAND.monogram.height}
          alt={BRAND.alt}
          unoptimized
          priority
          className="h-[30px] w-[30px]"
        />
        <span className="font-cond text-header font-semibold uppercase text-text">
          Fleet Tracker
        </span>
      </div>

      <div className="h-6 bg-line-hair" />

      {/*
        The search box and the chip row share ONE flexible track, and the
        search gives way first (§12.79).

        This was a grid of `minmax(280px,420px) 1fr`, and grid grows a capped
        track to its cap BEFORE a flexible one gets anything — so the search
        held 420px at every width and the chips took the remainder. At 1440
        that remainder was 463px for a 765px row: Data issues, Inactive and
        Assignments were behind a horizontal scroll, and every chip added made
        it worse.

        Now the search is the ONLY thing that shrinks, from 420 down to a
        120px floor; the chip row never does. Below that floor this whole
        track scrolls — a fallback under ~1400px, not the layout. Two
        attempts that looked right and were not, both measured:
          - a small shrink factor on the row (.05) — when the factors of the
            items still shrinking sum below 1, the browser distributes only
            that FRACTION of the overflow and paints the rest over the next
            column: the row drew over "Synced 12s ago";
          - a large factor on the search (100:1) — the row still took its
            ~2% share and scrolled by 5px at 1440.
        `e2e/header.spec.ts` holds the real property: nothing scrolls and the
        row ends before the status cluster starts.

        Below 1680px three things compact, all measured against a 34-truck
        fleet with two-digit counts: the search drops its key hints (the list
        header carries `/` and `⌘K` instead), `Data issues` reads `Data` — the
        abbreviation the spec already names for a crowded row (§9.1, `3d`) —
        and Assignments is its icon. At 1680 and up nothing changes.
      */}
      <div data-header-track="" className="flex min-w-0 items-center gap-3 overflow-x-auto">
        <div className="min-w-[120px] max-w-[420px] flex-[1_1_420px]">
          <SearchField
            value={query}
            onChange={onQueryChange}
            matchCount={matchCount}
            totalCount={totalCount}
          />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <SavedViews
            views={views.saved}
            active={views.active}
            onApply={views.onApply}
            onSave={views.onSave}
            onRemove={views.onRemove}
            onRename={views.onRename}
            canSaveCurrent={views.canSaveCurrent}
          />
          <FilterChips
            rows={rows}
            selected={chips}
            onToggle={onToggleChip}
            onReset={onResetChips}
          />
          <Link
            href="/assignments"
            aria-label="Assignments"
            title="Assignments — who drives which truck"
            className="flex h-[26px] shrink-0 items-center border border-line-hair px-2 font-cond text-micro uppercase tracking-[.09em] text-text-secondary hover:bg-row-hover min-[1680px]:px-3"
          >
            {/* Two people: the board pairs drivers with trucks. */}
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
              className="min-[1680px]:hidden"
            >
              <circle cx="9" cy="8" r="3.5" />
              <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
              <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.5A6.5 6.5 0 0 1 21.5 20" />
            </svg>
            <span className="hidden min-[1680px]:inline">Assignments</span>
          </Link>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/**
         * §9.1. The dot is `status.ontime.fg` when healthy and
         * `status.late.fg` when the feed is down, and the label changes with
         * it: `Last sync 06:41 · 9m ago`, naming the instant rather than only
         * the age, because the instant is what gets said down a phone.
         *
         * No zone suffix, as the spec wrote it (§12.80). The code had added
         * one (`17:40 CDT`), which the dispatch clock beside it already says,
         * and at 1440px those four characters were what pushed a DOWN feed's
         * header into a 49px scroll.
         */}
        <div className="flex items-center gap-[7px]">
          <span
            className={`h-[7px] w-[7px] shrink-0 ${feedStale ? 'bg-status-late-fg' : 'bg-status-ontime-fg'}`}
            aria-hidden="true"
          />
          {feedStale && feedNewestAt ? (
            /*
             * §12.80. Stacked when the feed is down — the instant over the
             * age, the way the two clocks beside it stack time over label.
             * On one line this was the header's longest text and, at 1440px,
             * the thing that pushed the chip row into a scroll. Stacked, it
             * is as wide as `Last sync 17:40` and the spec's words are intact:
             * the hidden separator keeps "Last sync 17:40 · 25m ago" as the
             * accessible text.
             */
            <span
              data-sync-label=""
              className="flex flex-col font-sans text-[12px] leading-[1.15] tabular-nums text-status-late-fg"
            >
              <span>
                Last sync{' '}
                {timeInZone(new Date(feedNewestAt), dispatchTz, { zone: false })}
              </span>
              {feedAge ? (
                <span>
                  <span className="sr-only"> · </span>
                  {feedAge} ago
                </span>
              ) : null}
            </span>
          ) : (
            <span
              data-sync-label=""
              className={`font-sans text-[12px] tabular-nums ${feedStale ? 'text-status-late-fg' : 'text-text-secondary'}`}
            >
              {feedStale ? 'No positions yet' : age ? `Synced ${age} ago` : 'Syncing…'}
            </span>
          )}
        </div>

        <div className="flex items-baseline gap-[9px] border-l border-line-hair pl-4">
          <Clock instant={now} zone={dispatchTz} label="DISPATCH" primary />
          <Clock instant={now} zone={viewerZone} label="YOU" />
        </div>

        <AccountMenu user={user} />
      </div>
    </header>
  );
}
