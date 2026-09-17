'use client';

import { useEffect, useRef } from 'react';

/**
 * Focus trap, initial focus, and return focus on close (§8.2, §9.9).
 *
 * Initial focus goes to `[data-initial-focus]` when the modal names one, and
 * only falls back to the first focusable element otherwise.
 *
 * That fallback is what made the driver picker open by itself: the picker was
 * simply the first control in the DOM, this focused it, and its `onFocus`
 * opened the list. The dropdown was not opening on mount — it was being
 * pointed at. A modal that knows which field the dispatcher came to change
 * should say so, rather than every picker learning not to trust focus.
 *
 * Esc is deliberately NOT handled here: it raises the discard confirm rather
 * than closing, and only the modal knows whether anything is dirty.
 */
export function useFocusTrap(active: boolean) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    const root = container.current;
    if (!root) return;

    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      [
        ...root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null);

    const chosen = root.querySelector<HTMLElement>('[data-initial-focus]');
    (chosen ?? focusable()[0])?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const current = document.activeElement;
      if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous?.focus();
    };
  }, [active]);

  return container;
}
