/**
 * DST boundaries, DERIVED (§7, CLAUDE.md): found by asking Intl where a zone's
 * offset changes, never pasted from a calendar that goes stale.
 *
 * Moved here from server/appointment.test.ts when the overnight window tests
 * (§12.114) needed the same nights in four suites. One derivation, so a fix
 * to it is a fix everywhere.
 */

/** Minutes east of UTC in `zone` at `at`. */
export function offsetMinutes(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asIfUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return (asIfUtc - at.getTime()) / 60_000;
}

/** Every UTC instant in `year` where `zone` changes offset, to the minute. */
export function transitions(zone: string, year: number): Date[] {
  const found: Date[] = [];
  const DAY = 86_400_000;
  let cursor = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  let previous = offsetMinutes(zone, new Date(cursor));

  while (cursor < end) {
    const next = Math.min(cursor + DAY, end);
    const offset = offsetMinutes(zone, new Date(next));
    if (offset !== previous) {
      // Narrow the day to the minute the offset actually moved.
      let lo = cursor;
      let hi = next;
      while (hi - lo > 60_000) {
        const mid = lo + Math.floor((hi - lo) / 2 / 60_000) * 60_000;
        if (offsetMinutes(zone, new Date(mid)) === previous) lo = mid;
        else hi = mid;
      }
      found.push(new Date(hi));
      previous = offset;
    }
    cursor = next;
  }
  return found;
}

/** The local calendar date on which the clocks move, in that zone. */
export function localDateOf(zone: string, instant: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  const [y, m, d] = parts.split('-').map(Number);
  return { y: y!, m: m!, d: d! };
}

export const YEAR = new Date().getUTCFullYear();

export function springForward(zone: string, year: number): Date {
  const forward = transitions(zone, year).find(
    (t) => offsetMinutes(zone, new Date(t.getTime() + 60_000)) >
           offsetMinutes(zone, new Date(t.getTime() - 60_000)),
  );
  if (!forward) throw new Error(`${zone} has no spring-forward in ${year}`);
  return forward;
}

export function fallBack(zone: string, year: number): Date {
  const back = transitions(zone, year).find(
    (t) => offsetMinutes(zone, new Date(t.getTime() + 60_000)) <
           offsetMinutes(zone, new Date(t.getTime() - 60_000)),
  );
  if (!back) throw new Error(`${zone} has no fall-back in ${year}`);
  return back;
}

/** The day before a `{y, m, d}`, as parts. Calendar arithmetic. */
export function dayBefore(date: { y: number; m: number; d: number }): {
  y: number;
  m: number;
  d: number;
} {
  const at = new Date(Date.UTC(date.y, date.m - 1, date.d - 1));
  return { y: at.getUTCFullYear(), m: at.getUTCMonth() + 1, d: at.getUTCDate() };
}

/**
 * The local date whose EVENING starts the night the clocks change in `zone`:
 * a 22:00–06:00 window opened on it closes after the change.
 */
export function eveningBefore(zone: string, change: Date): { y: number; m: number; d: number } {
  return dayBefore(localDateOf(zone, change));
}
