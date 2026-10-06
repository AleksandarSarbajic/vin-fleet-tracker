import { describe, expect, it } from 'vitest';
import { AppointmentInput, endsNextDay, fcfsEndDate } from './appointment';

/**
 * §12.114. The pure half of an overnight window: which DAY the latest hour is
 * on. No zone, no instant — the server's tests cover what Postgres makes of
 * it. Every date is derived from today's year, never pasted.
 */

const YEAR = new Date().getUTCFullYear();
const t = (h: number, min = 0) => ({ h, min });

/** The first year from `from` that is (or is not) a leap year, found by asking Date. */
function yearWhere(leap: boolean, from = YEAR): number {
  const isLeap = (y: number) => new Date(Date.UTC(y, 1, 29)).getUTCMonth() === 1;
  let y = from;
  while (isLeap(y) !== leap) y += 1;
  return y;
}

describe('endsNextDay', () => {
  it('is false for a window that closes later the same day', () => {
    expect(endsNextDay(t(7), t(15))).toBe(false);
    expect(endsNextDay(t(0), t(23, 59))).toBe(false);
    expect(endsNextDay(t(14, 29), t(14, 30))).toBe(false);
  });

  it('is true when the latest hour is before the earliest', () => {
    expect(endsNextDay(t(22), t(6))).toBe(true);
    expect(endsNextDay(t(23, 59), t(0))).toBe(true);
    expect(endsNextDay(t(14, 30), t(14, 29))).toBe(true);
  });

  it('reads equal hours as the next day — the schema is what refuses them', () => {
    expect(endsNextDay(t(7), t(7))).toBe(true);
  });
});

describe('fcfsEndDate', () => {
  const date = { y: YEAR, m: 6, d: 12 };

  it('leaves a same-day window on its own date', () => {
    expect(fcfsEndDate(date, t(7), t(15))).toEqual(date);
  });

  it('puts an overnight latest hour on the next calendar day', () => {
    expect(fcfsEndDate(date, t(22), t(6))).toEqual({ y: YEAR, m: 6, d: 13 });
  });

  it('rolls over the month and the year', () => {
    expect(fcfsEndDate({ y: YEAR, m: 9, d: 30 }, t(22), t(6))).toEqual({ y: YEAR, m: 10, d: 1 });
    expect(fcfsEndDate({ y: YEAR, m: 12, d: 31 }, t(22), t(6))).toEqual({
      y: YEAR + 1,
      m: 1,
      d: 1,
    });
  });

  it('knows February, leap year or not', () => {
    const leap = yearWhere(true);
    const common = yearWhere(false);
    expect(fcfsEndDate({ y: leap, m: 2, d: 28 }, t(22), t(6))).toEqual({ y: leap, m: 2, d: 29 });
    expect(fcfsEndDate({ y: common, m: 2, d: 28 }, t(22), t(6))).toEqual({
      y: common,
      m: 3,
      d: 1,
    });
  });
});

describe('the schema, for FCFS hours', () => {
  const fcfs = (time: { h: number; min: number }, endTime: { h: number; min: number }) =>
    AppointmentInput.safeParse({
      type: 'FCFS',
      date: { y: YEAR, m: 6, d: 12 },
      time,
      tz: 'America/Chicago',
      windowMinutes: null,
      endTime,
    });

  it('accepts 22:00–06:00, and the late-evening-to-just-after-midnight case', () => {
    expect(fcfs(t(22), t(6)).success).toBe(true);
    expect(fcfs(t(23, 59), t(0)).success).toBe(true);
  });

  it('still accepts an ordinary day unchanged', () => {
    expect(fcfs(t(7), t(15)).success).toBe(true);
  });

  it('refuses equal hours on the latest-hour field, with the all-day hint', () => {
    const same = fcfs(t(6), t(6));
    expect(same.success).toBe(false);
    expect(same.error?.issues[0]?.path).toEqual(['endTime']);
    expect(same.error?.issues[0]?.message).toContain('00:00 to 23:59');
  });
});
