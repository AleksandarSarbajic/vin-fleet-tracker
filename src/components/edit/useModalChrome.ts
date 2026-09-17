'use client';

import { useEffect, useRef } from 'react';

/**
 * Focus trap, initial focus, and return focus on close (§8.2, §9.9).
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

    focusable()[0]?.focus();

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
