import { APP_TITLE } from './brand';

/**
 * §12.164, phase 3bx (QoL 5). What the browser tab says, the 3bf demo's words.
 *
 *   - **"Not updating · Fleet Tracker"** when this console cannot reach its server: nothing on
 *     the board is current then, including whether the feed is down, so it comes first, as the
 *     header puts its own "Not updating" before the feed-down block (§12.123).
 *   - **"Feed down · Fleet Tracker"** on a stale feed: the board withdraws status (§5.9), so the
 *     title claims no truck is late. The Late chip still counts late there (3bf found wrong 3,
 *     Alex: not yet); the title does not follow it.
 *   - **"N late · Fleet Tracker"**, counted as the Late chip counts (`chipCounts` over the same
 *     rows), so a list in scope narrows it as it narrows the chip.
 *   - Otherwise the plain title, the layout's own (`APP_TITLE`, `app/layout.tsx`).
 */
export function tabTitle({
  late,
  feedStale,
  notUpdating,
}: {
  late: number;
  feedStale: boolean;
  notUpdating: boolean;
}): string {
  if (notUpdating) return 'Not updating · Fleet Tracker';
  if (feedStale) return 'Feed down · Fleet Tracker';
  return late > 0 ? `${late} late · Fleet Tracker` : APP_TITLE;
}
