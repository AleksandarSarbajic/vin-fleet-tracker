'use client';

import { useEffect, useState } from 'react';

/**
 * §12.123. Whether the tab can be seen, and since when. Starts as visible —
 * the server renders it so — and corrects itself on mount.
 */
export function usePageVisible(): { visible: boolean; visibleSince: number | null } {
  const [state, setState] = useState<{ visible: boolean; visibleSince: number | null }>({
    visible: true,
    visibleSince: null,
  });
  useEffect(() => {
    const read = (returned: boolean) => {
      const visible = document.visibilityState !== 'hidden';
      setState({ visible, visibleSince: visible && returned ? Date.now() : null });
    };
    if (document.visibilityState === 'hidden') read(false);
    const onChange = () => read(true);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return state;
}
