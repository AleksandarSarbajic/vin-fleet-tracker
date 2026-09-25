import { describe, expect, it } from 'vitest';
import { compassPoint, elapsed, mph, timeInZone, zoneAbbreviation } from './format';

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
