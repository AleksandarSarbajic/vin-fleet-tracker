import { describe, expect, it } from 'vitest';
import { haversineMiles } from './status';
import {
  ROUTE_PROVIDER,
  ROUTING_DEFAULTS,
  budgetMonth,
  budgetStatus,
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
  /** The engine's two speeds, written out: the tests below are about these numbers. */
  const SPEEDS = { avgSpeedMph: 52, routeSpeedCeilingMph: 75 };

  it('uses the routed miles when the route is fresh', () => {
    const p = projectDistance(FAR_STRAIGHT, cached(), 1.25, SPEEDS, true);
    expect(p.basis).toBe('routed');
    expect(p.miles).toBeCloseTo(481.3, 3);
  });

  /**
   * The measured road factor for THIS lane, which is the improvement over a
   * global constant: our own lanes ranged 1.070 to 1.460.
   */
  it('estimates from the lane ratio when the route has gone stale', () => {
    const p = projectDistance(200, cached(), 1.25, SPEEDS, false);
    expect(p.basis).toBe('lane-estimate');
    expect(p.miles).toBeCloseTo(200 * (481.3 / FAR_STRAIGHT), 6);
    // Emphatically not the brief's constant.
    expect(p.miles).not.toBeCloseTo(200 * 1.25, 1);
  });

  it('falls back to the brief’s constant only when nothing was ever routed', () => {
    const p = projectDistance(200, null, 1.25, SPEEDS, false);
    expect(p.basis).toBe('straight-line');
    expect(p.miles).toBeCloseTo(250, 6);
    expect(p.laneRatio).toBeNull();
  });

  /**
   * §12.150. Until phase 3bh a routed ETA never travelled faster than 52 mph,
   * and this test said so. Trucks drive a median 68 between stops, so the cap
   * put the ETA 27 minutes per 100 road miles after them.
   */
  it('travels a 300 mile route in 4.5 hours at 66.7 mph, not at 52', () => {
    const route = cached({ routedMiles: 300, routedDurationS: 16_200 });
    const p = projectDistance(FAR_STRAIGHT, route, 1.25, SPEEDS, true);
    expect(p.miles).toBe(300);
    expect(p.speedMph).toBeCloseTo(66.667, 3);
    // 270 minutes. At 52 mph it was 346.
    expect((p.miles / p.speedMph) * 60).toBeCloseTo(270, 6);
  });

  it('takes the first live route at its own 65.5 mph', () => {
    // 481.3 mi in 7.35 h.
    const p = projectDistance(FAR_STRAIGHT, cached(), 1.25, SPEEDS, true);
    expect(p.speedMph).toBeCloseTo(65.483, 3);
  });

  it('clamps a route that implies 90 mph to the 75 mph ceiling', () => {
    // 300 mi in 3 h 20 min. No truck does that; the duration is wrong.
    const tooFast = cached({ routedMiles: 300, routedDurationS: 12_000 });
    const p = projectDistance(FAR_STRAIGHT, tooFast, 1.25, SPEEDS, true);
    expect(p.speedMph).toBe(75);
    expect((p.miles / p.speedMph) * 60).toBe(240);
  });

  it('leaves a route at exactly 75 mph alone', () => {
    const atCeiling = cached({ routedMiles: 300, routedDurationS: 14_400 });
    expect(projectDistance(FAR_STRAIGHT, atCeiling, 1.25, SPEEDS, true).speedMph).toBe(75);
  });

  it('still drives a straight-line estimate at 52 mph', () => {
    // 208 straight miles x 1.25 = 260 road miles: 5 hours.
    const p = projectDistance(208, null, 1.25, SPEEDS, false);
    expect(p.basis).toBe('straight-line');
    expect(p.speedMph).toBe(52);
    expect(p.miles / p.speedMph).toBe(5);
  });

  it('drives a lane-estimate at its route’s own speed', () => {
    // The lane was last measured at 300 mi in 4.5 h, 1.2 road miles a straight one.
    const lane = cached({ routedMiles: 300, routedDurationS: 16_200, laneRatio: 1.2 });
    const p = projectDistance(100, lane, 1.25, SPEEDS, false);
    expect(p.basis).toBe('lane-estimate');
    expect(p.miles).toBe(120);
    expect(p.speedMph).toBeCloseTo(66.667, 3);
    // 108 minutes. At 52 mph it was 138.
    expect((p.miles / p.speedMph) * 60).toBeCloseTo(108, 6);
  });

  it('DOES take the route’s speed when the route is slower than the average', () => {
    // A lane of county roads: 60 miles in 3 hours is 20 mph.
    const slow = cached({ routedMiles: 60, routedDurationS: 3 * 3600, laneRatio: 1.4 });
    const p = projectDistance(43, slow, 1.25, SPEEDS, true);
    expect(p.speedMph).toBeCloseTo(20, 6);
  });

  it('does not divide by a zero duration: such a route has no speed, so 52', () => {
    const broken = cached({ routedDurationS: 0 });
    expect(projectDistance(FAR_STRAIGHT, broken, 1.25, SPEEDS, true).speedMph).toBe(52);
    expect(projectDistance(200, broken, 1.25, SPEEDS, false).speedMph).toBe(52);
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

  const SPEEDS = { avgSpeedMph: 52, routeSpeedCeilingMph: 75 };

  it('shrinks the projected distance as the straight line shrinks', () => {
    const atRoute = projectDistance(65.9, lane, 1.25, SPEEDS, true);
    const tenCloser = projectDistance(55.9, lane, 1.25, SPEEDS, true);

    expect(atRoute.miles).toBeCloseTo(71.84, 2);
    // Ten straight-line miles closed is ~10.9 road miles on this lane.
    expect(tenCloser.miles).toBeCloseTo(71.84 - 10 * 1.0897, 2);
    expect(tenCloser.miles).toBeLessThan(atRoute.miles);
  });

  it('keeps the ETA still while the clock moves, which is the whole point', () => {
    // Two fixes 6 minutes apart, the truck covering 6 straight-line miles.
    const first = projectDistance(65.9, lane, 1.25, SPEEDS, true);
    const later = projectDistance(59.9, lane, 1.25, SPEEDS, true);
    // The route's own speed since §12.150: 71.84 mi in 4015 s. It was 52.
    expect(first.speedMph).toBeCloseTo(64.414, 3);
    expect(later.speedMph).toBe(first.speedMph);

    const etaFirst =
      Date.parse('2026-09-18T17:41:00Z') + (first.miles / first.speedMph) * 3_600_000;
    const etaLater =
      Date.parse('2026-09-18T17:47:00Z') + (later.miles / later.speedMph) * 3_600_000;

    // The truck covered 6.0 straight-line miles in 6 minutes: 6.54 road miles,
    // 65.4 mph, a shade above the route's 64.4, so the ETA comes IN by five
    // seconds. (At the old 52 it came in by a minute and a half.) What it must
    // not do is slide 6 minutes later, which is what it used to do.
    const driftMinutes = (etaLater - etaFirst) / 60_000;
    expect(driftMinutes).toBeCloseTo(-0.09, 2);
  });

  it('never goes negative when the truck moves away from the stop', () => {
    // 116's demo stop was behind it; the straight line GREW.
    const away = projectDistance(80, lane, 1.25, SPEEDS, true);
    expect(away.miles).toBe(71.84);
    expect(away.miles).toBeGreaterThan(0);
  });

  it('cannot project past the destination', () => {
    const arrived = projectDistance(0, lane, 1.25, SPEEDS, true);
    expect(arrived.miles).toBeGreaterThanOrEqual(0);
  });

  it('leaves the lane-estimate and straight-line paths alone', () => {
    // Those already scale with the CURRENT straight line, so they never drifted.
    expect(projectDistance(50, lane, 1.25, SPEEDS, false).miles).toBeCloseTo(50 * 1.0897, 3);
    expect(projectDistance(50, null, 1.25, SPEEDS, false).miles).toBeCloseTo(62.5, 3);
  });
});

/* -------------------------------------------------------------------------
 * §12.60 — the budget says where the month is going, before it gets there
 * ---------------------------------------------------------------------- */

describe('budgetStatus', () => {
  /** Noon on the Nth of a 30-day month (September), UTC. */
  const day = (n: number, hour = 12) =>
    new Date(Date.UTC(2026, 8, n, hour, 0, 0));

  it('bands the month by how much of the ceiling is gone', () => {
    expect(budgetStatus(0, 3_000, day(15)).band).toBe('ok');
    expect(budgetStatus(2_099, 3_000, day(15)).band).toBe('ok');
    expect(budgetStatus(2_100, 3_000, day(15)).band).toBe('watch');
    expect(budgetStatus(2_700, 3_000, day(15)).band).toBe('critical');
    expect(budgetStatus(3_000, 3_000, day(15)).band).toBe('exhausted');
  });

  it('bands a cycle that overshot as exhausted, not as something above it', () => {
    // A sweep already in flight when the counter crossed can land past the
    // ceiling. There is no band above `exhausted` and there should not be.
    expect(budgetStatus(3_400, 3_000, day(15)).band).toBe('exhausted');
  });

  /**
   * THE §12.59 SCENARIO, which is the reason this function exists.
   *
   * §12.31's calibration projects ~516 calls/day. Against the 3,000 ceiling
   * that is reached partway through day six — the number §12.59 states in
   * prose and nothing computed until now.
   */
  it('reaches a 3,000 ceiling on day six at §12.31’s projected rate', () => {
    // Five days elapsed, spent at 516/day.
    const status = budgetStatus(516 * 5, 3_000, day(6, 0));
    expect(Math.round(status.burnPerDay)).toBe(516);
    expect(status.exhaustedOnDay).toBe(6);
  });

  it('reaches nothing at the rate actually measured', () => {
    // §12.59 measured ~2,700/month including restarts — 90/day on a 30-day
    // month, which never meets 3,000. `null` is the whole point: a forecast
    // that always names a day would cry wolf every month.
    const status = budgetStatus(90 * 15, 3_000, day(16, 0));
    expect(status.exhaustedOnDay).toBeNull();
    expect(Math.round(status.projectedMonthEnd)).toBe(2_700);
  });

  it('rounds the forecast day UP, because day 5.2 is not a date anyone acts on', () => {
    const status = budgetStatus(516 * 5, 3_000, day(6, 0));
    // 3000/516 = 5.81 days -> the ceiling arrives during day 6.
    expect(status.exhaustedOnDay).toBe(6);
  });

  /**
   * The first hours of a month divide by something near zero. Without a
   * floor, twelve calls at 00:05 on the 1st project to millions and the
   * warning fires on every new month.
   */
  it('does not report a wild burn rate in the first minutes of a month', () => {
    const justAfterMidnight = new Date(Date.UTC(2026, 8, 1, 0, 5, 0));
    const status = budgetStatus(12, 3_000, justAfterMidnight);
    // Floored at one hour of elapsed time: 12 calls/hour, not 12 per 5 min.
    expect(status.burnPerDay).toBeCloseTo(12 * 24, 0);
    expect(status.band).toBe('ok');
  });

  it('knows how long the month it is actually in is', () => {
    // September has 30 days, October 31, February 2026 has 28. Derived from
    // the date rather than assumed to be 30 — a projection that is 3% wrong
    // every other month is a projection nobody trusts.
    expect(budgetStatus(100, 3_000, new Date(Date.UTC(2026, 8, 10))).daysInMonth).toBe(30);
    expect(budgetStatus(100, 3_000, new Date(Date.UTC(2026, 9, 10))).daysInMonth).toBe(31);
    expect(budgetStatus(100, 3_000, new Date(Date.UTC(2026, 1, 10))).daysInMonth).toBe(28);
  });

  it('survives a month with nothing spent in it', () => {
    const status = budgetStatus(0, 3_000, day(15));
    expect(status.burnPerDay).toBe(0);
    expect(status.exhaustedOnDay).toBeNull();
    expect(status.band).toBe('ok');
  });
});
