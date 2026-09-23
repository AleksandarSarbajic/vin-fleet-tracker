'use client';

import { timeInZone } from '@/lib/format';

/**
 * §14 feature 7, the half that is not about an empty list: the console cannot
 * reach its own server.
 *
 * **Interpretation**, and it fills a real hole. `useFleet` keeps the last good
 * fleet through a failed refetch (`placeholderData`), which is right — a
 * console that blanks on one dropped request is unusable on a night shift —
 * but nothing said so. Every number on screen simply stopped moving, and the
 * fetch age in the header was the only clue.
 *
 * Amber, not red, and the wording carries the reason. §9.8's feed banner is
 * red because the POSITIONS are stale and an ETA read off that screen must not
 * be quoted to a broker. This is one step down: the data on screen was good
 * when it arrived and has simply stopped being refreshed. Both can be true at
 * once, and both are worth saying — they have different fixes.
 */
export function FetchErrorBanner({
  fetchedAt,
  dispatchTz,
  pollMs,
  onRetry,
  retrying,
}: {
  fetchedAt: string | null;
  dispatchTz: string;
  pollMs: number;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-3 border-b border-status-risk-bd bg-status-risk-bg px-4 py-2 text-body text-status-risk-fg"
    >
      <span className="flex-1">
        Can’t reach the console server.{' '}
        {fetchedAt ? (
          <>
            Showing the fleet as it stood at{' '}
            <span className="tabular-nums text-text">
              {timeInZone(new Date(fetchedAt), dispatchTz)}
            </span>
            .
          </>
        ) : (
          <>Nothing has loaded yet.</>
        )}{' '}
        Retrying every {Math.round(pollMs / 1000)}s.
      </span>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="shrink-0 font-cond text-micro uppercase tracking-[.08em] text-text disabled:text-text-muted"
      >
        {retrying ? 'Retrying…' : 'Retry now'}
      </button>
    </div>
  );
}
