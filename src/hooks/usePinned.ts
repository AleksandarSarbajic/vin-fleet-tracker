'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PIN_CAP, readPinned, togglePin, writePinned } from '@/lib/pinned';
import { isTypingTarget, isWindowOpen } from '@/lib/keymap';

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
  /**
   * §12.159. A person's pins and unpins that went through, counted, with the truck of the last:
   * the cause of the pin glide. Set only in `toggle` (the star, P, the palette), in the same
   * batch as the pins it changed, so it changes in the commit they land in. Pins read from
   * storage and a refusal at the cap leave it as it is.
   */
  moved: { count: number; id: string | null };
} {
  const [pinned, setPinned] = useState<string[]>([]);
  const [refused, setRefused] = useState(false);
  const [moved, setMoved] = useState<{ count: number; id: string | null }>({ count: 0, id: null });
  /** The pins as last set, so `toggle` knows at once whether this one goes through. */
  const latest = useRef<string[]>([]);

  useEffect(() => {
    const stored = readPinned();
    latest.current = stored;
    setPinned(stored);
  }, []);

  const toggle = useCallback((id: string) => {
    const result = togglePin(latest.current, id);
    if (result.refused) {
      setRefused(true);
      return;
    }
    latest.current = result.ids;
    setRefused(false);
    writePinned(result.ids);
    setPinned(result.ids);
    setMoved((last) => ({ count: last.count + 1, id }));
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
      if (isTypingTarget(event.target) || isWindowOpen()) return;
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
    moved,
  };
}
