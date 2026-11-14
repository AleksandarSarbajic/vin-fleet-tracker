import { describe, expect, it } from 'vitest';
import { dispatchTime } from '@/lib/clear-stop';
import { formatIsoWeek, isoWeekOf, shiftWeek } from '@/lib/history-week';
import { YEAR, dayBefore, fallBack, springForward } from './dst';
import {
  clockAsOf,
  clockPatternAsOf,
  dayIn,
  isoDayIn,
  isoWeekIn,
  nextMidnightIn,
  sameDayIn,
  startOfDayIn,
  weekdayIn,
  weekdayIndexIn,
  zoneNameIn,
} from './zone-day';

/**
 * Phase 3bu. The helpers the e2e specs derive "today" and "this week" with, at the instants
 * where a test written for the afternoon goes wrong: either side of Chicago's midnight, the
 * first half hour of a Monday, and both DST changes. Every instant is derived here, from the
 * clock and from `dst.ts`: none is pasted, so the cases move with the calendar.
 */

const TZ = 'America/Chicago';
const MIN = 60_000;
const HOUR = 3_600_000;
const at = (base: Date, ms: number) => new Date(base.getTime() + ms);
const wall = (instant: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    instant,
  );
/** What the app prints for the instant on a line read at `now`. */
const appSays = (instant: Date, now: Date) => dispatchTime(instant.toISOString(), TZ, now);
/** The app's own ISO week of the instant's day in Chicago. */
const appWeek = (instant: Date) => isoWeekOf(dayIn(instant, TZ));

const midnight = startOfDayIn(new Date(), TZ);
const minuteBefore = at(midnight, -MIN);
const minuteAfter = at(midnight, MIN);
const mondayMidnight = (() => {
  let day = midnight;
  while (weekdayIndexIn(day, TZ) !== 0) day = nextMidnightIn(day, TZ);
  return day;
})();
const mondayHalfPast = at(mondayMidnight, 30 * MIN);

describe('Chicago midnight, found and not assumed', () => {
  it('starts the day: 00:00 on the wall, and the minute before is the day before', () => {
    expect(wall(midnight)).toBe('00:00');
    expect(dayIn(minuteBefore, TZ)).toEqual(dayBefore(dayIn(minuteAfter, TZ)));
    expect(sameDayIn(at(midnight, -1), midnight, TZ)).toBe(false);
    expect(sameDayIn(midnight, minuteAfter, TZ)).toBe(true);
  });

  it('one minute after: an arrival two hours before is yesterday, and its line names the weekday', () => {
    const arrived = at(minuteAfter, -2 * HOUR);
    const said = clockAsOf(arrived, minuteAfter, TZ);
    expect(said).toBe(`${weekdayIn(minuteBefore, TZ)} 22:01 ${zoneNameIn(arrived, TZ)}`);
    expect(said).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) 22:01 C[DS]T$/);
    expect(said).toBe(appSays(arrived, minuteAfter));
  });

  it('one minute before: the same two hours are still today, and the line has no weekday', () => {
    const arrived = at(minuteBefore, -2 * HOUR);
    const said = clockAsOf(arrived, minuteBefore, TZ);
    expect(said).toMatch(/^21:59 C[DS]T$/);
    expect(said).toBe(appSays(arrived, minuteBefore));
  });

  it('a line drawn between two moments that straddle midnight may say either; otherwise exactly one', () => {
    const arrived = at(minuteAfter, -2 * HOUR);
    const straddling = new RegExp(`^${clockPatternAsOf(arrived, [minuteBefore, minuteAfter], TZ)}$`);
    expect(straddling.test(clockAsOf(arrived, minuteBefore, TZ))).toBe(true);
    expect(straddling.test(clockAsOf(arrived, minuteAfter, TZ))).toBe(true);
    expect(clockAsOf(arrived, minuteBefore, TZ)).not.toBe(clockAsOf(arrived, minuteAfter, TZ));
    expect(clockPatternAsOf(arrived, [minuteAfter, at(minuteAfter, MIN)], TZ)).toBe(
      `(?:${clockAsOf(arrived, minuteAfter, TZ)})`,
    );
  });

  it('ninety minutes before 00:01 is the day before’s cell; ninety before 23:59 is today’s', () => {
    expect(weekdayIndexIn(at(minuteAfter, -90 * MIN), TZ)).toBe((weekdayIndexIn(minuteAfter, TZ) + 6) % 7);
    expect(isoDayIn(at(minuteAfter, -90 * MIN), TZ)).toBe(isoDayIn(minuteBefore, TZ));
    expect(isoDayIn(at(minuteBefore, -90 * MIN), TZ)).toBe(isoDayIn(minuteBefore, TZ));
  });
});

describe('Monday 00:30 in Chicago', () => {
  it('is a Monday, half an hour into it', () => {
    expect(weekdayIn(mondayHalfPast, TZ)).toBe('Mon');
    expect(wall(mondayHalfPast)).toBe('00:30');
  });

  it('ninety minutes before is Sunday, the last column of last week', () => {
    const arrived = at(mondayHalfPast, -90 * MIN);
    expect(weekdayIndexIn(arrived, TZ)).toBe(6);
    expect(isoWeekIn(arrived, TZ)).not.toBe(isoWeekIn(mondayHalfPast, TZ));
    // The week the history page would have to be asked for, by the app's own arithmetic.
    expect(isoWeekIn(arrived, TZ)).toBe(formatIsoWeek(shiftWeek(appWeek(mondayHalfPast), -1)));
    expect(isoWeekIn(arrived, TZ)).toBe(formatIsoWeek(appWeek(arrived)));
    expect(isoWeekIn(mondayHalfPast, TZ)).toBe(formatIsoWeek(appWeek(mondayHalfPast)));
  });

  it('two hours before is Sunday 22:30, and the line says Sun', () => {
    const arrived = at(mondayHalfPast, -2 * HOUR);
    expect(clockAsOf(arrived, mondayHalfPast, TZ)).toBe(`Sun 22:30 ${zoneNameIn(arrived, TZ)}`);
    expect(clockAsOf(arrived, mondayHalfPast, TZ)).toBe(appSays(arrived, mondayHalfPast));
  });
});

describe('the spring-forward, from dst.ts', () => {
  const change = springForward(TZ, YEAR);

  it('is a 23-hour day, and the minutes either side of the jump are the same day in two zones', () => {
    const before = at(change, -MIN);
    const after = at(change, MIN);
    expect(sameDayIn(before, after, TZ)).toBe(true);
    expect([zoneNameIn(before, TZ), zoneNameIn(after, TZ)]).toEqual(['CST', 'CDT']);
    expect(nextMidnightIn(change, TZ).getTime() - startOfDayIn(change, TZ).getTime()).toBe(23 * HOUR);
  });

  it('two hours before 03:01 is 00:01 the same day: no weekday, and the zone it had then', () => {
    const now = at(change, MIN);
    const arrived = at(now, -2 * HOUR);
    expect(clockAsOf(arrived, now, TZ)).toBe('00:01 CST');
    expect(clockAsOf(arrived, now, TZ)).toBe(appSays(arrived, now));
  });

  it('the evening before, 24 hours on is not tomorrow but the day after: the next day is found, not added', () => {
    const saturdayLate = at(startOfDayIn(change, TZ), -30 * MIN);
    const sunday = dayIn(change, TZ);
    expect(dayIn(at(saturdayLate, 24 * HOUR), TZ)).not.toEqual(sunday);
    expect(dayIn(nextMidnightIn(saturdayLate, TZ), TZ)).toEqual(sunday);
    expect(isoWeekIn(saturdayLate, TZ)).toBe(formatIsoWeek(appWeek(saturdayLate)));
  });
});

describe('the fall-back, from dst.ts', () => {
  const change = fallBack(TZ, YEAR);

  it('is a 25-hour day, and the hour that repeats is the same day in two zones', () => {
    const before = at(change, -MIN);
    const after = at(change, MIN);
    expect(sameDayIn(before, after, TZ)).toBe(true);
    expect([zoneNameIn(before, TZ), zoneNameIn(after, TZ)]).toEqual(['CDT', 'CST']);
    expect(wall(before)).toBe('01:59');
    expect(wall(after)).toBe('01:01');
    expect(nextMidnightIn(change, TZ).getTime() - startOfDayIn(change, TZ).getTime()).toBe(25 * HOUR);
  });

  it('two hours before the second 01:01 is 00:01 the same day, in daylight time', () => {
    const now = at(change, MIN);
    const arrived = at(now, -2 * HOUR);
    expect(clockAsOf(arrived, now, TZ)).toBe('00:01 CDT');
    expect(clockAsOf(arrived, now, TZ)).toBe(appSays(arrived, now));
  });

  it('half an hour into it, 24 hours on is still the same day: the next day is found, not added', () => {
    const early = at(startOfDayIn(change, TZ), 30 * MIN);
    expect(dayIn(at(early, 24 * HOUR), TZ)).toEqual(dayIn(early, TZ));
    expect(dayIn(nextMidnightIn(early, TZ), TZ)).not.toEqual(dayIn(early, TZ));
    expect(isoWeekIn(early, TZ)).toBe(formatIsoWeek(appWeek(early)));
  });
});

describe('a zone whose Intl name carries a regular-expression character (phase 3bv)', () => {
  // en-US Intl names Berlin by its offset. The name is derived here and checked, never pasted.
  const ZONE = 'Europe/Berlin';
  const zoneMidnight = startOfDayIn(new Date(), ZONE);

  it('the pattern matches the instant’s own clock line, either side of its midnight', () => {
    const before = at(zoneMidnight, -MIN);
    const after = at(zoneMidnight, MIN);
    const arrived = at(after, -2 * HOUR);
    expect(zoneNameIn(arrived, ZONE)).toContain('+');

    const lines = [clockAsOf(arrived, before, ZONE), clockAsOf(arrived, after, ZONE)];
    expect(lines[0]).not.toBe(lines[1]);
    const pattern = new RegExp(`^${clockPatternAsOf(arrived, [before, after], ZONE)}$`);
    for (const line of lines) {
      expect(line).toContain(zoneNameIn(arrived, ZONE));
      expect(pattern.test(line), line).toBe(true);
    }
  });
});
