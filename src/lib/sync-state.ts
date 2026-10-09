/**
 * §12.123. Whether the board has stopped hearing from us — the BROWSER's link
 * to our server, not the server's to Samsara (that is the red feed-down
 * block, §9.1). Pure.
 *
 * Measured on the browser's own clock (`dataUpdatedAt`), not the server's
 * `fetchedAt`: a skewed laptop clock would otherwise read a fresh answer as
 * old, and a test that freezes the browser's clock would read every answer
 * as fresh forever.
 */

/** Three 20 s polls missed. */
export const NOT_UPDATING_AFTER_MS = 60_000;
/** After the tab comes back into view, the refetch that follows usually lands sooner than this. */
export const RETURN_GRACE_MS = 10_000;

export interface PollHealth {
  /** When the last successful /api/fleet arrived, by this browser's clock (ms). */
  lastSuccessAt: number;
  visible: boolean;
  /** When the tab last came back into view (ms), or null if it never left. */
  visibleSince: number | null;
  /** A request is in flight. */
  retrying: boolean;
  /** The server asked us to wait until then (a 429's Retry-After), or null. */
  retryBlockedUntil: number | null;
  onRetry: () => void;
}

/** Only while someone can see it, and not in the moments after they come back. */
export function isNotUpdating(
  health: Pick<PollHealth, 'lastSuccessAt' | 'visible' | 'visibleSince'>,
  now: number,
): boolean {
  if (!health.visible) return false;
  if (health.visibleSince !== null && now - health.visibleSince < RETURN_GRACE_MS) return false;
  return now - health.lastSuccessAt > NOT_UPDATING_AFTER_MS;
}

/** Whole seconds until Retry may ask again, or 0. */
export function retryWaitSeconds(health: Pick<PollHealth, 'retryBlockedUntil'>, now: number): number {
  if (health.retryBlockedUntil === null) return 0;
  return Math.max(0, Math.ceil((health.retryBlockedUntil - now) / 1000));
}
