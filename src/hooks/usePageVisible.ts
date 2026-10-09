'use client';

import { useEffect, useState } from 'react';

/**
 * §12.123. Whether the tab can be seen, and since when.
 *
 * Not known until the page has loaded, and read as NOT visible until then,
 * so "Not updating" is never said on the first render. That render compares
 * the server's fetch instant with the browser's clock; a browser clock a
 * minute behind the server's would say it where the server's HTML did not,
 * and React would throw that HTML away (#418). The effect reads the truth.
 */
export function usePageVisible(): { visible: boolean; visibleSince: number | null } {
  const [state, setState] = useState<{ visible: boolean; visibleSince: number | null }>({
    visible: false,
    visibleSince: null,
  });
  useEffect(() => {
    const read = (returned: boolean) => {
      const visible = document.visibilityState !== 'hidden';
      setState({ visible, visibleSince: visible && returned ? Date.now() : null });
    };
    read(false);
    const onChange = () => read(true);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return state;
}
