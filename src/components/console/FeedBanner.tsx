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
      /*
       * §12.96, stage 4. On a phone the sentence WRAPS, whole: cut to one line
       * it lost exactly its point — "do not quote an ETA from this screen" —
       * at every phone size. Retry now and the countdown take a second line
       * there, Retry at 44px.
       */
      className="flex h-[38px] shrink-0 items-center gap-2.5 border-b border-status-late-bd bg-status-late-bg px-4 text-status-late-fg max-md:h-auto max-md:flex-wrap max-md:gap-y-2 max-md:px-3 max-md:py-2.5"
    >
      <Warning />
      <p className="min-w-0 flex-1 truncate text-body font-medium max-md:basis-[calc(100%-2rem)] max-md:whitespace-normal">
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

      {/*
       * §12.98. Neither the button nor the countdown may change width with
       * what it says, or "Retry now" jumps sideways every time the count
       * crosses 10 — and again when the label becomes "Retrying…". Each is
       * sized by invisible copies of its widest text, with the live text laid
       * over them: two digits in tabular figures for the count (the poll is
       * 20 s), and the longer of the two labels for the button.
       */}
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="inline-grid h-[26px] shrink-0 place-items-center border border-status-late-fg px-2.5 font-cond text-micro uppercase tracking-[.08em] text-status-late-fg disabled:opacity-45 max-md:ml-[26px] max-md:h-11 max-md:px-4"
      >
        <span aria-hidden="true" className="invisible [grid-area:1/1]">
          Retry now
        </span>
        <span aria-hidden="true" className="invisible [grid-area:1/1]">
          Retrying…
        </span>
        <span className="[grid-area:1/1]">{retrying ? 'Retrying…' : 'Retry now'}</span>
      </button>

      {seconds !== null ? (
        <span className="relative shrink-0 whitespace-nowrap text-small tabular-nums text-status-late-dim">
          <span aria-hidden="true" className="invisible">
            auto-retry in {'0'.repeat(String(Math.ceil(pollMs / 1000)).length)}s
          </span>
          <span className="absolute left-0 top-0">
            {retrying ? 'retrying now' : `auto-retry in ${seconds}s`}
          </span>
        </span>
      ) : null}
    </div>
  );
}
