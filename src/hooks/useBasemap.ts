'use client';

import { useCallback, useEffect, useState } from 'react';
import { readBasemap, writeBasemap, type Basemap } from '@/lib/basemap';

/**
 * The basemap preference and its storage.
 *
 * Starts at `dark` on the server and on the first client render, then
 * corrects in an effect — reading `localStorage` during render would make the
 * markup depend on a value the server cannot see, which is a hydration
 * mismatch rather than a preference. Exactly `useDensity`'s rule.
 */
export function useBasemap(): {
  basemap: Basemap;
  /**
   * False until the stored value has been read. The map waits for it rather
   * than mounting at the default and switching a frame later.
   */
  ready: boolean;
  setBasemap: (basemap: Basemap) => void;
} {
  const [basemap, setState] = useState<Basemap>('dark');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setState(readBasemap());
    setReady(true);
  }, []);

  const setBasemap = useCallback((next: Basemap) => {
    setState(next);
    writeBasemap(next);
  }, []);

  return { basemap, ready, setBasemap };
}
