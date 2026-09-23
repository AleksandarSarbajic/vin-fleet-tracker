'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { FLASH_TAG_MS, MOTION_MS } from '@/design/tokens';
import { detectFlashes, type RowFlash } from '@/lib/flash';
import type { FleetSnapshot } from '@/lib/toast';

/**
 * §14 feature 6. Which rows are flashing right now.
 *
 * The detection is pure and lives in `lib/flash`; this is the part that needs
 * a clock — holding each entry for its lifetime and dropping it afterwards.
 *
 * ## Two lifetimes, one ledger
 *
 * With motion the ground decays over `MOTION_MS.flash` and the entry can go
 * the moment it lands. Under reduced motion §14.4 replaces the ground with a
 * static `changed 04:11` tag for a minute — **the signal survives the motion
 * being taken away rather than being dropped with it** — so the same entry has
 * to live 37 times longer. One ledger with a lifetime that depends on the
 * preference, rather than two ledgers that can disagree about what changed.
 *
 * ## Why one timer and not one per row
 *
 * Twenty-three rows changing in a single poll is a real shape (a feed recovery
 * is suppressed, but a dispatch-wide appointment edit is not), and twenty-three
 * `setTimeout`s that all fire within a frame of each other is twenty-three
 * renders. This sweeps on the earliest expiry instead, so a poll costs one
 * timer however many rows moved.
 */
export function useRowFlash(
  snapshot: readonly FleetSnapshot[],
  feedStale: boolean,
  reducedMotion: boolean,
): ReadonlyMap<string, RowFlash> {
  const previous = useRef<Map<string, FleetSnapshot> | null>(null);
  const lastFeedStale = useRef(false);
  const [flashes, setFlashes] = useState<ReadonlyMap<string, RowFlash>>(() => new Map());

  const lifetime = reducedMotion ? FLASH_TAG_MS : MOTION_MS.flash;

  useEffect(() => {
    const found = detectFlashes({
      previous: previous.current,
      next: snapshot,
      feedStaleBefore: lastFeedStale.current,
      feedStaleNow: feedStale,
      now: Date.now(),
    });

    previous.current = new Map(snapshot.map((row) => [row.id, row]));
    lastFeedStale.current = feedStale;
    if (found.size === 0) return;

    setFlashes((current) => {
      const next = new Map(current);
      // A row that changes twice inside one lifetime restarts rather than
      // keeping the older entry: the tag must say when it LAST changed.
      for (const [id, flash] of found) next.set(id, flash);
      return next;
    });
  }, [snapshot, feedStale]);

  /**
   * The sweep. Runs on the earliest expiry and takes everything due with it,
   * then reschedules from whatever is left.
   *
   * `lifetime` is a dependency because the preference can change mid-session:
   * a dispatcher turning reduced motion ON should not be left with entries
   * that were going to expire in 1.6 seconds and now need to last a minute,
   * and turning it OFF should not leave a minute of stale tags on the board.
   */
  useEffect(() => {
    if (flashes.size === 0) return;
    const now = Date.now();
    let earliest = Infinity;
    for (const flash of flashes.values()) {
      earliest = Math.min(earliest, flash.at + lifetime);
    }
    const timer = window.setTimeout(
      () => {
        const at = Date.now();
        setFlashes((current) => {
          const kept = new Map(
            [...current].filter(([, flash]) => flash.at + lifetime > at),
          );
          // Identity matters: an unchanged map here would re-render every row
          // memo for nothing.
          return kept.size === current.size ? current : kept;
        });
      },
      Math.max(0, earliest - now),
    );
    return () => window.clearTimeout(timer);
  }, [flashes, lifetime]);

  /** Stable empty map, so "nothing is flashing" is one identity forever. */
  const empty = useMemo(() => new Map<string, RowFlash>(), []);
  return flashes.size === 0 ? empty : flashes;
}
