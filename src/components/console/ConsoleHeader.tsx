'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { elapsed, timeInZone, zoneAbbreviation } from '@/lib/format';
import { SearchField } from './SearchField';
import { FilterChips, type FilterKey } from './FilterChips';
import { AccountMenu, type AccountUser } from './AccountMenu';
import type { FleetRow } from '@/server/fleet-query';

/** design-spec §9.1. 56px, raised ground, hairline bottom. */

function Clock({ instant, zone, label, primary }: {
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
    <header className="grid h-14 shrink-0 grid-cols-[auto_1px_minmax(280px,420px)_1fr_auto] items-center gap-x-[18px] border-b border-line-hair bg-surface-raised px-[18px]">
      <div className="flex items-center gap-3">
        {/* TODO: mark-knockout.svg replaces this when the real asset lands —
            one reference, so swapping it moves no layout (design-spec §10). */}
        <span className="flex h-[30px] w-[30px] items-center justify-center border border-line-hair font-cond text-[13px] font-semibold text-brand-cyan">
          VL
        </span>
        <span className="font-cond text-header font-semibold uppercase text-text">
          Fleet Tracker
        </span>
      </div>

      <div className="h-6 bg-line-hair" />

      <SearchField
        value={query}
        onChange={onQueryChange}
        matchCount={matchCount}
        totalCount={totalCount}
      />

      <div className="flex min-w-0 items-center gap-3 overflow-x-auto">
        <FilterChips
          rows={rows}
          selected={chips}
          onToggle={onToggleChip}
          onReset={onResetChips}
        />
        <Link
          href="/assignments"
          className="shrink-0 border border-line-hair px-3 py-1.5 font-cond text-micro uppercase tracking-[.09em] text-text-secondary hover:bg-row-hover"
        >
          Assignments
        </Link>
      </div>

      <div className="flex items-center gap-4">
        {/**
          * §9.1. The dot is `status.ontime.fg` when healthy and
          * `status.late.fg` when the feed is down, and the label changes with
          * it: `Last sync 06:41 · 9m ago`, naming the instant rather than only
          * the age, because the instant is what gets said down a phone.
          */}
        <div className="flex items-center gap-[7px]">
          <span
            className={`h-[7px] w-[7px] ${feedStale ? 'bg-status-late-fg' : 'bg-status-ontime-fg'}`}
            aria-hidden="true"
          />
          <span
            className={`font-sans text-[12px] tabular-nums ${feedStale ? 'text-status-late-fg' : 'text-text-secondary'}`}
          >
            {feedStale
              ? feedNewestAt
                ? `Last sync ${timeInZone(new Date(feedNewestAt), dispatchTz)}${
                    feedAge ? ` · ${feedAge} ago` : ''
                  }`
                : 'No positions yet'
              : age
                ? `Synced ${age} ago`
                : 'Syncing…'}
          </span>
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
