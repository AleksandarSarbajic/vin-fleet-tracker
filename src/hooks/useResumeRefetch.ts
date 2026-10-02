'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * §12.96 — back from the background, the board asks again at once, and says
 * it is asking until the answer lands.
 *
 * A phone freezes a hidden tab's timers. When it comes back, everything on
 * screen was computed before it left: the fleet is minutes old and the
 * "3s ago" beside it was worked out against a clock that stopped. So the
 * moment the page is visible again (`visibilitychange`, or `pageshow` from
 * the back-forward cache) this refetches and returns true until the refetch
 * settles; the phone's top bar shows "Updating…" in place of any age.
 *
 * `cancelRefetch: false` joins a fetch already in flight — React Query's own
 * refetch-on-focus — rather than cancelling it and sending a second. A
 * failed refetch still settles; the fetch-error banner says what went wrong.
 */
export function useResumeRefetch(
  refetch: (options: { cancelRefetch: boolean }) => Promise<unknown>,
): boolean {
  const [resuming, setResuming] = useState(false);
  const latest = useRef(refetch);
  latest.current = refetch;

  useEffect(() => {
    let alive = true;
    /** Only the newest return clears the marker: two quick returns, one marker. */
    let generation = 0;
    const resume = () => {
      generation += 1;
      const mine = generation;
      setResuming(true);
      const settle = () => {
        if (alive && mine === generation) setResuming(false);
      };
      latest.current({ cancelRefetch: false }).then(settle, settle);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') resume();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) resume();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  return resuming;
}
