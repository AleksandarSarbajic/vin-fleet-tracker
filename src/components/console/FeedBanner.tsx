'use client';

import { useEffect, useState } from 'react';
import { timeInZone } from '@/lib/format';

/**
 * design-spec §9.8 — the banner that says WHY the board went grey.
 *
 * §5.9's withdrawal was built in phase 5 and this was not, which left the
 * worst possible pairing: every row dimmed, every ETA reading `stale`, every
 * chip neutral — under a header still showing a green dot and `Synced 12s
 * ago`. A board that looks broken with nothing claiming to be broken reads as
 * the APP failing, not the feed, and the dispatcher's next move is to reload
 * the page rather than to phone whoever owns the worker.
 *
 * So the banner is not decoration on top of the dimming. It is the half that
 * makes the dimming mean something, and the header's sync cluster (§9.1) is
 * the other half.
 *
 * The sentence is the spec's, including the instruction at the end of it:
 * **do not quote an ETA from this screen.** That is the whole reason a
 * dispatcher needs to be told rather than shown.
 */

/** Minutes, in words, because `9m` is not what the sentence says (§9.8). */
function staleInWords(sinceIso: string | null, now: Date): string | null {
  if (!sinceIso) return null;
  const then = Date.parse(sinceIso);
  if (Number.isNaN(then)) return null;

  const minutes = Math.max(0, Math.floor((now.getTime() - then) / 60_000));
  if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} stale`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hoursPart = `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  return rest === 0
    ? `${hoursPart} stale`
    : `${hoursPart} ${rest} ${rest === 1 ? 'minute' : 'minutes'} stale`;
}

function Warning() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M12 3 1.8 20.5h20.4Z" />
      <path d="M12 9.5v5" />
      <path d="M12 17.8h.01" />
    </svg>
  );
}

interface Props {
  /** `feed_health.newest_position_at` — null on a database nothing has polled. */
  feedNewestAt: string | null;
  /** The instant the fleet was last fetched; the auto-retry counts from here. */
  fetchedAt: string | null;
  /** How often the fleet query polls, so the countdown is the real one. */
  pollMs: number;
  dispatchTz: string;
  onRetry: () => void;
  retrying: boolean;
}

export function FeedBanner({
  feedNewestAt,
  fetchedAt,
  pollMs,
  dispatchTz,
  onRetry,
  retrying,
}: Props) {
  /**
   * Seeded from the FETCH instant rather than the clock, for the same reason
   * the header's is (§12.29): the server renders this and the browser
   * hydrates it a second later, and two different "9 minutes" is a hydration
   * failure. The interval takes over immediately after mount.
   */
  const [now, setNow] = useState(() => (fetchedAt ? new Date(fetchedAt) : new Date(0)));
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  const stale = staleInWords(feedNewestAt, now);
  const since = feedNewestAt
    ? timeInZone(new Date(feedNewestAt), dispatchTz, { weekday: true })
    : null;

  /**
   * The real countdown to the next poll, not a decorative one.
   *
   * A number that does not describe anything is worse than no number: it
   * looks like a promise the app has no way to keep, and the first time a
   * dispatcher watches it hit zero with nothing happening, every other
   * countdown in the product stops being believed.
   */
  const nextAt = fetchedAt ? Date.parse(fetchedAt) + pollMs : null;
  const seconds =
    nextAt === null ? null : Math.max(0, Math.ceil((nextAt - now.getTime()) / 1000));

  return (
    <div
      role="alert"
      className="flex h-[38px] shrink-0 items-center gap-2.5 border-b border-status-late-bd bg-status-late-bg px-4 text-status-late-fg"
    >
      <Warning />
      <p className="min-w-0 flex-1 truncate text-body font-medium">
        {since === null ? (
          /**
           * No `newest_position_at` at all. §12.34's singleton: a fresh
           * deployment, or a worker that has never completed one poll. "since
           * —" would read as a formatting bug, so it says the true thing
           * instead, which happens to be the more alarming one.
           */
          <>
            No position has ever reached this database. Nothing below is live —
            do not quote an ETA from this screen.
          </>
        ) : (
          <>
            Position feed unreachable since {since}. Everything below is{' '}
            <span className="underline underline-offset-[3px]">{stale}</span> — do
            not quote an ETA from this screen.
          </>
        )}
      </p>

      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="h-[26px] shrink-0 border border-status-late-fg px-2.5 font-cond text-micro uppercase tracking-[.08em] text-status-late-fg disabled:opacity-45"
      >
        {retrying ? 'Retrying…' : 'Retry now'}
      </button>

      {seconds !== null ? (
        <span className="shrink-0 text-small tabular-nums text-status-late-dim">
          {retrying ? 'retrying now' : `auto-retry in ${seconds}s`}
        </span>
      ) : null}
    </div>
  );
}
