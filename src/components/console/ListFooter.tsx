'use client';

import type { FleetRow } from '@/server/fleet-query';
import { STATUS_LABEL, isProblem } from '@/lib/status';

/**
 * design-spec §3.1. The replacement for the retired no-scroll promise: the
 * problem set is always at the top, and anything below the fold is counted
 * here by status — including the explicit "0 problems below the fold", which
 * is the whole point. A dispatcher never has to scroll to find out whether
 * scrolling matters.
 */
export function ListFooter({
  rows,
  firstVisible,
  lastVisible,
}: {
  rows: FleetRow[];
  firstVisible: number;
  lastVisible: number;
}) {
  const below = rows.slice(lastVisible + 1);
  const problems = below.filter((r) => isProblem(r.status)).length;

  const counts = new Map<string, number>();
  for (const row of below) {
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  }
  const breakdown = [...counts.entries()]
    .map(([status, n]) => `${n} ${STATUS_LABEL[status as keyof typeof STATUS_LABEL].toLowerCase()}`)
    .join(', ');

  // Before the virtualizer has measured its scroller — server render, and the
  // first client paint — nothing is visible yet. "Showing 1-0 of 23" is worse
  // than saying nothing, so the range collapses to 0.
  const nothingVisible = lastVisible < firstVisible;
  const from = rows.length === 0 || nothingVisible ? 0 : firstVisible + 1;
  const to = nothingVisible ? 0 : Math.min(lastVisible + 1, rows.length);

  return (
    <div className="flex h-[30px] shrink-0 items-center justify-between border-t border-line-hair bg-surface-bar px-4 text-small text-text-secondary">
      <span>
        Showing <span className="tabular-nums text-text">{from}–{to}</span> of{' '}
        <span className="tabular-nums text-text">{rows.length}</span>
      </span>

      <span className="flex items-center gap-[14px]">
        {problems === 0 ? (
          <span className="tabular-nums text-status-ontime-fg">
            0 problems below the fold
          </span>
        ) : (
          <span className="tabular-nums text-status-late-fg">
            {problems} {problems === 1 ? 'problem' : 'problems'} below the fold
          </span>
        )}
        {below.length > 0 ? (
          <span className="tabular-nums text-text-muted">
            {below.length} below: {breakdown}
          </span>
        ) : null}
      </span>
    </div>
  );
}
