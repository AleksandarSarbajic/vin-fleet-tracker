'use client';

import { useEffect } from 'react';
import { APP_TITLE } from '@/lib/brand';
import { titleNotUpdating, type PollHealth } from '@/lib/sync-state';
import { tabTitle } from '@/lib/tab-title';
import { useEditingAllowed } from '@/hooks/useEditingAllowed';
import { useHeaderNow } from './HeaderStatus';

/**
 * §12.164, phase 3bx (QoL 5). The board's tab title (`tabTitle`), kept current here: a leaf with
 * its own clock, the header's (`useHeaderNow`), so the console itself does not re-render every
 * second to keep a title. It draws nothing.
 *
 * Leaving the board (to History, Assignments or the login page) puts the layout's plain title
 * back: those pages set none of their own, and a title written here would otherwise stay.
 * Below the editing width nothing new is offered (§12.94): the title stays plain there.
 */
export function TabTitle({
  late,
  feedStale,
  fetchedAt,
  poll,
}: {
  /** The Late chip's own count: `chipCounts` over the rows in scope. */
  late: number;
  feedStale: boolean;
  fetchedAt: string | null;
  poll: Pick<PollHealth, 'lastSuccessAt' | 'visible' | 'visibleSince'>;
}) {
  const now = useHeaderNow(fetchedAt);
  const offered = useEditingAllowed();
  const title = offered
    ? tabTitle({ late, feedStale, notUpdating: titleNotUpdating(poll, now.getTime()) })
    : APP_TITLE;

  // On every render, not only when the title changes: Next writes the layout's title into the
  // head after the board has hydrated (its metadata comes in after the page), which put the
  // plain title back over this one and left it there. This renders each second with its clock.
  useEffect(() => {
    if (document.title !== title) document.title = title;
  });
  useEffect(
    () => () => {
      document.title = APP_TITLE;
    },
    [],
  );
  return null;
}
