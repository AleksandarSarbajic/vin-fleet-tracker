import { describe, expect, it } from 'vitest';
import {
  GpsReading,
  VehicleFeedRow,
  VehicleStatsRow,
  cityState,
  envelope,
  parseTruckNumber,
} from './schemas';

/**
 * Every literal below was taken from a real response from org 45975 on
 * 2026-09-17. See docs/samsara.md.
 */

describe('parseTruckNumber', () => {
  it('parses the real name format', () => {
    expect(parseTruckNumber('Truck #147')).toBe(147);
    expect(parseTruckNumber('Truck #132')).toBe(132);
  });

  it('returns null for the vehicle literally named "Truck"', () => {
    // Observed in this org — one vehicle carries no number at all.
    expect(parseTruckNumber('Truck')).toBeNull();
  });
});

describe('cityState', () => {
  // The four real shapes. The zip is optional — 105 of 301 readings had none.
  it.each([
    ['Maple Road, New Lenox, IL, 60451', 'New Lenox, IL'],
    ['3181 Evergreen Lane Southwest, Alexandria, MN, 56308', 'Alexandria, MN'],
    ['1250 171st Street, East Hazel Crest, IL, 60429', 'East Hazel Crest, IL'],
    ['Hodgkins, IL, 60480', 'Hodgkins, IL'],
    ['I 94, Lynden Township, MN, 55320', 'Lynden Township, MN'],
    ['I 694, Fridley, MN, 55421', 'Fridley, MN'],
  ])('with a zip: %s', (input, expected) => {
    expect(cityState(input)).toBe(expected);
  });

  it.each([
    ['I-94 W, Douglas County, MN', 'Douglas County, MN'],
    ['I 39;I 90, Town of Pleasant Springs, WI', 'Town of Pleasant Springs, WI'],
  ])('without a zip: %s', (input, expected) => {
    // A fixed offset from the right would render the STREET as the city here.
    expect(cityState(input)).toBe(expected);
  });

  it('handles a zip+4', () => {
    expect(cityState('Maple Road, New Lenox, IL, 60451-1234')).toBe('New Lenox, IL');
  });

  it('returns the whole string rather than guessing a wrong place', () => {
    expect(cityState('Somewhere')).toBe('Somewhere');
    expect(cityState(null)).toBeNull();
  });
});

describe('the two gps shapes', () => {
  const reading = {
    time: '2026-09-16T16:53:43.007Z',
    latitude: 41.548277,
    longitude: -87.980377,
    headingDegrees: 0,
    speedMilesPerHour: 0,
    reverseGeo: { formattedLocation: 'Maple Road, New Lenox, IL, 60451' },
    isEcuSpeed: false,
  };

  it('/stats returns gps as an OBJECT', () => {
    const parsed = VehicleStatsRow.safeParse({
      id: '212014918912099',
      name: 'Truck #147',
      gps: reading,
    });
    expect(parsed.success).toBe(true);
  });

  it('/stats/feed returns gps as an ARRAY', () => {
    const parsed = VehicleFeedRow.safeParse({
      id: '212014918912099',
      name: 'Truck #147',
      gps: [reading],
    });
    expect(parsed.success && parsed.data.gps).toHaveLength(1);
  });

  it('refuses a feed row carrying the /stats object shape', () => {
    // This is the trap: code written against /stats reads row.gps.latitude
    // and gets undefined from the feed. Zod stops it at the boundary.
    expect(
      VehicleFeedRow.safeParse({ id: '1', name: 'Truck #1', gps: reading }).success,
    ).toBe(false);
  });

  it('rejects out-of-range coordinates', () => {
    expect(GpsReading.safeParse({ ...reading, latitude: 91 }).success).toBe(false);
  });
});

describe('envelope', () => {
  it('coerces data:null to an empty array', () => {
    // /fleet/driver-vehicle-assignments returns data:null, not []. Anything
    // calling .map() on it throws.
    const parsed = envelope(VehicleRowLike).safeParse({
      data: null,
      pagination: { endCursor: '', hasNextPage: false },
    });
    expect(parsed.success && parsed.data.data).toEqual([]);
  });

  it('defaults pagination when it is absent', () => {
    const parsed = envelope(VehicleRowLike).safeParse({ data: [] });
    expect(parsed.success && parsed.data.pagination.hasNextPage).toBe(false);
  });
});

const VehicleRowLike = VehicleFeedRow;
