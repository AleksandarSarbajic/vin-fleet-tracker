import { describe, expect, it } from 'vitest';
import {
  ETA_MARKS_MILES,
  MIN_STOP_MINUTES,
  concentration,
  destinationKey,
  firstCrossing,
  marksCrossed,
  replayAt,
  stoppedMinutes,
  summarise,
  zipWhatIfEtaMs,
  type TrackFix,
} from './eta-marks';
import { ROUTE_PROVIDER, type CachedRoute } from './routing';
import { STATUS_DEFAULTS } from './status';

const MIN = 60_000;
const CONFIG = { avgSpeedMph: STATUS_DEFAULTS.avgSpeedMph, roadFactor: STATUS_DEFAULTS.roadFactor };

describe('destinationKey', () => {
  it('counts two floating-point forms of the same point as one', () => {
    expect(destinationKey(0.1 + 0.2, -88.0817)).toBe(destinationKey(0.3, -88.0817));
    expect(destinationKey(41.525, -88.0817)).toBe(
      destinationKey(41.525000000000006, -88.08169999999999),
    );
    expect(destinationKey(-0, 0)).toBe(destinationKey(0, -0));
  });

  it('counts a moved point as new, down to a metre', () => {
    // 0.00001 deg of latitude is about 1.1 m.
    expect(destinationKey(41.52501, -88.0817)).not.toBe(destinationKey(41.525, -88.0817));
    expect(destinationKey(41.525, -88.0817)).not.toBe(destinationKey(-88.0817, 41.525));
  });

  it('writes the shape the database checks', () => {
    expect(destinationKey(41.525, -88.0817)).toMatch(/^-?[0-9]+:-?[0-9]+$/);
    expect(destinationKey(41.525, -88.0817)).toBe('41525000:-88081700');
  });
});

describe('marksCrossed', () => {
  const none = new Set<number>();

  it('records a mark the first time the truck is inside it', () => {
    expect(marksCrossed(250, 199.6, none)).toEqual([200]);
  });

  it('never records a mark the truck was already inside when first seen', () => {
    // Entered at 80 mi: the board never showed a 100-mile prediction.
    expect(marksCrossed(80, 79, none)).toEqual([]);
    expect(marksCrossed(80, 49, none)).toEqual([50]);
  });

  it('does not record a mark again when the truck drives away and comes back', () => {
    const logged = new Set([200, 100, 50]);
    // Back out to 70, then in to 48 — 50 is not crossed a second time.
    expect(marksCrossed(250, 70, logged)).toEqual([]);
    expect(marksCrossed(250, 48, logged)).toEqual([]);
  });

  it('records every mark a feed gap jumped, each once', () => {
    expect(marksCrossed(450, 90, none)).toEqual([400, 200, 100]);
  });

  it('logs at most one row per mark per stop', () => {
    expect(ETA_MARKS_MILES.length).toBe(new Set(ETA_MARKS_MILES).size);
  });
});

/** A truck at a point, one fix every `stepS` seconds. */
function parked(fromMs: number, minutes: number, stepS = 30, at = { lat: 41.5, lng: -88.1 }) {
  const fixes: TrackFix[] = [];
  for (let t = 0; t <= minutes * MIN; t += stepS * 1000) {
    fixes.push({ atMs: fromMs + t, ...at, speedMph: 0 });
  }
  return fixes;
}

/** Driving due north at `mph`. */
function driving(fromMs: number, minutes: number, mph = 60, start = { lat: 41.5, lng: -88.1 }) {
  const fixes: TrackFix[] = [];
  for (let t = 30_000; t <= minutes * MIN; t += 30_000) {
    const miles = (mph * t) / 3_600_000;
    fixes.push({ atMs: fromMs + t, lat: start.lat + miles / 69, lng: start.lng, speedMph: mph });
  }
  return fixes;
}

describe('stoppedMinutes', () => {
  const t0 = Date.UTC(2026, 9, 1, 12);

  it('counts a rest stop and ignores a short one', () => {
    const fixes = [
      ...driving(t0, 30),
      ...parked(t0 + 31 * MIN, 45),
      ...driving(t0 + 77 * MIN, 30),
      ...parked(t0 + 108 * MIN, MIN_STOP_MINUTES - 4),
      ...driving(t0 + 115 * MIN, 30),
    ].sort((a, b) => a.atMs - b.atMs);
    const result = stoppedMinutes(fixes, t0, t0 + 145 * MIN);
    expect(result.minutes).toBeCloseTo(45, 0);
    expect(result.covered).toBe(true);
  });

  it('counts an ignition-off gap with no fixes and no movement', () => {
    const at = { lat: 41.5, lng: -88.1 };
    const fixes: TrackFix[] = [
      { atMs: t0, ...at, speedMph: 0 },
      { atMs: t0 + 63 * MIN, ...at, speedMph: 0 },
    ];
    expect(stoppedMinutes(fixes, t0, t0 + 63 * MIN).minutes).toBeCloseTo(63, 5);
  });

  it('does not count a feed gap the truck drove through', () => {
    const fixes: TrackFix[] = [
      { atMs: t0, lat: 41.5, lng: -88.1, speedMph: 0 },
      // 40 miles further on, an hour later, also reading 0 at both ends.
      { atMs: t0 + 60 * MIN, lat: 41.5 + 40 / 69, lng: -88.1, speedMph: 0 },
    ];
    expect(stoppedMinutes(fixes, t0, t0 + 60 * MIN).minutes).toBe(0);
  });

  it('says when the fixes do not reach the ends of the window', () => {
    const fixes = parked(t0 + 60 * MIN, 30);
    expect(stoppedMinutes(fixes, t0, t0 + 90 * MIN).covered).toBe(false);
    expect(stoppedMinutes([], t0, t0 + 90 * MIN)).toEqual({ minutes: 0, covered: false });
  });
});

describe('firstCrossing', () => {
  const stop = { lat: 42.5, lng: -88.1 };
  const t0 = Date.UTC(2026, 9, 1, 12);

  it('finds the first fix inside the mark', () => {
    const track = driving(t0, 120, 60); // 41.5 -> ~43.2: passes the stop
    const hit = firstCrossing(track, stop, 25);
    expect(hit).not.toBeNull();
    expect(hit!.straight).toBeLessThanOrEqual(25);
    const before = track[track.indexOf(hit!.fix) - 1]!;
    expect(Math.abs(before.lat - stop.lat) * 69).toBeGreaterThan(25);
  });

  it('refuses a track that starts inside the mark', () => {
    expect(firstCrossing(driving(t0, 120, 60), stop, 100)).toBeNull();
  });
});

function route(over: Partial<CachedRoute> = {}): CachedRoute {
  return {
    provider: ROUTE_PROVIDER,
    routedMiles: 128,
    routedDurationS: 2 * 3600, // 64 mph
    fromLat: 0,
    fromLng: 0,
    straightAtRouteMiles: 100,
    laneRatio: 1.28,
    stopLat: 42.5,
    stopLng: -88.1,
    snapFromM: 5,
    snapToM: 5,
    computedAtUtc: '2026-10-01T12:00:00.000Z',
    ...over,
  };
}

describe('replayAt', () => {
  const anchorMs = Date.UTC(2026, 9, 1, 12);
  const hours = (ms: number | null) => ((ms ?? NaN) - anchorMs) / 3_600_000;

  it('shows the routed figure at the cap when the route is fresh', () => {
    const r = replayAt({ anchorMs, straight: 100, route: route(), fresh: true, config: CONFIG });
    expect(r.shown.basis).toBe('routed');
    expect(r.shown.etaMs).toBe(r.routed);
    expect(hours(r.routed)).toBeCloseTo(128 / 52, 6);
  });

  it("takes HERE's own speed for the uncapped variant", () => {
    const r = replayAt({ anchorMs, straight: 100, route: route(), fresh: true, config: CONFIG });
    expect(hours(r.hereRaw)).toBeCloseTo(2, 6);
  });

  it('replays every basis from the same inputs', () => {
    const r = replayAt({ anchorMs, straight: 80, route: route(), fresh: false, config: CONFIG });
    expect(r.shown.basis).toBe('lane-estimate');
    expect(hours(r.laneEstimate)).toBeCloseTo((80 * 1.28) / 52, 6);
    // Advanced by the 20 straight miles covered, at the lane's ratio (§12.40).
    expect(hours(r.routed)).toBeCloseTo((128 - 20 * 1.28) / 52, 6);
    expect(hours(r.straightLine)).toBeCloseTo((80 * 1.25) / 52, 6);
  });

  it('has no route-based variants without a route', () => {
    const r = replayAt({ anchorMs, straight: 80, route: null, fresh: false, config: CONFIG });
    expect(r.shown.basis).toBe('straight-line');
    expect([r.routed, r.laneEstimate, r.hereRaw]).toEqual([null, null, null]);
  });

  it('moves the ZIP what-if by the extra distance only', () => {
    const r = replayAt({ anchorMs, straight: 100, route: route(), fresh: true, config: CONFIG });
    const eta = zipWhatIfEtaMs(r.shown, anchorMs, 100, 102, 1.28);
    expect((eta - r.shown.etaMs) / 3_600_000).toBeCloseTo((2 * 1.28) / 52, 6);
  });
});

describe('summaries', () => {
  it('reads positive error as the truck arriving after the ETA', () => {
    const s = summarise([30, 40, -10, 2]);
    expect(s).toMatchObject({ n: 4, late: 2, early: 1, within: 1, medianSigned: 16 });
    expect(s.p90Abs).toBe(40);
  });

  it('measures concentration as shadow:analyse does', () => {
    expect(concentration(['a', 'b', 'c', 'd'])).toEqual({ places: 4, top2: 0.5, eff: 4 });
    expect(concentration(['a', 'a', 'a', 'b']).eff).toBeCloseTo(1 / (0.75 ** 2 + 0.25 ** 2), 6);
  });
});
