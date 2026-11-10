import { STOPPED_BELOW_MPH } from './arrival';
import { isStale } from './status';

/**
 * §12.151. Whether a truck's newest fix says it is driving: faster than the
 * arrival sweep's stopped threshold, and not stale by the same rule as
 * STALE_GPS (`staleMinutes`). A fix with no speed is not moving; no fix at
 * all is stale.
 *
 * The board uses it to say how many inactive trucks are moving. After
 * §12.151 those are, in practice, the ones an admin switched off: the worker
 * switches the rest on at their first moving fix.
 */
export function isMovingFix(
  speedMph: number | null,
  recordedAtUtc: string | null,
  staleMinutes: number,
  now: Date,
): boolean {
  if (speedMph === null || !(speedMph > STOPPED_BELOW_MPH)) return false;
  return !isStale(recordedAtUtc, staleMinutes, now);
}
