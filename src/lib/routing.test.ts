import { describe, expect, it } from 'vitest';
import { haversineMiles } from './status';
import {
  ROUTE_PROVIDER,
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
  provider: ROUTE_PROVIDER,
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

const here = (from: { lat: number; lng: number }, provider = ROUTE_PROVIDER) => ({
  truckLat: from.lat,
  truckLng: from.lng,
  stopLat: STOP.lat,
  stopLng: STOP.lng,
  provider,
});

describe('needsRecompute', () => {
  it('routes a lane that has never been routed', () => {
    expect(needsRecompute(null, here(FAR), AT)).toBe('no-route');
  });

  /**
   * §12.59. A car route and a truck route are different numbers for the same
   * lane — measured at +44 mi on truck 135's Chicago->Phoenix — so a
   * `lane_ratio` from one is not a road factor for the other.
   */
  it('routes again when the cached row came from another provider', () => {
    const fromMapbox = cached({ provider: 'mapbox-directions-driving' });
    expect(needsRecompute(fromMapbox, here(FAR), AT)).toBe('provider-changed');
  });

  it('routes again when only the PROFILE changed', () => {
    // The name carries the profile for exactly this case: a car measurement
    // from the same vendor is still the wrong number.
    const carFromHere = cached({ provider: 'here-routing-v8-car' });
    expect(needsRecompute(carFromHere, here(FAR), AT)).toBe('provider-changed');
  });

  it('says provider-changed even when the row is otherwise perfect', () => {
    /**
     * Checked BEFORE the geometry, deliberately. This row is current by every
     * other measure — same stop, fresh, truck has not moved — so if the
     * provider check came later this would return null and a car ratio would
     * survive the swap untouched for up to `maxAgeHours`.
     */
    const stale = cached({ provider: 'mapbox-directions-driving' });
    expect(needsRecompute(cached(), here(FAR), AT)).toBeNull();
    expect(needsRecompute(stale, here(FAR), AT)).toBe('provider-changed');
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

describe('a fresh route advances with the truck (§12.40)', () => {
  /**
   * The bug that made every ETA drift with the wall clock.
   *
   * `project()` anchors the ETA to `position.recorded_at` — correctly, and
   * §12.24 is about that. But `projectDistance` returned the cached route's
   * total unchanged, so the anchor moved with every fix and the distance did
   * not. ETA = moving anchor + frozen distance = 1:1 drift.
   *
   * Measured on truck 116: 5.6 minutes of clock, 5.6 minutes of ETA, while
   * the truck covered 6.5 miles.
   */
  const lane: CachedRoute = {
    provider: ROUTE_PROVIDER,
    routedMiles: 71.84,
    routedDurationS: 4015,
    fromLat: 46.877939,
    fromLng: -99.367585,
    straightAtRouteMiles: 65.9,
    laneRatio: 1.0897,
    stopLat: 46.794794,
    stopLng: -100.757128,
    snapFromM: 4,
    snapToM: 7,
    computedAtUtc: '2026-09-18T17:41:00.173Z',
  };

  it('shrinks the projected distance as the straight line shrinks', () => {
    const atRoute = projectDistance(65.9, lane, 1.25, 52, true);
    const tenCloser = projectDistance(55.9, lane, 1.25, 52, true);

    expect(atRoute.miles).toBeCloseTo(71.84, 2);
    // Ten straight-line miles closed is ~10.9 road miles on this lane.
    expect(tenCloser.miles).toBeCloseTo(71.84 - 10 * 1.0897, 2);
    expect(tenCloser.miles).toBeLessThan(atRoute.miles);
  });

  it('keeps the ETA still while the clock moves, which is the whole point', () => {
    const speed = Math.min(71.84 / (4015 / 3600), 52);
    // Two fixes 6 minutes apart, the truck covering 6 straight-line miles.
    const first = projectDistance(65.9, lane, 1.25, 52, true);
    const later = projectDistance(59.9, lane, 1.25, 52, true);

    const etaFirst = Date.parse('2026-09-18T17:41:00Z') + (first.miles / speed) * 3_600_000;
    const etaLater =
      Date.parse('2026-09-18T17:47:00Z') + (later.miles / speed) * 3_600_000;

    // The truck covered 6.0 straight-line miles in 6 minutes — 65.4 mph, above
    // the 52 mph the projection assumes, so the ETA comes IN slightly. What it
    // must not do is slide 6 minutes later, which is what it used to do.
    const driftMinutes = (etaLater - etaFirst) / 60_000;
    expect(Math.abs(driftMinutes)).toBeLessThan(2);
  });

  it('never goes negative when the truck moves away from the stop', () => {
    // 116's demo stop was behind it; the straight line GREW.
    const away = projectDistance(80, lane, 1.25, 52, true);
    expect(away.miles).toBe(71.84);
    expect(away.miles).toBeGreaterThan(0);
  });

  it('cannot project past the destination', () => {
    const arrived = projectDistance(0, lane, 1.25, 52, true);
    expect(arrived.miles).toBeGreaterThanOrEqual(0);
  });

  it('leaves the lane-estimate and straight-line paths alone', () => {
    // Those already scale with the CURRENT straight line, so they never drifted.
    expect(projectDistance(50, lane, 1.25, 52, false).miles).toBeCloseTo(50 * 1.0897, 3);
    expect(projectDistance(50, null, 1.25, 52, false).miles).toBeCloseTo(62.5, 3);
  });
});
