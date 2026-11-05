'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { barClosing, barOpened } from '@/lib/bulk-bar-motion';

/** §12.149. The bar's own box: what it clips against on its way in and out. */
export function BulkBarSlot({ children }: { children: ReactNode }) {
  const slot = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = slot.current;
    if (!el) return;
    barOpened(el);
    return () => barClosing(el);
  }, []);

  return (
    <div ref={slot} className="shrink-0">
      {children}
    </div>
  );
}
