'use client';

import { useEffect, useRef } from 'react';
import { isTypingTarget } from '@/lib/keymap';

/** How long after G the second key still counts. */
const WINDOW_MS = 1_500;

/**
 * §12.101. Two-key page jumps: G H opens Driver history, G B goes back to the
 * board. Neither key clashed with anything bound before (keymap.ts).
 *
 * The listener is registered at every width and does nothing below 768px:
 * the phone view adds no keyboard HANDLING (§12.96), and keeping the listener
 * count identical is what `phone.spec.ts` holds the phone to.
 */
export function useGoKeys(targets: { h?: () => void; b?: () => void }): void {
  const latest = useRef(targets);
  latest.current = targets;

  useEffect(() => {
    let armedAt = 0;
    const onKey = (event: KeyboardEvent) => {
      if (window.matchMedia('(max-width: 767px)').matches) return;
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'g') {
        armedAt = Date.now();
        return;
      }
      const go = (key === 'h' || key === 'b') && latest.current[key];
      if (go && Date.now() - armedAt < WINDOW_MS) {
        event.preventDefault();
        go();
      }
      armedAt = 0;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
