'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  nextDensity,
  readDensity,
  writeDensity,
  type Density,
} from '@/lib/density';
import { isTypingTarget, isWindowOpen } from '@/lib/keymap';

/**
 * §14, feature 5. The density preference, its `D` binding and its storage.
 *
 * Starts at `comfortable` on the server and on the first client render, then
 * corrects in an effect: reading `localStorage` during render would make the
 * markup depend on a value the server cannot see, which is a hydration
 * mismatch rather than a preference.
 */
export function useDensity(): {
  density: Density;
  /** False until the stored value has been read: a choice nobody just made. */
  ready: boolean;
  setDensity: (density: Density) => void;
  toggle: () => void;
  /**
   * §12.159. How many times a person changed the density: the cause of the density glide. Set
   * only in `setDensity` and `toggle` (the Density control, D, the palette, the phone's More
   * sheet), in the same batch as the density, and only when it changes. The stored density
   * read after load leaves it as it is.
   */
  moves: number;
} {
  const [density, setState] = useState<Density>('comfortable');
  const [moves, setMoves] = useState(0);
  /** The density as last set, so a handler knows at once whether this one changes it. */
  const latest = useRef<Density>('comfortable');

  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = readDensity();
    latest.current = stored;
    setState(stored);
    setReady(true);
  }, []);

  const setDensity = useCallback((next: Density) => {
    const changed = next !== latest.current;
    latest.current = next;
    setState(next);
    writeDensity(next);
    if (changed) setMoves((n) => n + 1);
  }, []);

  const toggle = useCallback(() => {
    const next = nextDensity(latest.current);
    latest.current = next;
    setState(next);
    writeDensity(next);
    setMoves((n) => n + 1);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'd' && event.key !== 'D') return;
      if (isTypingTarget(event.target) || isWindowOpen()) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  return { density, ready, setDensity, toggle, moves };
}
