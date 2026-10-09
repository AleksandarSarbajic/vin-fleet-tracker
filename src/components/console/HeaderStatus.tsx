'use client';

import { useEffect, useState } from 'react';
import { elapsed, timeInZone, zoneAbbreviation } from '@/lib/format';
import { isNotUpdating, retryWaitSeconds, type PollHealth } from '@/lib/sync-state';

/**
 * The right-hand end of the header's first row — sync and clocks — shared by
 * the board (§12.91) and the driver history page (§12.101), whose header the
 * design leaves "existing, unchanged". Moved here verbatim from
 * `ConsoleHeader`; the board's baselines hold that nothing moved.
 */

/**
 * Seeded from the FETCH instant, not from the clock.
 *
 * The server renders the header and the browser hydrates it a second or two
 * later; `new Date()` on both sides gives "Synced 2s ago" against "Synced 4s
 * ago", which React reports as a hydration failure and recovers from by
 * re-rendering the tree. Deriving the first paint from a value both sides
 * already share makes the two renders identical, and the interval takes over
 * immediately after mount.
 */
export function useHeaderNow(fetchedAt: string | null): Date {
  const [now, setNow] = useState(() => (fetchedAt ? new Date(fetchedAt) : new Date(0)));
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

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
 * §9.1 / §12.80 / §12.91. Healthy: a green square and "Synced 3s ago". Down:
 * the red block, the instant over the age — "LAST SYNC 17:49 / 25m ago" —
 * which never shortens. No zone suffix: the dispatch clock beside it names
 * the zone.
 *
 * The visible block is not the live region: its age ticks every minute, and
 * a screen reader would read "26m ago" each time. The region is always in the
 * DOM (a region inserted WITH its text is not announced) and changes once,
 * when the feed goes down.
 */
export function HeaderSync({
  now,
  fetchedAt,
  feedNewestAt,
  feedStale,
  dispatchTz,
  poll,
}: {
  now: Date;
  fetchedAt: string | null;
  feedNewestAt: string | null;
  feedStale: boolean;
  dispatchTz: string;
  /** §12.123. The board's own link to us; without it the dot never says "not updating". */
  poll?: PollHealth;
}) {
  const age = elapsed(fetchedAt, now);
  /**
   * §12.123. This browser has not heard from us for a minute: nothing on the
   * board is current, including whether the feed is down. Amber, not red —
   * red is the feed, and the server is the one that says so.
   */
  const notUpdating = poll ? isNotUpdating(poll, now.getTime()) : false;
  const lastAge = poll ? elapsed(new Date(poll.lastSuccessAt).toISOString(), now) : null;
  /** The age of the POSITIONS, which is a different number from `age`. */
  const feedAge = elapsed(feedNewestAt, now);
  const lastSync = feedNewestAt
    ? timeInZone(new Date(feedNewestAt), dispatchTz, { zone: false })
    : null;

  return (
    <>
      <span role="status" aria-live="polite" data-feed-announce="" className="sr-only">
        {feedStale
          ? lastSync
            ? `Feed down. Last sync ${lastSync}.`
            : 'Feed down. No positions yet.'
          : ''}
        {notUpdating ? `${feedStale ? ' ' : ''}Not updating. Last update ${lastAge} ago.` : ''}
      </span>
      {notUpdating && poll ? (
        <NotUpdating
          feedStale={feedStale}
          lastSync={lastSync}
          feedAge={feedAge}
          lastAge={lastAge}
          poll={poll}
          now={now}
        />
      ) : feedStale ? (
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
    </>
  );
}

/**
 * §12.123. The board has stopped hearing from us. Alone: an amber block,
 * "Not updating 2m". With the feed already down: the red block stays, its
 * line folded to one, and the amber line sits under it. Retry asks now — it
 * cancels a request that has hung — except while a 429 asked us to wait.
 */
function NotUpdating({
  feedStale,
  lastSync,
  feedAge,
  lastAge,
  poll,
  now,
}: {
  feedStale: boolean;
  lastSync: string | null;
  feedAge: string | null;
  lastAge: string | null;
  poll: PollHealth;
  now: Date;
}) {
  const wait = retryWaitSeconds(poll, now.getTime());
  const amber = (
    <span
      data-not-updating=""
      className="whitespace-nowrap font-sans text-[12.5px] font-semibold leading-none text-status-risk-fg"
    >
      Not updating {lastAge}
    </span>
  );
  return (
    <div className="flex shrink-0 items-center gap-2">
      {feedStale ? (
        <div
          data-feed-down=""
          className="flex h-9 shrink-0 items-center gap-2 border border-status-late-bd bg-feed-downBg px-[10px]"
        >
          <span aria-hidden="true" className="h-[7px] w-[7px] shrink-0 bg-feed-down" />
          <span data-sync-label="" className="flex flex-col gap-[3px] whitespace-nowrap">
            <span className="font-cond text-micro font-semibold uppercase leading-none tracking-[.1em] text-status-late-fg">
              {lastSync ? `Last sync ${lastSync}${feedAge ? ` · ${feedAge} ago` : ''}` : 'No positions yet'}
            </span>
            {amber}
          </span>
        </div>
      ) : (
        <div
          data-sync-stopped=""
          className="flex h-9 shrink-0 items-center gap-2 border border-status-risk-bd bg-status-risk-bg px-[10px]"
        >
          <span aria-hidden="true" className="h-[7px] w-[7px] shrink-0 bg-status-risk-fg" />
          <span data-sync-label="">{amber}</span>
        </div>
      )}
      <button
        type="button"
        data-sync-retry=""
        onClick={poll.onRetry}
        disabled={wait > 0}
        aria-busy={poll.retrying}
        title={wait > 0 ? `The server asked us to wait ${wait}s.` : 'Ask for the board now.'}
        className="h-9 shrink-0 border border-status-risk-bd px-2.5 font-cond text-micro font-semibold uppercase tracking-[.09em] text-status-risk-fg disabled:opacity-60"
      >
        {wait > 0 ? `Wait ${wait}s` : poll.retrying ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  );
}

/** The dispatch clock, and from 1440 the viewer's own beside it. */
export function HeaderClocks({ now, dispatchTz }: { now: Date; dispatchTz: string }) {
  // The browser's own zone — "CET · YOU" for a dispatcher working from Europe.
  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localTime = `${timeInZone(now, viewerZone).split(' ')[0] ?? ''} ${zoneAbbreviation(now, viewerZone)} · you`;
  return (
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
  );
}
