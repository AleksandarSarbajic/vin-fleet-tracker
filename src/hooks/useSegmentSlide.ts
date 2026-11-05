'use client';

import { useLayoutEffect, useRef } from 'react';
import { slideSegment } from '@/lib/segment-slide';

/**
 * §12.149. The ref for a segmented control's box: `relative isolate`, with each
 * button marked `data-segment={value}`.
 *
 * `settled` is false until a stored choice has been read. That read changes the choice
 * a moment after load with nobody having chosen anything, and on every load a highlight
 * would slide across for no reason. So a change only slides if the control was already
 * settled before it.
 */
export function useSegmentSlide<T extends HTMLElement>(active: string, settled = true) {
  const host = useRef<T | null>(null);
  const last = useRef({ active, settled });

  useLayoutEffect(() => {
    const was = last.current;
    last.current = { active, settled };
    const box = host.current;
    if (!box || was.active === active || !was.settled) return;
    const from = box.querySelector<HTMLElement>(`[data-segment="${was.active}"]`);
    const to = box.querySelector<HTMLElement>(`[data-segment="${active}"]`);
    if (from && to) slideSegment(box, from, to);
  }, [active, settled]);

  return host;
}
