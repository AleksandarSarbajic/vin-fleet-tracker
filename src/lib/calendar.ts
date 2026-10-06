/**
 * Calendar days, as `YYYY-MM-DD` strings.
 *
 * Shared by the status engine (TOMORROW, the upcoming day), the appointment
 * contract (the day an overnight window ends, §12.114) and the display (the
 * `+1` on a window that ends on a later day). One implementation, because
 * three copies of "the next day" is how one of them ends up adding 24 hours.
 */

/** The calendar day after a `YYYY-MM-DD`. Date arithmetic, not 24 hours — DST-proof. */
export function nextCalendarDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** The calendar date in a zone, as YYYY-MM-DD. */
export function calendarDayInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}
