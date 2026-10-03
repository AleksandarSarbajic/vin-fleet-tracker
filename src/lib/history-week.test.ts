import { describe, expect, it } from 'vitest';
import {
  addDays,
  civilDateIn,
  dayIndexIn,
  formatIsoWeek,
  isoWeekOf,
  mondayOf,
  parseIsoWeek,
  rangeLabel,
  weekBounds,
  weekTag,
  zonedWallToUtc,
  type CivilDate,
} from './history-week';

/**
 * The driver history page's calendar: ISO weeks, Monday 00:00 to Sunday 23:59
 * in America/Chicago (§12.101). Every daylight-saving date here is DERIVED in
 * code, never pasted (CLAUDE.md).
 */

const TZ = 'America/Chicago';
const HOUR = 3_600_000;

/** The n-th Sunday of a month, found by looking — not by remembering. */
function nthSunday(y: number, m: number, n: number): CivilDate {
  let seen = 0;
  for (let d = 1; d <= 31; d += 1) {
    if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0 && (seen += 1) === n) return { y, m, d };
  }
  throw new Error('no such Sunday');
}

describe('ISO weeks', () => {
  it('names the week a date falls in', () => {
    // The design's current week: Fri Oct 2, 2026 is in week 40.
    expect(formatIsoWeek(isoWeekOf({ y: 2026, m: 10, d: 2 }))).toBe('2026-W40');
    // 2026 starts on a Thursday, so it has 53 weeks and Jan 1, 2027 is in its last.
    expect(formatIsoWeek(isoWeekOf({ y: 2027, m: 1, d: 1 }))).toBe('2026-W53');
    expect(formatIsoWeek(isoWeekOf({ y: 2027, m: 1, d: 4 }))).toBe('2027-W01');
  });

  it('starts every week on its Monday', () => {
    expect(mondayOf({ year: 2026, week: 40 })).toEqual({ y: 2026, m: 9, d: 28 });
    expect(mondayOf({ year: 2026, week: 53 })).toEqual({ y: 2026, m: 12, d: 28 });
  });

  it('parses the address form and refuses anything else', () => {
    expect(parseIsoWeek('2026-W40')).toEqual({ year: 2026, week: 40 });
    expect(parseIsoWeek('2026-W53')).toEqual({ year: 2026, week: 53 });
    for (const bad of ['2026-W00', '2025-W53', '2026-W54', '2026W40', '2026-w40', '', 'x']) {
      expect(parseIsoWeek(bad), bad).toBeNull();
    }
  });

  it('labels a week the way the design does', () => {
    expect(rangeLabel({ year: 2026, week: 40 })).toBe('Sep 28 – Oct 4, 2026');
    expect(rangeLabel({ year: 2026, week: 39 })).toBe('Sep 21 – 27, 2026');
    expect(rangeLabel({ year: 2026, week: 53 })).toBe('Dec 28, 2026 – Jan 3, 2027');
  });

  it('tags a week by how far back it is', () => {
    const now = { year: 2026, week: 40 };
    expect(weekTag({ year: 2026, week: 40 }, now)).toBe('Current week');
    expect(weekTag({ year: 2026, week: 39 }, now)).toBe('Last week');
    expect(weekTag({ year: 2026, week: 28 }, now)).toBe('12 weeks ago');
  });
});

describe('a week in America/Chicago', () => {
  it('runs from Monday 00:00 to the next Monday 00:00 at the dispatch office', () => {
    const { start, end } = weekBounds({ year: 2026, week: 40 }, TZ);
    expect(civilDateIn(start, TZ)).toEqual({ y: 2026, m: 9, d: 28 });
    expect(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(start)).toBe('00:00');
    expect(end.getTime() - start.getTime()).toBe(168 * HOUR);
  });

  it('is 169 hours long in the November week the clocks fall back', () => {
    const fallBack = nthSunday(2026, 11, 1);
    const { start, end } = weekBounds(isoWeekOf(fallBack), TZ);
    expect(end.getTime() - start.getTime()).toBe(169 * HOUR);
  });

  it('is 167 hours long in the March week the clocks spring forward', () => {
    const springForward = nthSunday(2027, 3, 2);
    const { start, end } = weekBounds(isoWeekOf(springForward), TZ);
    expect(end.getTime() - start.getTime()).toBe(167 * HOUR);
  });

  it('puts a Sunday 23:30 arrival on Sunday — though it is already Monday in UTC', () => {
    const week = { year: 2026, week: 40 };
    const sunday = addDays(mondayOf(week), 6);
    const arrival = zonedWallToUtc(sunday, 23, 30, TZ);
    expect(civilDateIn(arrival, 'UTC')).toEqual(addDays(sunday, 1));
    expect(dayIndexIn(arrival, week, TZ)).toBe(6);
  });

  it('puts Monday 00:00 on Monday, and the minute before it in the week before', () => {
    const week = { year: 2026, week: 40 };
    const { start } = weekBounds(week, TZ);
    expect(dayIndexIn(start, week, TZ)).toBe(0);
    expect(dayIndexIn(new Date(start.getTime() - 60_000), week, TZ)).toBeNull();
  });

  it('keeps the fall-back Sunday 23:30 on Sunday too', () => {
    const fallBack = nthSunday(2026, 11, 1);
    const week = isoWeekOf(fallBack);
    const arrival = zonedWallToUtc(fallBack, 23, 30, TZ);
    expect(dayIndexIn(arrival, week, TZ)).toBe(6);
  });
});
