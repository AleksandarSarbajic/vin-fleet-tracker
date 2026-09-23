'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useFocusTrap, useReturnFocus } from '@/components/edit/useModalChrome';
import { useReducedMotion } from '@/hooks/useReducedMotion';

/**
 * The one overlay layer (§14.5).
 *
 * > Palette, cheat sheet and tour share one scrim and one layer — only one
 * > open at a time. ⌘K during the tour ends the tour; `?` inside the palette
 * > types a "?".
 *
 * Three surfaces that each want the whole screen is three chances to end up
 * with two scrims stacked, or a tour pointing at a control the palette is
 * covering. Making "which overlay is open" a single value rather than three
 * booleans is what makes those states unrepresentable instead of merely
 * unlikely.
 *
 * The edit modal is deliberately NOT on this layer. It is a form with unsaved
 * state and its own discard confirm (§9.9), and it sits above at z-40 with
 * the heavier `scrim`. These three carry nothing a user can lose.
 */

export type OverlayName = 'shortcuts' | 'palette' | 'tour';

interface OverlayApi {
  /** The overlay currently on screen, or null. Never two. */
  open: OverlayName | null;
  /**
   * Show one, or close with null. Opening while another is open replaces it
   * — that is §14.5's "⌘K during the tour ends the tour", generalised, since
   * the alternative is deciding a precedence order for every pair.
   */
  show: (name: OverlayName | null) => void;
  /** Convenience for a button that opens and closes the same overlay. */
  toggle: (name: OverlayName) => void;
}

const Ctx = createContext<OverlayApi | null>(null);

export function OverlayProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState<OverlayName | null>(null);
  const show = useCallback((name: OverlayName | null) => setOpen(name), []);
  const toggle = useCallback(
    (name: OverlayName) => setOpen((current) => (current === name ? null : name)),
    [],
  );
  const api = useMemo(() => ({ open, show, toggle }), [open, show, toggle]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useOverlay(): OverlayApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useOverlay outside OverlayProvider');
  return api;
}

/**
 * The scrim and panel every overlay shares.
 *
 * Motion is opacity only at 120ms (§14.4). No scale, no slide: these appear
 * over a list that may be re-sorting underneath, and a panel that moves while
 * the content behind it moves reads as the list having jumped.
 */
export function Overlay({
  name,
  label,
  children,
  width = 'w-[560px]',
}: {
  name: OverlayName;
  /** Names the dialog for assistive tech. Required — there is no sensible default. */
  label: string;
  children: React.ReactNode;
  width?: string;
}) {
  const { open, show } = useOverlay();
  const isOpen = open === name;
  const reduced = useReducedMotion();
  const trap = useFocusTrap(isOpen);
  useReturnFocus(isOpen);

  /**
   * Esc closes whichever one is open. Registered on the layer rather than in
   * each overlay, so a new overlay cannot ship without it.
   *
   * Capture phase: an input inside the panel may stop propagation of its own
   * Esc (the search field clears itself first), and the overlay still has to
   * close.
   */
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        show(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isOpen, show]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-30 grid place-items-center bg-scrimOverlay p-6 ${
        reduced ? '' : 'duration-overlay transition-opacity'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      // The scrim closes. A click that lands on the panel must not, so this
      // checks the target rather than relying on the panel to stop it —
      // stopPropagation on the panel would also swallow clicks the panel's
      // own children want to hear about.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) show(null);
      }}
    >
      <div
        ref={trap}
        className={`max-h-full ${width} max-w-full overflow-auto border border-line-hair bg-surface-overlay shadow-modal`}
      >
        {children}
      </div>
    </div>
  );
}
