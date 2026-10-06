import { describe, expect, it } from 'vitest';
import { eveningBefore, fallBack, springForward, YEAR } from '@/test/dst';
import { nextCalendarDay } from './calendar';
import {
  compassPoint,
  elapsed,
  mph,
  timeInZone,
  wallTimeInstant,
  windowEnd,
  windowLength,
  zoneAbbreviation,
} from './format';

describe('compassPoint', () => {
  it.each([
    [0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'],
    [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW'],
  ])('%i degrees is %s', (deg, expected) => {
    expect(compassPoint(deg)).toBe(expected);
  });

  it('wraps at 360', () => expect(compassPoint(360)).toBe('N'));
  it('rounds to the nearest point', () => expect(compassPoint(342)).toBe('N'));

  it('is null for a stationary truck', () => {
    // The worker stores NULL when speed is 0, because 0 degrees there means
    // "no heading", not "north".
    expect(compassPoint(null)).toBeNull();
  });
});

describe('elapsed', () => {
  const now = new Date('2026-09-17T12:00:00Z');
  it.each([
    ['2026-09-17T11:59:48Z', '12s'],
    ['2026-09-17T11:51:00Z', '9m'],
    ['2026-09-17T09:20:00Z', '2h 40m'],
    ['2026-09-17T10:00:00Z', '2h'],
    ['2026-02-02T12:00:00Z', '227d'],
  ])('%s -> %s', (iso, expected) => {
    expect(elapsed(iso, now)).toBe(expected);
  });

  it('never goes negative on a clock skew', () => {
    expect(elapsed('2026-09-17T12:00:30Z', now)).toBe('0s');
  });

  it('is null for a truck that has never reported', () => {
    expect(elapsed(null, now)).toBeNull();
  });
});

describe('timeInZone', () => {
  // Every abbreviation is derived at render from the instant plus the zone.
  // None of these dates is a DST boundary pasted from anywhere — they are
  // ordinary days chosen either side of one.
  const september = new Date('2026-09-17T09:30:00Z');
  const january = new Date('2026-01-17T09:30:00Z');

  it('drops the abbreviation only when asked, and keeps the zone-correct time', () => {
    expect(timeInZone(september, 'America/Chicago', { zone: false })).toBe('04:30');
    expect(timeInZone(september, 'America/Chicago')).toBe('04:30 CDT');
  });

  it('prints CDT in September and CST in January for the dispatch zone', () => {
    expect(timeInZone(september, 'America/Chicago')).toContain('CDT');
    expect(timeInZone(january, 'America/Chicago')).toContain('CST');
  });

  it('prints CEST then CET for Belgrade across the same two dates', () => {
    expect(timeInZone(september, 'Europe/Belgrade')).toContain('CEST');
    expect(timeInZone(january, 'Europe/Belgrade')).toContain('CET');
  });

  it('prints MST for Phoenix in both, because Arizona has no DST', () => {
    expect(timeInZone(september, 'America/Phoenix')).toContain('MST');
    expect(timeInZone(january, 'America/Phoenix')).toContain('MST');
  });

  it('can carry a weekday', () => {
    expect(timeInZone(september, 'America/Chicago', { weekday: true })).toMatch(/^\w{3}/);
  });

  it('gives BOTH clocks a real abbreviation, not an offset', () => {
    // timeZoneName:'short' is locale-dependent: en-GB renders Chicago as
    // "GMT-5" and en-US renders Belgrade as "GMT+2". The console shows both
    // clocks side by side, so a single locale would print an offset in one.
    expect(zoneAbbreviation(september, 'America/Chicago')).toBe('CDT');
    expect(zoneAbbreviation(september, 'Europe/Belgrade')).toBe('CEST');
    expect(zoneAbbreviation(january, 'America/Chicago')).toBe('CST');
    expect(zoneAbbreviation(january, 'Europe/Belgrade')).toBe('CET');
  });

  it('derives the dispatch-to-Belgrade gap rather than assuming 7h', () => {
    // Both zones on DST, or both off it, is +7. Derived here, never pasted.
    const gap = (at: Date) => {
      const chi = new Date(at.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
      const bel = new Date(at.toLocaleString('en-US', { timeZone: 'Europe/Belgrade' }));
      return Math.round((bel.getTime() - chi.getTime()) / 3600000);
    };
    expect(gap(september)).toBe(7);
    expect(gap(january)).toBe(7);
  });
});

describe('mph', () => {
  it('rounds — a decimal is noise on a truck', () => {
    expect(mph(69.591)).toBe('70 mph');
    expect(mph(0)).toBe('0 mph');
  });
  it('is null when unknown', () => expect(mph(null)).toBeNull());
});

/* ------------------------- §12.114 overnight windows --------------------- */

const CHICAGO = 'America/Chicago';
const next = (date: { y: number; m: number; d: number }) => {
  const [y, m, d] = nextCalendarDay(
    `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`,
  ).split('-').map(Number) as [number, number, number];
  return { y, m, d };
};
const span = (
  date: { y: number; m: number; d: number },
  from: number,
  to: number,
  tz: string,
  endDate = to <= from ? next(date) : date,
) => ({
  start: wallTimeInstant(date, { h: from, min: 0 }, tz).toISOString(),
  end: wallTimeInstant(endDate, { h: to, min: 0 }, tz).toISOString(),
});

describe('wallTimeInstant (display only)', () => {
  const clock = (at: Date, tz: string) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
    }).format(at);

  it('names the instant a wall time happens at the stop', () => {
    const at = wallTimeInstant({ y: YEAR, m: 6, d: 12 }, { h: 14, min: 30 }, CHICAGO);
    expect(clock(at, CHICAGO)).toBe('14:30');
  });

  it('is right on the fall-back morning, where one correction pass was an hour out', () => {
    // The guess is five or six hours from the target, and on this morning it
    // sits on daylight time while 06:00 is on standard: the old one-pass
    // version returned 05:00 CST.
    const morning = next(eveningBefore(CHICAGO, fallBack(CHICAGO, YEAR)));
    const at = wallTimeInstant(morning, { h: 6, min: 0 }, CHICAGO);
    expect(clock(at, CHICAGO)).toBe('06:00');
    expect(zoneAbbreviation(at, CHICAGO)).toBe('CST');
  });

  it('is right on the spring-forward morning', () => {
    const morning = next(eveningBefore(CHICAGO, springForward(CHICAGO, YEAR)));
    const at = wallTimeInstant(morning, { h: 6, min: 0 }, CHICAGO);
    expect(clock(at, CHICAGO)).toBe('06:00');
    expect(zoneAbbreviation(at, CHICAGO)).toBe('CDT');
  });
});

describe('windowLength', () => {
  it.each([
    [480, '8 h'], [420, '7 h'], [540, '9 h'], [450, '7 h 30 min'], [45, '45 min'],
  ])('%i minutes reads %s', (minutes, text) => {
    expect(windowLength(minutes)).toBe(text);
  });
});

describe('windowEnd', () => {
  const ordinary = { y: YEAR, m: 6, d: 12 };

  it('is the plain end time for a window that closes the same day', () => {
    const w = span(ordinary, 7, 15, CHICAGO);
    expect(windowEnd(w.start, w.end, CHICAGO)).toBe(timeInZone(new Date(w.end), CHICAGO));
    expect(windowEnd(w.start, w.end, CHICAGO)).toBe('15:00 CDT');
  });

  it('adds +1 when the window closes on the next day', () => {
    const w = span(ordinary, 22, 6, CHICAGO);
    expect(windowEnd(w.start, w.end, CHICAGO)).toBe('06:00 CDT +1');
  });

  it('names the END’s abbreviation on the fall-back night', () => {
    const w = span(eveningBefore(CHICAGO, fallBack(CHICAGO, YEAR)), 22, 6, CHICAGO);
    expect(timeInZone(new Date(w.start), CHICAGO)).toBe('22:00 CDT');
    expect(windowEnd(w.start, w.end, CHICAGO)).toBe('06:00 CST +1');
  });

  it('counts the day at the STOP, not in the dispatch zone', () => {
    // 22:00–06:00 in Los Angeles is 00:00–08:00 in Chicago: one day there,
    // two days at the receiver. The receiver's night is what +1 describes.
    const la = 'America/Los_Angeles';
    const w = span(ordinary, 22, 6, la);
    expect(windowEnd(w.start, w.end, la)).toBe('06:00 PDT +1');
    // And a same-day LA window that crosses midnight in CHICAGO gets no +1.
    const evening = span(ordinary, 21, 23, la);
    expect(windowEnd(evening.start, evening.end, la)).toBe('23:00 PDT');
  });

  it('applies to an APPT window that runs past midnight', () => {
    const start = wallTimeInstant(ordinary, { h: 23, min: 30 }, CHICAGO);
    const end = new Date(start.getTime() + 60 * 60_000);
    expect(windowEnd(start.toISOString(), end.toISOString(), CHICAGO)).toBe('00:30 CDT +1');
  });
});
