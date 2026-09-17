import { describe, expect, it } from 'vitest';
import type { VehicleFeedRow } from '@/samsara/schemas';
import { ACTIVE_WINDOW_MS, flattenFeed, isActiveByRecency, toPending } from './ingest';

const reading = (over: Partial<Record<string, unknown>> = {}) => ({
  time: '2026-09-16T16:53:43.007Z',
  latitude: 41.548277,
  longitude: -87.980377,
  headingDegrees: 0,
  speedMilesPerHour: 0,
  reverseGeo: { formattedLocation: 'Maple Road, New Lenox, IL, 60451' },
  isEcuSpeed: false,
  ...over,
});

describe('toPending', () => {
  it('drops the heading on a stationary vehicle', () => {
    // headingDegrees is 0 when parked. That is "no heading", not "north" —
    // rotating the marker to north would be actively misleading.
    const p = toPending('v1', reading({ speedMilesPerHour: 0, headingDegrees: 0 }));
    expect(p.heading).toBeNull();
    expect(p.speedMph).toBe(0);
  });

  it('drops a NON-zero heading too when speed is 0', () => {
    const p = toPending('v1', reading({ speedMilesPerHour: 0, headingDegrees: 113 }));
    expect(p.heading).toBeNull();
  });

  it('keeps the heading on a moving vehicle', () => {
    const p = toPending(
      'v1',
      reading({ speedMilesPerHour: 69.591, headingDegrees: 113 }),
    );
    expect(p.heading).toBe(113);
  });

  it('treats a missing speed as stationary', () => {
    const r = reading({ headingDegrees: 90 });
    delete (r as Record<string, unknown>).speedMilesPerHour;
    expect(toPending('v1', r as never).heading).toBeNull();
  });

  it('stores formattedLocation whole, never parsed apart', () => {
    expect(toPending('v1', reading()).formattedLocation).toBe(
      'Maple Road, New Lenox, IL, 60451',
    );
  });

  it('keeps millisecond precision from the feed', () => {
    expect(toPending('v1', reading()).recordedAt.toISOString()).toBe(
      '2026-09-16T16:53:43.007Z',
    );
  });

  it('is null-safe when reverseGeo is absent', () => {
    const r = reading();
    delete (r as Record<string, unknown>).reverseGeo;
    expect(toPending('v1', r as never).formattedLocation).toBeNull();
  });
});

describe('flattenFeed', () => {
  it('emits one position per reading, not one per vehicle', () => {
    // gps is an ARRAY on the feed endpoint. A vehicle that moved three times
    // between polls carries three readings; taking [0] would lose two.
    const rows: VehicleFeedRow[] = [
      {
        id: 'v1',
        name: 'Truck #147',
        gps: [
          reading({ time: '2026-09-16T16:53:43.007Z' }),
          reading({ time: '2026-09-16T16:54:13.000Z' }),
          reading({ time: '2026-09-16T16:54:43.000Z' }),
        ],
      },
      { id: 'v2', name: 'Truck #132', gps: [reading()] },
    ];
    const out = flattenFeed(rows);
    expect(out).toHaveLength(4);
    expect(out.filter((p) => p.samsaraVehicleId === 'v1')).toHaveLength(3);
  });

  it('skips a vehicle carrying no readings', () => {
    expect(flattenFeed([{ id: 'v1', name: 'Truck #147', gps: [] }])).toEqual([]);
  });
});

describe('isActiveByRecency', () => {
  // Samsara exposes no active flag and returns every vehicle ever
  // registered — a third of this org's feed has not moved in over a week.
  const now = new Date('2026-09-17T08:00:00Z');

  it('counts a fix inside 24h as active', () => {
    expect(isActiveByRecency(new Date('2026-09-17T07:59:00Z'), now)).toBe(true);
    expect(isActiveByRecency(new Date(now.getTime() - ACTIVE_WINDOW_MS + 1), now)).toBe(
      true,
    );
  });

  it('counts a fix older than 24h as inactive', () => {
    expect(isActiveByRecency(new Date(now.getTime() - ACTIVE_WINDOW_MS - 1), now)).toBe(
      false,
    );
  });

  it('counts the real 226-day-old truck as inactive', () => {
    expect(isActiveByRecency(new Date('2026-02-02T00:00:00Z'), now)).toBe(false);
  });

  it('counts a vehicle with no fix at all as inactive', () => {
    expect(isActiveByRecency(null, now)).toBe(false);
  });
});
