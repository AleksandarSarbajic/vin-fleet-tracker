import { describe, expect, it } from 'vitest';
import { nextCalendarDay } from './calendar';
import { dayWords, stopDay, stopDayNote } from './stop-day';
import { YEAR, fallBack, springForward } from '@/test/dst';
import { isoDayIn, nextMidnightIn, startOfDayIn } from '@/test/zone-day';

/**
 * Phase 3bw, QoL feature 4 (§12.163). The 3bf table's four cases, the dispatcher in Chicago.
 * Every date is derived in code from Intl (CLAUDE.md: never paste a DST date): the clock
 * changes from `dst.ts`, the midnights from `zone-day.ts`. The expectations are relations
 * between days, never a pasted date.
 */
const CHICAGO = 'America/Chicago';
const HOUR = 3_600_000;
const MIN = 60_000;
/** Mid-June of this year at noon UTC: an ordinary day, nowhere near a clock change. */
const JUNE = new Date(Date.UTC(YEAR, 5, 15, 12));

describe('Today and Tomorrow at the stop', () => {
  it('the stop ahead: New York at 00:30 is a day ahead of Chicago, and Today writes New York\'s date', () => {
    const at = new Date(startOfDayIn(JUNE, 'America/New_York').getTime() + 30 * MIN);
    const mine = isoDayIn(at, CHICAGO);
    const today = stopDay(at, 'America/New_York', 'today');
    expect(today).toBe(nextCalendarDay(mine));
    expect(stopDay(at, 'America/New_York', 'tomorrow')).toBe(nextCalendarDay(today));
    expect(stopDayNote(at, 'America/New_York', CHICAGO)).toBe(
      `At this stop it is ${dayWords(today)}. Your own date is ${dayWords(mine)}.`,
    );
  });

  it('the stop behind: at 00:30 in Chicago, Denver is still on the day before', () => {
    const at = new Date(startOfDayIn(JUNE, CHICAGO).getTime() + 30 * MIN);
    const mine = isoDayIn(at, CHICAGO);
    const today = stopDay(at, 'America/Denver', 'today');
    expect(nextCalendarDay(today)).toBe(mine);
    expect(stopDay(at, 'America/Denver', 'tomorrow')).toBe(mine);
    expect(stopDayNote(at, 'America/Denver', CHICAGO)).toBe(
      `At this stop it is ${dayWords(today)}. Your own date is ${dayWords(mine)}.`,
    );
  });

  it('the 25-hour day: at 00:30 on the fall-back day, Tomorrow is the next date, not 24 hours on', () => {
    const start = startOfDayIn(fallBack(CHICAGO, YEAR), CHICAGO);
    expect(nextMidnightIn(start, CHICAGO).getTime() - start.getTime()).toBe(25 * HOUR);
    const at = new Date(start.getTime() + 30 * MIN);
    const day = isoDayIn(at, CHICAGO);
    expect(stopDay(at, CHICAGO, 'today')).toBe(day);
    expect(stopDay(at, CHICAGO, 'tomorrow')).toBe(nextCalendarDay(day));
    // What 24 hours would have written: the same date, still that long day.
    expect(isoDayIn(new Date(at.getTime() + 24 * HOUR), CHICAGO)).toBe(day);
    expect(stopDayNote(at, CHICAGO, CHICAGO)).toBeNull();
  });

  it('the 23-hour day: on it and on the evening before, Tomorrow is the next date, not 24 hours on', () => {
    const start = startOfDayIn(springForward(CHICAGO, YEAR), CHICAGO);
    expect(nextMidnightIn(start, CHICAGO).getTime() - start.getTime()).toBe(23 * HOUR);
    const late = new Date(start.getTime() + 22 * HOUR + 30 * MIN);
    const day = isoDayIn(late, CHICAGO);
    expect(stopDay(late, CHICAGO, 'today')).toBe(day);
    expect(stopDay(late, CHICAGO, 'tomorrow')).toBe(nextCalendarDay(day));

    const eve = new Date(start.getTime() - 30 * MIN);
    const before = isoDayIn(eve, CHICAGO);
    expect(nextCalendarDay(before)).toBe(day);
    expect(stopDay(eve, CHICAGO, 'tomorrow')).toBe(day);
    // 24 hours from that evening is already past the short day.
    expect(isoDayIn(new Date(eve.getTime() + 24 * HOUR), CHICAGO)).toBe(nextCalendarDay(day));
  });

  it('no note when the stop and the dispatcher are on the same date', () => {
    expect(stopDayNote(JUNE, 'America/New_York', CHICAGO)).toBeNull();
  });

  it('a date in words, with no zone: the calendar date itself', () => {
    const day = isoDayIn(JUNE, CHICAGO);
    expect(dayWords(day)).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) 15 Jun$/);
  });
});
