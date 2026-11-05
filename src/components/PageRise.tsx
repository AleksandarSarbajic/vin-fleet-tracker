'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { EASING, MOTION_MS, MOTION_SHAPE } from '@/design/tokens';
import { clearStyle, play, whenOver } from '@/lib/motion';

/**
 * §12.149, the page change. The old page is gone as it always was, and the new one
 * fades and rises 6px. `app/template.tsx` mounts this anew on a change of page, and not
 * for a change of `?truck=`, a poll or a refetch: Next keys a template on the segment
 * with its search params taken out.
 *
 * Never on the page a load landed on: that one is the server's first paint, and the
 * board has its own opening. A module's flag and not a ref: the template mounts anew.
 *
 * **A page that is rising has a transform,** so for those frames it is the containing
 * block for everything `fixed` in it, and anything measured against the screen is up to
 * 6px off and stays off when it lands. So what could open or measure ends the rise first:
 * a click or a key, in the capture phase, ahead of whatever will read a box. A press has
 * already held it by then, so what the pointer came down on did not move.
 *
 * The box clips while it rises, or 6px of page below the screen makes the document
 * scroll for 180ms. It has nothing on it otherwise, and no layout of its own.
 */
let landedOnFirstPage = false;

export function PageRise({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!landedOnFirstPage) {
      landedOnFirstPage = true;
      return;
    }
    const el = box.current;
    const page = el?.firstElementChild;
    if (!el || !page) return;
    const rise = play(
      page,
      [
        { opacity: 0, transform: `translateY(${MOTION_SHAPE.pageRisePx}px)` },
        { opacity: 1, transform: 'none' },
      ],
      { duration: MOTION_MS.pageIn, easing: EASING.dialog },
    );
    if (!rise) return;
    el.style.overflow = 'clip';
    const endNow = () => rise.finish();
    window.addEventListener('click', endNow, true);
    window.addEventListener('keydown', endNow, true);
    whenOver(rise, () => {
      window.removeEventListener('click', endNow, true);
      window.removeEventListener('keydown', endNow, true);
      clearStyle(el);
    });
  }, []);

  return (
    <div ref={box} data-page="">
      {children}
    </div>
  );
}
