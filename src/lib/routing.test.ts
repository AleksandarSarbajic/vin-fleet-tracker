import { describe, expect, it } from 'vitest';
import { haversineMiles } from './status';
import {
  ROUTING_DEFAULTS,
  budgetMonth,
  needsRecompute,
  projectDistance,
  type CachedRoute,
} from './routing';

/**
 * §12.31. The rules that decide whether to spend money and what to believe
 * about the answer. Pure, so they can be argued with without a network.
 */

const STOP = { lat: 41.4142, lng: -88.0835 };
const AT = new Date('2026-09-18T12:00:00.000Z');

/** Fargo-ish, north-west of the stop. DERIVED, never pasted: a hand-written
 *  straight-line figure that disagrees with the coordinates makes every
 *  threshold assertion below meaningless. */
const FAR = { lat: 46.8672, lng: -96.9422 };
const FAR_STRAIGHT = haversineMiles(FAR, STOP);

const cached = (over: Partial<CachedRoute> = {}): CachedRoute => ({
  routedMiles: 481.3,
  routedDurationS: 7.35 * 3600,
  fromLat: FAR.lat,
  fromLng: FAR.lng,
  straightAtRouteMiles: FAR_STRAIGHT,
  laneRatio: 481.3 / FAR_STRAIGHT,
  stopLat: STOP.lat,
  stopLng: STOP.lng,
  snapFromM: 4,
  snapToM: 379,
  computedAtUtc: AT.toISOString(),
  ...over,
});

const here = (from: { lat: number; lng: number }) => ({
  truckLat: from.lat,
  truckLng: from.lng,
  stopLat: STOP.lat,
  stopLng: STOP.lng,
});

describe('needsRecompute', () => {
  it('routes a lane that has never been routed', () => {
    expect(needsRecompute(null, here(FAR), AT)).toBe('no-route');
  });

  it('leaves a fresh route alone', () => {
    expect(needsRecompute(cached(), here(FAR), AT)).toBeNull();
  });

  /** The whole point: not per poll. */
  it('does not recompute for a truck that has barely moved', () => {
    // A nudge. The threshold on this lane is 15% of it, about 74 miles.
    const nudged = { lat: FAR.lat - 0.04, lng: FAR.lng + 0.04 };
    expect(needsRecompute(cached(), here(nudged), AT)).toBeNull();
  });

  it('recomputes once the truck has covered 15% of the lane', () => {
    // Well past 15% of the lane, in a straight line toward the stop.
    const moved = { lat: 43.6, lng: -91.5 };
    expect(
      Math.abs(haversineMiles(moved, STOP) - FAR_STRAIGHT),
    ).toBeGreaterThan(0.15 * FAR_STRAIGHT);
    expect(needsRecompute(cached(), here(moved), AT)).toBe('truck-moved');
  });

  /** A short lane is governed by the 10-mile floor, not the percentage. */
  it('uses the floor on a short lane, where 15% would be yards', () => {
    // 15% of 20 miles is 3, so the 10-mile floor governs instead.
    const short = cached({ straightAtRouteMiles: 20, routedMiles: 24, laneRatio: 1.2 });

    const nearby = { lat: STOP.lat + 0.2, lng: STOP.lng };
    expect(Math.abs(haversineMiles(nearby, STOP) - 20)).toBeLessThan(
      ROUTING_DEFAULTS.floorMiles,
    );
    expect(needsRecompute(short, here(nearby), AT)).toBeNull();

    const further = { lat: STOP.lat + 0.6, lng: STOP.lng };
    expect(Math.abs(haversineMiles(further, STOP) - 20)).toBeGreaterThan(
      ROUTING_DEFAULTS.floorMiles,
    );
    expect(needsRecompute(short, here(further), AT)).toBe('truck-moved');
  });

  it('recomputes when the stop itself was re-geocoded', () => {
    const moved = cached({ stopLat: STOP.lat + 0.5 });
    expect(needsRecompute(moved, here(FAR), AT)).toBe('stop-moved');
  });

  it('recomputes a route older than the max age', () => {
    const old = cached({
      computedAtUtc: new Date(AT.getTime() - 13 * 3_600_000).toISOString(),
    });
    expect(needsRecompute(old, here(FAR), AT)).toBe('route-stale');
  });

  it('holds a route that is merely old-ish', () => {
    const elevenHours = cached({
      computedAtUtc: new Date(AT.getTime() - 11 * 3_600_000).toISOString(),
    });
    expect(needsRecompute(elevenHours, here(FAR), AT)).toBeNull();
  });
});

describe('projectDistance', () => {
  const AVG = 52;

  it('uses the routed miles when the route is fresh', () => {
    const p = projectDistance(FAR_STRAIGHT, cached(), 1.25, AVG, true);
    expect(p.basis).toBe('routed');
    expect(p.miles).toBeCloseTo(481.3, 3);
  });

  /**
   * The measured road factor for THIS lane, which is the improvement over a
   * global constant: our own lanes ranged 1.070 to 1.460.
   */
  it('estimates from the lane ratio when the route has gone stale', () => {
    const p = projectDistance(200, cached(), 1.25, AVG, false);
    expect(p.basis).toBe('lane-estimate');
    expect(p.miles).toBeCloseTo(200 * (481.3 / FAR_STRAIGHT), 6);
    // Emphatically not the brief's constant.
    expect(p.miles).not.toBeCloseTo(200 * 1.25, 1);
  });

  it('falls back to the brief’s constant only when nothing was ever routed', () => {
    const p = projectDistance(200, null, 1.25, AVG, false);
    expect(p.basis).toBe('straight-line');
    expect(p.miles).toBeCloseTo(250, 6);
    expect(p.laneRatio).toBeNull();
  });

  /**
   * The provider's duration is a CAR duration. The first live call implied
   * 65.5 mph, which no loaded truck sustains.
   */
  it('never travels faster than the configured average', () => {
    // 481.3 mi in 7.35 h is 65.5 mph.
    const p = projectDistance(FAR_STRAIGHT, cached(), 1.25, AVG, true);
    expect(p.speedMph).toBe(AVG);
  });

  it('DOES take the route’s speed when the route is slower than the average', () => {
    // A lane of county roads: 60 miles in 3 hours is 20 mph.
    const slow = cached({ routedMiles: 60, routedDurationS: 3 * 3600, laneRatio: 1.4 });
    const p = projectDistance(43, slow, 1.25, AVG, true);
    expect(p.speedMph).toBeCloseTo(20, 6);
  });

  it('does not divide by a zero duration', () => {
    const broken = cached({ routedDurationS: 0 });
    expect(projectDistance(FAR_STRAIGHT, broken, 1.25, AVG, true).speedMph).toBe(AVG);
  });
});

describe('budgetMonth', () => {
  it('is the UTC month, because that is what a provider bills', () => {
    expect(budgetMonth(new Date('2026-09-18T12:00:00Z'))).toBe('2026-09');
    // 31 Dec 23:00 in Chicago is already January in UTC.
    expect(budgetMonth(new Date('2027-01-01T04:00:00Z'))).toBe('2027-01');
  });
});

describe('the thresholds are the measured ones', () => {
  it('keeps the snap thresholds either side of the observed clusters', () => {
    // street stops snapped 1-8 m; ZIP centroids snapped 379-402 m.
    expect(ROUTING_DEFAULTS.snapNoteMeters).toBeGreaterThan(8);
    expect(ROUTING_DEFAULTS.snapNoteMeters).toBeLessThan(379);
    // `block` precision is measured up to 0.78 mi = 1255 m.
    expect(ROUTING_DEFAULTS.snapRefuseMeters).toBeGreaterThan(1255);
  });
});
