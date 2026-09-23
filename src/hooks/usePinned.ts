'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PIN_CAP, readPinned, togglePin, writePinned } from '@/lib/pinned';
import { isTypingTarget } from '@/lib/keymap';

/**
 * §14 feature 4. The pin list, its `P` binding and its storage.
 *
 * Read in an effect rather than during render, for the same reason density
 * is: `localStorage` is invisible to the server and reading it while
 * rendering is a hydration mismatch, not a preference.
 */
export function usePinned(selectedId: string | null): {
  pinned: string[];
  isPinned: (id: string) => boolean;
  toggle: (id: string) => void;
  /** Set for a moment when a pin was refused at the cap, so the UI can say so. */
  refused: boolean;
  atCap: boolean;
} {
  const [pinned, setPinned] = useState<string[]>([]);
  const [refused, setRefused] = useState(false);

  useEffect(() => setPinned(readPinned()), []);

  const toggle = useCallback((id: string) => {
    setPinned((current) => {
      const result = togglePin(current, id);
      if (result.refused) {
        setRefused(true);
        return current;
      }
      setRefused(false);
      writePinned(result.ids);
      return result.ids;
    });
  }, []);

  /** The refusal is a flash, not a state — it clears itself. */
  useEffect(() => {
    if (!refused) return;
    const timer = window.setTimeout(() => setRefused(false), 2_400);
    return () => window.clearTimeout(timer);
  }, [refused]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'p' && event.key !== 'P') return;
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!selectedId) return;
      event.preventDefault();
      toggle(selectedId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, selectedId]);

  const set = useMemo(() => new Set(pinned), [pinned]);

  return {
    pinned,
    isPinned: useCallback((id: string) => set.has(id), [set]),
    toggle,
    refused,
    atCap: pinned.length >= PIN_CAP,
  };
}
