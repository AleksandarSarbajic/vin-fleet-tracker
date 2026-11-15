import { calendarDayInZone, nextCalendarDay } from './calendar';

/**
 * Phase 3bw, QoL feature 4 (§12.163). Today and Tomorrow beside an appointment's date.
 *
 * The date AT THE STOP, worked out at the click from the stop's own zone, never the
 * dispatcher's: a dispatcher in Chicago at 23:30 is on another date from a stop in New York,
 * and the date picker opens on the dispatcher's own. Date parts only, as a wall date
 * (`YYYY-MM-DD`, what the date input holds), so it goes the way a typed date goes and the
 * server converts (CLAUDE.md: nothing builds an instant to send). Tomorrow is calendar
 * arithmetic on that date, never 24 hours: twice a year the stop's day is 23 or 25 of them.
 */

export type StopDayChoice = 'today' | 'tomorrow';

/** The date at the stop for Today or Tomorrow, read from `now` in the stop's zone. */
export function stopDay(now: Date, stopZone: string, which: StopDayChoice): string {
  const today = calendarDayInZone(now, stopZone);
  return which === 'today' ? today : nextCalendarDay(today);
}

/** The zone the person at this screen is in: what the date picker opens on. */
export function ownZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** "Sat 7 Nov", a calendar date as words. Display only: the date is the date, in no zone. */
export function dayWords(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * The note under the date after a click, when the stop's date differs from the dispatcher's
 * own: so a date that is not the one on the dispatcher's calendar is never a surprise. Null
 * when the two agree.
 */
export function stopDayNote(now: Date, stopZone: string, viewerZone: string): string | null {
  const here = calendarDayInZone(now, stopZone);
  const mine = calendarDayInZone(now, viewerZone);
  if (here === mine) return null;
  return `At this stop it is ${dayWords(here)}. Your own date is ${dayWords(mine)}.`;
}
