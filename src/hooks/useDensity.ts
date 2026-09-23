'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  nextDensity,
  readDensity,
  writeDensity,
  type Density,
} from '@/lib/density';
import { isTypingTarget } from '@/lib/keymap';

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
  setDensity: (density: Density) => void;
  toggle: () => void;
} {
  const [density, setState] = useState<Density>('comfortable');

  useEffect(() => setState(readDensity()), []);

  const setDensity = useCallback((next: Density) => {
    setState(next);
    writeDensity(next);
  }, []);

  const toggle = useCallback(
    () => setState((current) => {
      const next = nextDensity(current);
      writeDensity(next);
      return next;
    }),
    [],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'd' && event.key !== 'D') return;
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  return { density, setDensity, toggle };
}
