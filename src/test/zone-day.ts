/**
 * Phase 3bu. The day and the week an instant falls on in a zone, and the clock a line in the
 * app prints for it, each derived from the instant itself with Intl. A test that puts an
 * arrival "two hours ago" and expects today's view of it is right after 02:00 and wrong
 * before: at 00:30 in Chicago that arrival is yesterday's, and the app rightly says so. These
 * let a test expect what the app shows at any hour, without pasting a date or pinning a clock.
 *
 * Shared by the e2e specs and their vitest cases (`zone-day.test.ts`). The DST instants the
 * cases use come from `dst.ts`, found in code (CLAUDE.md).
 */

export interface CivilDay {
  y: number;
  m: number;
  d: number;
}

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** The calendar day an instant falls on in `zone`. */
export function dayIn(instant: Date, zone: string): CivilDay {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return { y: Number(parts['year']), m: Number(parts['month']), d: Number(parts['day']) };
}

/** That day as `YYYY-MM-DD`: the form `/api/health` gives its own day in. */
export function isoDayIn(instant: Date, zone: string): string {
  const { y, m, d } = dayIn(instant, zone);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function sameDayIn(a: Date, b: Date, zone: string): boolean {
  return isoDayIn(a, zone) === isoDayIn(b, zone);
}

/** Monday 0 … Sunday 6: the history grid's columns, in order. */
export function weekdayIndexIn(instant: Date, zone: string): number {
  const { y, m, d } = dayIn(instant, zone);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** `Mon` … `Sun`, as the app's lines write a weekday. */
export function weekdayIn(instant: Date, zone: string): string {
  return WEEKDAYS[weekdayIndexIn(instant, zone)]!;
}

/**
 * The ISO week of the instant's day in `zone` (Monday to Sunday, the week of its Thursday), as
 * the history page's address writes it: `2026-W46`. Calendar arithmetic on the civil day, so a
 * DST change cannot move it.
 */
export function isoWeekIn(instant: Date, zone: string): string {
  const { y, m, d } = dayIn(instant, zone);
  const thursday = new Date(Date.UTC(y, m - 1, d) + (3 - weekdayIndexIn(instant, zone)) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / (7 * DAY_MS)) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** The zone's abbreviation at the instant, as Intl names it: `CST`, `CDT`. */
export function zoneNameIn(instant: Date, zone: string): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
    .formatToParts(instant)
    .find((part) => part.type === 'timeZoneName')?.value;
  if (!name) throw new Error(`Intl names no abbreviation for ${zone}`);
  return name;
}

/**
 * The time a line in the app prints for an instant in dispatch time (`dispatchTime`,
 * `lib/clear-stop.ts`): `23:20 CST`, and with the weekday first, `Fri 23:20 CST`, when the
 * instant is not on `now`'s day in `zone`.
 */
export function clockAsOf(instant: Date, now: Date, zone: string): string {
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
  const day = sameDayIn(instant, now, zone) ? '' : `${weekdayIn(instant, zone)} `;
  return `${day}${clock} ${zoneNameIn(instant, zone)}`;
}

/**
 * `clockAsOf` as a regular-expression source, for a line drawn at some moment between the
 * `nows` given (taken just before and just after it appeared). When they straddle a midnight
 * in `zone`, either day can be the one the line used, and both are allowed; otherwise exactly
 * one clock is.
 */
export function clockPatternAsOf(instant: Date, nows: readonly Date[], zone: string): string {
  const said = [...new Set(nows.map((now) => clockAsOf(instant, now, zone)))];
  return `(?:${said.join('|')})`;
}

/**
 * The first instant of the instant's day in `zone`: its midnight, found by asking Intl where the
 * day begins, never by subtracting 24 hours (a day is 23 or 25 of them twice a year).
 */
export function startOfDayIn(instant: Date, zone: string): Date {
  const day = isoDayIn(instant, zone);
  // No day is longer than 25 hours, so 26 hours back is on an earlier one.
  let earlier = instant.getTime() - 26 * 3_600_000;
  let within = instant.getTime();
  while (within - earlier > 1) {
    const mid = Math.floor((earlier + within) / 2);
    if (isoDayIn(new Date(mid), zone) === day) within = mid;
    else earlier = mid;
  }
  return new Date(within);
}

/** Midnight of the day after the instant's, in `zone`. */
export function nextMidnightIn(instant: Date, zone: string): Date {
  // 25 hours after a midnight is always on the next day, and never past it.
  return startOfDayIn(new Date(startOfDayIn(instant, zone).getTime() + 25 * 3_600_000), zone);
}
