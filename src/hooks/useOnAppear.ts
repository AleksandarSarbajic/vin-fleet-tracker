'use client';

import { useLayoutEffect, useRef } from 'react';

/**
 * §12.152. Runs `start` in the commit where `shown` turns true, ahead of its first frame.
 *
 * Never in the commit this component mounted in: what came with the page or with the window
 * was not seen arriving, and the server's HTML is already painted, so a fade there would
 * flash. A re-render while `shown` stays true runs nothing, whatever else changed. So the
 * component that calls this is the one that stays: the board, the header, the window.
 */
export function useOnAppear(shown: boolean, start: () => void): void {
  const was = useRef(shown);
  useLayoutEffect(() => {
    const before = was.current;
    was.current = shown;
    if (shown && !before) start();
  });
}
