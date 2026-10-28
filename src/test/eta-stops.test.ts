import { describe, expect, it } from 'vitest';
import { stoppedMinutes, type TrackFix } from '@/lib/eta-marks';
import {
  KNOWN_STOP_RADIUS_MILES,
  STEP_MS,
  allowanceAt,
  atKnownStop,
  binOf,
  fitAllowance,
  legsOf,
  quantileEdges,
  replayWithAllowance,
  sinceLongStop,
  tails,
  truckStops,
  windowStops,
  windowTable,
  type Episode,
  type Leg,
  type TruckStops,
  type WindowTable,
} from '../../scripts/eta-stops.mjs';
import type { Scored, StopRow, Variant } from '../../scripts/eta-trips.mjs';

/**
 * The stop allowance (phase 3au). Invented tracks only: no position, stop or
 * truck here is real.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.UTC(2026, 0, 5, 12);
/** One mile of latitude, near enough. */
const MILE_DEG = 1 / 69;

/** A track built piece by piece: fixes every 30 s, driving at 60 mph north. */
function build(): {
  drive: (minutes: number) => void;
  stop: (minutes: number) => void;
  gap: (minutes: number, miles: number, speedAfter: number) => void;
  fixes: TrackFix[];
} {
  const fixes: TrackFix[] = [];
  let t = T0;
  let lat = 45;
  const push = (speedMph: number) => fixes.push({ atMs: t, lat, lng: -95, speedMph });
  push(60);
  return {
    fixes,
    drive(minutes) {
      for (let k = 0; k < minutes * 2; k++) {
        t += 30_000;
        lat += 0.5 * MILE_DEG;
        push(60);
      }
    },
    /** First stopped fix 30 s after the last one, then `minutes` of them. */
    stop(minutes) {
      t += 30_000;
      push(0);
      for (let k = 0; k < minutes * 2; k++) {
        t += 30_000;
        push(0);
      }
    },
    /** No fixes for `minutes`, then one `miles` further on at `speedAfter`. */
    gap(minutes, miles, speedAfter) {
      t += minutes * MIN;
      lat += miles * MILE_DEG;
      push(speedAfter);
    },
  };
}

const span = (fixes: readonly TrackFix[]) => fixes[fixes.length - 1]!.atMs - fixes[0]!.atMs;

describe('stop episodes, by the scorer’s rule', () => {
  it('keeps a stop of 10 minutes or more; a shorter one is driving', () => {
    const b = build();
    b.drive(20);
    b.stop(12);
    b.drive(20);
    b.stop(8);
    b.drive(20);
    const t = truckStops(b.fixes);
    expect(t.episodes.map((e) => e.minutes)).toEqual([12]);
    expect(t.episodes[0]).toMatchObject({ censoredStart: false, censoredEnd: false });
    expect(t.drivingMs).toBe(span(b.fixes) - 12 * MIN);
  });

  it('sums to what stoppedMinutes says over the whole track', () => {
    const b = build();
    b.stop(15);
    b.drive(35);
    b.stop(9);
    b.drive(5);
    b.stop(10);
    b.drive(5);
    b.stop(41);
    b.gap(180, 0, 0);
    b.drive(70);
    b.gap(60, 60, 60);
    b.stop(25);
    const t = truckStops(b.fixes);
    const total = t.episodes.reduce((a, e) => a + e.minutes, 0);
    expect(total).toBeCloseTo(stoppedMinutes(b.fixes, T0, b.fixes.at(-1)!.atMs).minutes, 9);
    expect(t.drivingMs + total * MIN).toBeCloseTo(span(b.fixes), 6);
  });

  it('counts an ignition-off rest with no fixes as one stop, and a feed gap on the road as driving', () => {
    const b = build();
    b.drive(10);
    b.stop(2);
    b.gap(200, 0, 0);
    b.drive(10);
    b.gap(60, 55, 60);
    b.drive(10);
    const t = truckStops(b.fixes);
    expect(t.episodes.map((e) => e.minutes)).toEqual([202]);
    expect(t.parkedGaps.count).toBe(0);
  });

  it('marks a stop the track starts or ends inside as censored', () => {
    const b = build();
    b.stop(15);
    b.drive(20);
    b.stop(11);
    // Without the first (driving) fix, the track starts 15 min of stop.
    const t = truckStops(b.fixes.slice(1));
    expect(t.episodes.map((e) => [e.minutes, e.censoredStart, e.censoredEnd])).toEqual([
      [15, true, false],
      [11, false, true],
    ]);
  });

  it('counts, and leaves as driving, a long gap with no movement whose end fix reads above 3 mph', () => {
    const b = build();
    b.drive(10);
    b.stop(2);
    b.gap(150, 0.01, 5);
    b.drive(10);
    const t = truckStops(b.fixes);
    expect(t.episodes).toEqual([]);
    expect(t.parkedGaps).toEqual({ count: 1, minutes: 150 });
  });

  it('records the driving before each stop, and ignores a repeated fix', () => {
    const b = build();
    b.drive(40);
    b.stop(20);
    b.drive(25);
    b.stop(10);
    const once = truckStops(b.fixes);
    const twice = truckStops([...b.fixes, ...b.fixes.slice(10, 40)].reverse());
    expect(twice).toEqual(once);
    const [first, second] = once.episodes;
    // Each stop's first fix comes 30 s after the last driving fix.
    expect(first!.drivingBeforeMs).toBe(40 * MIN + 30_000);
    expect(second!.drivingBeforeMs).toBe(first!.drivingBeforeMs + 25 * MIN + 30_000);
  });
});

describe('legs', () => {
  const episode = (drivingBeforeMs: number, minutes: number, over: Partial<Episode> = {}): Episode => ({
    fromMs: 0,
    toMs: 0,
    minutes,
    lat: 45,
    lng: -95,
    censoredStart: false,
    censoredEnd: false,
    drivingBeforeMs,
    ...over,
  });

  it('ends a leg at a stop at a known point; that stop is in neither leg', () => {
    const t: TruckStops = {
      episodes: [episode(1 * HOUR, 20), episode(3 * HOUR, 90, { lat: 46 }), episode(4 * HOUR, 45)],
      drivingMs: 6 * HOUR,
      parkedGaps: { count: 0, minutes: 0 },
    };
    const legs = legsOf(t, (e) => atKnownStop(e, [{ lat: 46, lng: -95 }]));
    expect(legs).toEqual<Leg[]>([
      { drivingMs: 3 * HOUR, stops: [{ atMs: 1 * HOUR, minutes: 20 }] },
      { drivingMs: 3 * HOUR, stops: [{ atMs: 1 * HOUR, minutes: 45 }] },
    ]);
  });

  it('ends a leg at a censored stop', () => {
    const t: TruckStops = {
      episodes: [episode(0, 40, { censoredStart: true }), episode(2 * HOUR, 15), episode(5 * HOUR, 70, { censoredEnd: true })],
      drivingMs: 5 * HOUR,
      parkedGaps: { count: 0, minutes: 0 },
    };
    expect(legsOf(t, () => false)).toEqual<Leg[]>([{ drivingMs: 5 * HOUR, stops: [{ atMs: 2 * HOUR, minutes: 15 }] }]);
  });

  it('uses the arrival radius for a known stop', () => {
    const point = { lat: 45, lng: -95 };
    const north = (miles: number) => ({ lat: 45 + miles / 69.09, lng: -95 });
    expect(KNOWN_STOP_RADIUS_MILES).toBe(0.35);
    expect(atKnownStop(north(0.3), [point])).toBe(true);
    expect(atKnownStop(north(0.4), [point])).toBe(false);
  });
});

describe('windows', () => {
  const leg: Leg = { drivingMs: 4 * HOUR, stops: [{ atMs: 2 * HOUR, minutes: 40 }] };

  it('counts a stop at the window’s first instant, not at its last', () => {
    // Starts every 15 min from 0 to 3 h; the stop at 2 h is in c <= 2h < c + 1h.
    expect(windowStops(leg, 1 * HOUR)).toEqual([0, 0, 0, 0, 0, 40, 40, 40, 40, 0, 0, 0, 0]);
  });

  it('never counts a window that would run past the leg’s end', () => {
    expect(windowStops(leg, 4 * HOUR)).toEqual([40]);
    expect(windowStops(leg, 4 * HOUR + STEP_MS)).toEqual([]);
  });

  it('tabulates every truck’s legs on the grid', () => {
    const table = windowTable(new Map([['a', [leg]]]), 16);
    expect(table.get('a')!.map((w) => w.length)).toEqual([16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(table.get('a')![3]).toEqual(windowStops(leg, 1 * HOUR));
  });
});

describe('the fit', () => {
  it('is the median over windows, made non-decreasing', () => {
    const table: WindowTable = new Map([
      ['a', [[0, 0, 10], [0, 40, 40], [20, 20, 20]]],
    ]);
    const fit = fitAllowance(table, null);
    expect(fit.medians).toEqual([0, 40, 20]);
    expect(fit.minutes).toEqual([0, 40, 40]);
    expect(fit.windows).toEqual([3, 3, 3]);
    expect(fit.zeroShare[0]).toBeCloseTo(2 / 3, 9);
  });

  it('leaves every window of the left-out truck out', () => {
    const table: WindowTable = new Map([
      ['a', [[500, 500, 500], [500, 500]]],
      ['b', [[5, 5], [7]]],
    ]);
    expect(fitAllowance(table, 'a').minutes).toEqual([5, 7]);
    expect(fitAllowance(table, 'b').minutes).toEqual([500, 500]);
    expect(fitAllowance(table, 'a').trucks).toEqual([1, 1]);
    expect(fitAllowance(table, null).trucks).toEqual([2, 2]);
  });

  it('ends the curve at the first point no window reaches', () => {
    const table: WindowTable = new Map([['a', [[5], [], [9]]]]);
    expect(fitAllowance(table, null).minutes).toEqual([5]);
    expect(fitAllowance(table, 'a').minutes).toEqual([]);
  });

  it('is zero at zero, linear between points, and held past the end', () => {
    const step = 20 * MIN;
    const fit = fitAllowance(new Map([['a', [[10], [20]]]]), null, step);
    expect(allowanceAt(fit, 0)).toEqual({ minutes: 0, beyond: false });
    expect(allowanceAt(fit, 10 * MIN)).toEqual({ minutes: 5, beyond: false });
    expect(allowanceAt(fit, 20 * MIN)).toEqual({ minutes: 10, beyond: false });
    expect(allowanceAt(fit, 35 * MIN)!.minutes).toBeCloseTo(17.5, 9);
    expect(allowanceAt(fit, 40 * MIN)).toEqual({ minutes: 20, beyond: false });
    expect(allowanceAt(fit, 50 * MIN)).toEqual({ minutes: 20, beyond: true });
    expect(allowanceAt(fitAllowance(new Map(), null, step), 10 * MIN)).toBeNull();
  });
});

describe('the relation', () => {
  const at = (drivingBeforeMs: number, minutes: number, censoredStart = false): Episode => ({
    fromMs: 0,
    toMs: 0,
    minutes,
    lat: 45,
    lng: -95,
    censoredStart,
    censoredEnd: false,
    drivingBeforeMs,
  });

  it('measures driving from the last long stop to each stop', () => {
    const t: TruckStops = {
      episodes: [at(1 * HOUR, 12), at(2 * HOUR, 100), at(4 * HOUR, 15), at(5 * HOUR, 20), at(6 * HOUR, 80)],
      drivingMs: 8 * HOUR,
      parkedGaps: { count: 0, minutes: 0 },
    };
    const { pairs, noPriorLong } = sinceLongStop(t, 50);
    expect(noPriorLong).toBe(2);
    expect(pairs.map((p) => [p.sinceMs / HOUR, p.minutes])).toEqual([
      [2, 15],
      [3, 20],
      [4, 80],
    ]);
  });

  it('counts a censored first stop as long when what was seen of it is', () => {
    const t: TruckStops = {
      episodes: [at(0, 70, true), at(3 * HOUR, 15)],
      drivingMs: 4 * HOUR,
      parkedGaps: { count: 0, minutes: 0 },
    };
    expect(sinceLongStop(t, 50).pairs.map((p) => p.sinceMs / HOUR)).toEqual([3]);
    expect(sinceLongStop(t, 90)).toMatchObject({ pairs: [], noPriorLong: 1 });
  });

  it('bins at the values’ own quantiles, ties merged', () => {
    const edges = quantileEdges([1, 2, 3, 4, 5, 6, 7, 8], 4);
    expect(edges).toEqual([1, 3, 5, 7, 8]);
    expect([1, 3, 3.5, 7, 8].map((v) => binOf(edges, v))).toEqual([0, 0, 1, 2, 3]);
    expect(quantileEdges([0, 0, 0, 0, 9], 4)).toEqual([0, 9]);
    expect(quantileEdges([4, 4], 4)).toEqual([4, 4]);
    expect(binOf([4, 4], 4)).toBe(0);
  });
});

describe('the replay', () => {
  const stop = (truckId: string, arrivedMs: number): StopRow => ({
    stop_id: `stop-${truckId}-${arrivedMs}`,
    truck_id: truckId,
    truck_number: 900,
    city: null,
    state: null,
    zip: null,
    lat: 45,
    lng: -95,
    precision: 'street',
    arrived_at: new Date(arrivedMs),
    arrived_source: 'detected',
    load_created_at: new Date(T0 - 24 * HOUR),
  });
  const row = (truckId: string, here: number | null, shown: number, arrived: number): Scored => {
    const eta: Record<Variant, number | null> = {
      shown,
      routed: shown,
      'lane-estimate': null,
      'straight-line': shown,
      'here-raw': here,
      'zip-what-if': null,
    };
    return {
      stop: stop(truckId, arrived),
      place: 'invented',
      mark: 100,
      source: 'log',
      atMiles: 99,
      anchorMs: T0,
      basisShown: 'routed',
      stopped: null,
      eta,
    };
  };

  it('adds the allowance fitted without the row’s own truck', () => {
    const table: WindowTable = new Map([
      ['a', Array.from({ length: 8 }, () => [500])],
      ['b', Array.from({ length: 8 }, () => [20])],
    ]);
    const fits = new Map(['a', 'b'].map((t) => [t, fitAllowance(table, t)]));
    // HERE says 2 h; the board said 2 h 30; the truck took 3 h.
    const r = row('a', T0 + 2 * HOUR, T0 + 150 * MIN, T0 + 3 * HOUR);
    const { rows, noRoute, noFit } = replayWithAllowance([r], (t) => fits.get(t)!);
    expect({ noRoute, noFit }).toEqual({ noRoute: 0, noFit: 0 });
    expect(rows[0]).toMatchObject({
      remainingMs: 2 * HOUR,
      allowance: 20,
      beyond: false,
      current: 30,
      hereRaw: 60,
      withAllowance: 40,
    });
  });

  it('skips a row with no route, and a row whose fold has no data', () => {
    const table: WindowTable = new Map([['a', [[5]]]]);
    const { rows, noRoute, noFit } = replayWithAllowance(
      [row('a', null, T0 + HOUR, T0 + HOUR), row('a', T0 + HOUR, T0 + HOUR, T0 + HOUR)],
      (t) => fitAllowance(table, t),
    );
    expect({ rows: rows.length, noRoute, noFit }).toEqual({ rows: 0, noRoute: 1, noFit: 1 });
  });

  it('counts misses of 60 minutes or more each way', () => {
    expect(tails([60, 59, -59, -60, 200, -1, 0])).toEqual({ late: 2, early: 1 });
  });
});
