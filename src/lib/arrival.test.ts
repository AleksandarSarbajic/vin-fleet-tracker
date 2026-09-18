import { describe, expect, it } from 'vitest';
import { GRAND_FORKS_STOP, TRUCK_143_ARRIVING } from './__fixtures__/truck-143-arrival';
import {
  ARRIVAL_DEFAULTS,
  detectArrival,
  detectDeparture,
  type Fix,
  type StopGeo,
} from './arrival';

/**
 * §12.27. The pure rules, then the same rules run against truck 143's REAL
 * track into Grand Forks — because a radius chosen against fixtures is a
 * radius chosen against my own assumptions.
 */

const STOP = { lat: 47.936987136499, lng: -97.057368543984 };
const T0 = new Date('2026-09-17T20:00:00.000Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000).toISOString();

const stop = (over: Partial<StopGeo> = {}): StopGeo => ({
  ...STOP,
  precision: 'street',
  arrivedAt: null,
  departedAt: null,
  ...over,
});

/** Newest first, as the positions query returns them. */
const parked = (count: number, everySeconds = 6): Fix[] =>
  Array.from({ length: count }, (_, i) => ({
    // ~0.13 mi north — the offset truck 143 actually parked at.
    lat: STOP.lat + 0.0019,
    lng: STOP.lng,
    speedMph: 0,
    recordedAtUtc: at(-i * everySeconds),
  }));

describe('detectArrival', () => {
  it('fires once the truck has been stopped inside the radius long enough', () => {
    expect(detectArrival(stop(), parked(40))).toBe(at(-39 * 6));
  });

  /** The confirmation window is what separates a dock from a red light. */
  it('does not fire on a brief stop, however close', () => {
    // 10 fixes × 6s = 54s of evidence. Under the 120s threshold.
    expect(detectArrival(stop(), parked(10))).toBeNull();
  });

  it('does not fire on a single fix, however long the gap before it', () => {
    const one: Fix[] = [
      { ...STOP, speedMph: 0, recordedAtUtc: at(0) },
    ];
    expect(detectArrival(stop(), one)).toBeNull();
  });

  it('does not fire while the truck is still moving', () => {
    const rolling = parked(40).map((f) => ({ ...f, speedMph: 3 }));
    expect(detectArrival(stop(), rolling)).toBeNull();
  });

  it('does not fire outside the radius', () => {
    const away = parked(40).map((f) => ({ ...f, lat: STOP.lat + 0.02 }));
    expect(detectArrival(stop(), away)).toBeNull();
  });

  /**
   * The instant is when it ARRIVED, not when we noticed — the same anchoring
   * rule the ETA follows. Recording the newest fix would put every arrival
   * two minutes late and make dwell time wrong for everyone downstream.
   */
  it('returns the first fix of the run, not the newest', () => {
    const fixes = parked(40);
    const oldest = fixes[fixes.length - 1]!;
    expect(detectArrival(stop(), fixes)).toBe(oldest.recordedAtUtc);
    expect(detectArrival(stop(), fixes)).not.toBe(fixes[0]!.recordedAtUtc);
  });

  /**
   * CONTRACT CHANGE (§12.41). This used to assert null.
   *
   * A single bad fix mid-dwell cut off everything older, because the run had
   * to start at the newest fix. That is what made an arrival unrecoverable
   * once the truck left: truck 116 parked for 21 minutes during a worker
   * stall, and by the next poll the dwell was two fixes behind the head and
   * could never be found again.
   *
   * The run is now the longest qualifying one anywhere in the window, so a
   * GPS glitch costs the fixes around it rather than the whole arrival.
   */
  it('survives one bad fix in the middle, and reports the dwell around it', () => {
    const fixes = parked(40);
    // A jump 5 miles away, 10 fixes back.
    fixes[10] = { ...fixes[10]!, lat: STOP.lat + 0.08 };
    const found = detectArrival(stop(), fixes);
    expect(found).not.toBeNull();
    // The older, longer run — not the four-fix fragment ahead of the glitch.
    expect(found).toBe(fixes[39]!.recordedAtUtc);
  });

  it('finds a COMPLETED dwell the truck has already left (§12.41)', () => {
    // Exactly truck 116: parked, then gone, and the sweep only looks after.
    const gone: Fix[] = [
      { lat: STOP.lat + 0.2, lng: STOP.lng, speedMph: 55, recordedAtUtc: at(-30) },
      { lat: STOP.lat + 0.1, lng: STOP.lng, speedMph: 48, recordedAtUtc: at(-90) },
    ];
    const parkedBlock: Fix[] = Array.from({ length: 20 }, (_, i) => ({
      lat: STOP.lat,
      lng: STOP.lng,
      speedMph: 0,
      recordedAtUtc: at(-180 - i * 60),
    }));
    const fixes = [...gone, ...parkedBlock];

    const found = detectArrival(stop(), fixes);
    // Under the old rule this was null forever — the head of the list
    // disqualified everything behind it.
    expect(found).toBe(parkedBlock[parkedBlock.length - 1]!.recordedAtUtc);
  });

  it('never re-detects a stop that already arrived', () => {
    expect(detectArrival(stop({ arrivedAt: at(-600) }), parked(40))).toBeNull();
  });

  it('treats an unreported speed as stationary, not as moving', () => {
    const unreported = parked(40).map((f) => ({ ...f, speedMph: null }));
    expect(detectArrival(stop(), unreported)).not.toBeNull();
  });
});

describe('detectDeparture', () => {
  const leaving = (count: number): Fix[] =>
    Array.from({ length: count }, (_, i) => ({
      lat: STOP.lat + 0.05,
      lng: STOP.lng,
      speedMph: 45,
      recordedAtUtc: at(-i * 6),
    }));

  it('fires when an arrived truck is moving well outside the radius', () => {
    const arrived = stop({ arrivedAt: at(-3600) });
    expect(detectDeparture(arrived, leaving(40))).toBe(at(-39 * 6));
  });

  it('never fires for a stop that never arrived', () => {
    expect(detectDeparture(stop(), leaving(40))).toBeNull();
  });

  it('never fires twice', () => {
    const gone = stop({ arrivedAt: at(-3600), departedAt: at(-60) });
    expect(detectDeparture(gone, leaving(40))).toBeNull();
  });

  /** GPS drift on a parked truck is not a departure. */
  it('does not fire when the truck is outside the radius but stationary', () => {
    const drifted = leaving(40).map((f) => ({ ...f, speedMph: 0 }));
    expect(detectDeparture(stop({ arrivedAt: at(-3600) }), drifted)).toBeNull();
  });

  it('never reports leaving before arriving', () => {
    // Arrived AFTER every fix in the run — a re-geocode moved the stop.
    const odd = stop({ arrivedAt: at(0) });
    expect(detectDeparture(odd, leaving(40))).toBeNull();
  });
});

/* -------------------------------------------------------------------------
 * Against the real track
 * ---------------------------------------------------------------------- */

/**
 * Truck 143 arriving at its Grand Forks receiver: 194 positions captured
 * verbatim from the database, not written by hand.
 *
 * This was a live query at first. It passed for about four hours and then
 * failed, because the truck left Grand Forks and the newest 400 positions no
 * longer contained an arrival — the assertion depended on where a lorry
 * happened to be. The track is now a fixture, which keeps the part that
 * mattered (the radius was chosen against reality) and drops the part that
 * made it worthless by the evening.
 */
describe('truck 143 into Grand Forks, from the real track', () => {
  const fixes: Fix[] = [...TRUCK_143_ARRIVING];
  const realStop: StopGeo = {
    ...GRAND_FORKS_STOP,
    precision: 'street',
    arrivedAt: null,
    departedAt: null,
  };

  it('detects the arrival', () => {
    expect(detectArrival(realStop, fixes)).toBe('2026-09-17T20:15:49.033Z');
  });

  /**
   * The reason the radius is 0.25 and not something tighter. This truck
   * parked ~0.13 mi from the geocoded point, because Census returns a street
   * interpolation and trucks park in yards (§12.24, §12.27).
   */
  it('finds nothing at a radius that ignores where trucks actually park', () => {
    expect(detectArrival(realStop, fixes, { ...ARRIVAL_DEFAULTS, radiusMiles: 0.1 })).toBeNull();
  });

  it('places the arrival well before the newest fix', () => {
    const arrivedAt = detectArrival(realStop, fixes)!;
    const newest = new Date(fixes[0]!.recordedAtUtc).getTime();
    // Sixteen minutes of parked truck between arriving and being noticed.
    expect(newest - new Date(arrivedAt).getTime()).toBeGreaterThan(15 * 60_000);
  });

  it('never parked further than the radius allows', () => {
    // Guards the fixture itself: if these numbers ever stop describing an
    // arrival, the tests above are measuring nothing.
    const stopped = fixes.filter((f) => (f.speedMph ?? 0) === 0);
    expect(stopped.length).toBeGreaterThan(20);
  });
});

/* -------------------------------------------------------------------------
 * §12.30 — coarse coordinates cannot be arrived at
 * ---------------------------------------------------------------------- */

/**
 * The sharp edge of the ZIP fallback: a coordinate calibrated for one rule
 * quietly feeding another. The arrival radius is 0.25 mi; a ZIP centroid is a
 * median 2.14 mi from the real address. Left ungated, trucks would be marked
 * ARRIVED four miles from the dock — and §12.27 never unsets `arrived_at`, so
 * nothing would take it back.
 */
describe('arrival refuses anything below street precision (§12.30)', () => {
  /** Parked exactly ON the stop coordinate, stationary for a long time. */
  const parkedOnTop = (count = 60): Fix[] =>
    Array.from({ length: count }, (_, i) => ({
      ...STOP,
      speedMph: 0,
      recordedAtUtc: at(-i * 6),
    }));

  it('fires at street precision, so the test below means something', () => {
    expect(detectArrival(stop({ precision: 'street' }), parkedOnTop())).not.toBeNull();
  });

  it.each(['zip', 'block', null] as const)(
    'never fires at %s precision, however close the truck parks',
    (precision) => {
      expect(detectArrival(stop({ precision }), parkedOnTop())).toBeNull();
    },
  );

  it('never fires at zip precision even parked there for a whole day', () => {
    const allDay = Array.from({ length: 2000 }, (_, i) => ({
      ...STOP,
      speedMph: 0,
      recordedAtUtc: at(-i * 30),
    }));
    expect(detectArrival(stop({ precision: 'zip' }), allDay)).toBeNull();
  });

  it('will not record a departure from a coarse stop either', () => {
    const leaving: Fix[] = Array.from({ length: 40 }, (_, i) => ({
      lat: STOP.lat + 0.05,
      lng: STOP.lng,
      speedMph: 45,
      recordedAtUtc: at(-i * 6),
    }));
    const arrived = stop({ precision: 'zip', arrivedAt: at(-3600) });
    expect(detectDeparture(arrived, leaving)).toBeNull();
  });
});
