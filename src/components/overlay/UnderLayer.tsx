'use client';

import { useCallback, type HTMLAttributes } from 'react';
import { UNDER_LAYER_CLASSES, ownsStackingContext, refusal } from '@/lib/under-layer';

/**
 * §12.165. `layUnder` for a layer React draws: a `div` under its parent's content, which must own
 * a stacking context (`src/lib/under-layer.ts`). Where the parent does not, it refuses as
 * `layUnder` does, loudly, and the layer is hidden rather than painted where nothing shows it.
 */
export function UnderLayer({ className, ...rest }: Omit<HTMLAttributes<HTMLDivElement>, 'aria-hidden'>) {
  const check = useCallback((el: HTMLDivElement | null) => {
    const host = el?.parentElement;
    if (!el || !host || ownsStackingContext(host)) return;
    console.error(refusal(host));
    el.hidden = true;
  }, []);
  return (
    <div
      {...rest}
      ref={check}
      aria-hidden="true"
      className={[...UNDER_LAYER_CLASSES, className].filter(Boolean).join(' ')}
    />
  );
}
