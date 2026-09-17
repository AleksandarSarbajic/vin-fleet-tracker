'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { elapsed, timeInZone, zoneAbbreviation } from '@/lib/format';
import { SearchField } from './SearchField';

/**
 * design-spec §9.1. 56px, raised ground, hairline bottom.
 *
 * TODO(phase 5): the status filter chips belong between the search field and
 * the status cluster — All, Late, At risk, On time, Arrived, Tomorrow, Data
 * issues, Inactive, keyed 1–7 with 0 resetting to All. They are phase 5 scope
 * along with the status engine that makes their counts mean anything.
 */

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
  query: string;
  onQueryChange: (value: string) => void;
  matchCount: number;
  totalCount: number;
  fetchedAt: string | null;
  feedNewestAt: string | null;
  dispatchTz: string;
  userInitials: string;
}

export function ConsoleHeader({
  query,
  onQueryChange,
  matchCount,
  totalCount,
  fetchedAt,
  dispatchTz,
  userInitials,
}: Props) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const age = elapsed(fetchedAt, now);
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

      {/* TODO(phase 5): the Unassigned filter chip links here too, once the
          chips exist. Until then this is the only way in. */}
      <div className="flex items-center">
        <Link
          href="/assignments"
          className="border border-line-hair px-3 py-1.5 font-cond text-micro uppercase tracking-[.09em] text-text-secondary hover:bg-row-hover"
        >
          Assignments
        </Link>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-[7px]">
          <span
            className="h-[7px] w-[7px] bg-status-ontime-fg"
            aria-hidden="true"
          />
          <span className="font-sans text-[12px] tabular-nums text-text-secondary">
            {age ? `Synced ${age} ago` : 'Syncing…'}
          </span>
        </div>

        <div className="flex items-baseline gap-[9px] border-l border-line-hair pl-4">
          <Clock instant={now} zone={dispatchTz} label="DISPATCH" primary />
          <Clock instant={now} zone={viewerZone} label="YOU" />
        </div>

        <span className="inline-flex h-[30px] w-[30px] items-center justify-center border border-line-hair font-cond text-[11px] font-semibold text-text-secondary">
          {userInitials}
        </span>
      </div>
    </header>
  );
}
