'use client';

import { useEffect, useRef, useState } from 'react';
import { RESORT_HOLD_MS } from '@/lib/flash';

/**
 * §14.5's re-sort hold, translated to the mechanism this console actually has.
 *
 * > While the pointer is over the list, or 2+ rows are checked, re-sort is
 * > **held (max 10s)** so a click never lands on a row that just moved.
 *
 * The rule assumes a list that re-sorts itself. This one does not: §12.4 set
 * the order on mount, on a filter or search change, and on explicit user
 * action, and a poll never moves a row. So the hazard the rule guards against
 * is already impossible, by a stronger mechanism than a ten-second timer.
 *
 * What is left of it is real, though. The offer to re-sort — the
 * "3 rows would reorder" pill — appears in flow at the top of the list the
 * moment drift becomes non-zero, and everything below it shifts down by the
 * pill's height. A click aimed at the second row lands on the first. That is
 * the same defect with a smaller displacement, so the same rule holds the
 * same two conditions, and the same ten seconds.
 *
 * Returns true while the offer should be withheld.
 */
export function useResortHold(
  drift: number,
  pointerOver: boolean,
  checkedCount: number,
): boolean {
  const hasDrift = drift > 0;
  const holdWanted = pointerOver || checkedCount >= 2;
  const [held, setHeld] = useState(false);

  /**
   * One release per episode of drift.
   *
   * Without this the pill flickers: the pointer leaves, the pill appears, the
   * pointer comes back to click it and the pill vanishes under the cursor —
   * which is a worse version of the bug the hold exists to prevent.
   */
  const released = useRef(false);

  useEffect(() => {
    if (!hasDrift) {
      released.current = false;
      setHeld(false);
      return;
    }
    if (released.current) return;
    if (!holdWanted) {
      released.current = true;
      setHeld(false);
      return;
    }
    setHeld(true);
    /*
     * `hasDrift` is the dependency, not `drift`. The count changes on most
     * polls, and depending on the number would restart this timer each time —
     * so "max 10s" would become "10s after the board last went quiet", which
     * on a moving fleet is never.
     */
    const timer = window.setTimeout(() => {
      released.current = true;
      setHeld(false);
    }, RESORT_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [hasDrift, holdWanted]);

  return held;
}
