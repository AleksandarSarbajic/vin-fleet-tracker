/**
 * A stop allowance, measured (phase 3au): the pure parts of `npm run
 * eta:stops`. REPORT ONLY — nothing here is read by the board, the engine or
 * the worker.
 *
 * The board's ETA is driving only (§12.111): far out, the error is the stops
 * it does not count. This learns, from our own positions and nothing else,
 * how many minutes trucks stop for a given amount of driving still to do,
 * and asks what HERE's uncapped duration plus that allowance would have said
 * on the trips `eta:score` scores.
 *
 * ## Stopped
 *
 * The scorer's rule, by construction: an interval between two fixes is
 * stationary when `stoppedMinutes` — the function `eta:score` and the
 * prediction log use — says so for that interval alone. A run of stationary
 * intervals is an EPISODE; one of `MIN_STOP_MINUTES` or more is a stop.
 * Everything else, short stationary runs included, is driving: "a crawl in
 * traffic counts as driving", as the scorer says.
 *
 * ## The allowance
 *
 * A truck's track is cut into LEGS at every stop that starts within the
 * arrival radius of a known stop point (a pickup or delivery: the trip the
 * board projects ends there) and at the track's own ends. Along each leg's
 * driving clock — time not in a stop — a window starts every `STEP_MS` of
 * driving, and for each remaining driving time R on the same grid it counts
 * the minutes stopped before R more of driving is done. A window that would
 * run past its leg's end is not counted: what happened after is not known.
 *
 * The allowance at R is the MEDIAN over every window, not the mean. A week
 * of positions holds parks of days, and the few windows that contain one
 * move a mean by hours for every trip; the median is also the figure the
 * scorer's own median error is measured against. Both are printed. It is made
 * non-decreasing in R (a running maximum), because a longer drive cannot
 * expect fewer stopped minutes, and is linear between grid points, from
 * zero at zero.
 *
 * Fitted LEAVE-ONE-TRUCK-OUT: a trip is replayed with the allowance fitted
 * on every truck but its own.
 */
import { ARRIVAL_DEFAULTS, STOPPED_BELOW_MPH } from '../src/lib/arrival';
import { MIN_STOP_MINUTES, median, quantile, stoppedMinutes, type TrackFix } from '../src/lib/eta-marks';
import { haversineMiles } from '../src/lib/status';
import { errorOf, type Scored } from './eta-trips.mjs';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/** The grid, for window starts and for remaining driving time alike. */
export const STEP_MS = 15 * MINUTE_MS;

/** A stop starting this close to a known stop point is at that stop. */
export const KNOWN_STOP_RADIUS_MILES = ARRIVAL_DEFAULTS.radiusMiles;

/** The brief's line for a trip the ETA missed badly, either way. */
export const TAIL_MINUTES = 60;

/* -------------------------------- episodes ------------------------------- */

/** The scorer's rule for one interval, asked of the scorer itself. */
export const stationary = (a: TrackFix, b: TrackFix): boolean =>
  stoppedMinutes([a, b], a.atMs, b.atMs, 0).minutes > 0;

export interface Episode {
  fromMs: number;
  toMs: number;
  minutes: number;
  /** The first fix: where the truck stopped. */
  lat: number;
  lng: number;
  /** The track starts, or ends, inside it: its true length is not known. */
  censoredStart: boolean;
  censoredEnd: boolean;
  /** Driving from the start of the track to the start of this stop. */
  drivingBeforeMs: number;
}

export interface TruckStops {
  /** Stops of `MIN_STOP_MINUTES` or more, in order. */
  episodes: Episode[];
  drivingMs: number;
  /**
   * Gaps longer than a stop that the rule counts as DRIVING although the
   * displacement says the truck did not move: an end fix reads above
   * `STOPPED_BELOW_MPH`. Counted, not reclassified — this is the scorer's
   * rule, and changing it is not this report's business.
   */
  parkedGaps: { count: number; minutes: number };
}

/** One fix per instant, in order. */
export function cleanTrack(fixes: readonly TrackFix[]): TrackFix[] {
  const seen = new Set<number>();
  return [...fixes]
    .sort((a, b) => a.atMs - b.atMs)
    .filter((f) => (seen.has(f.atMs) ? false : (seen.add(f.atMs), true)));
}

export function truckStops(track: readonly TrackFix[]): TruckStops {
  const fixes = cleanTrack(track);
  const episodes: Episode[] = [];
  const parkedGaps = { count: 0, minutes: 0 };
  let driving = 0;
  let runStart = -1;
  const close = (end: number) => {
    const from = fixes[runStart]!;
    const to = fixes[end]!;
    const ms = to.atMs - from.atMs;
    if (ms >= MIN_STOP_MINUTES * MINUTE_MS) {
      episodes.push({
        fromMs: from.atMs,
        toMs: to.atMs,
        minutes: ms / MINUTE_MS,
        lat: from.lat,
        lng: from.lng,
        censoredStart: runStart === 0,
        censoredEnd: end === fixes.length - 1,
        drivingBeforeMs: driving,
      });
    } else {
      driving += ms;
    }
    runStart = -1;
  };
  for (let i = 1; i < fixes.length; i++) {
    const a = fixes[i - 1]!;
    const b = fixes[i]!;
    if (stationary(a, b)) {
      if (runStart < 0) runStart = i - 1;
      continue;
    }
    if (runStart >= 0) close(i - 1);
    const dt = b.atMs - a.atMs;
    driving += dt;
    if (dt >= MIN_STOP_MINUTES * MINUTE_MS && haversineMiles(a, b) / (dt / HOUR_MS) <= STOPPED_BELOW_MPH) {
      parkedGaps.count++;
      parkedGaps.minutes += dt / MINUTE_MS;
    }
  }
  if (runStart >= 0) close(fixes.length - 1);
  return { episodes, drivingMs: driving, parkedGaps };
}

/** Within the arrival radius of any known stop point. */
export function atKnownStop(
  e: Pick<Episode, 'lat' | 'lng'>,
  points: readonly { lat: number; lng: number }[],
): boolean {
  return points.some((p) => haversineMiles(e, p) <= KNOWN_STOP_RADIUS_MILES);
}

/* ---------------------------------- legs --------------------------------- */

export interface Leg {
  drivingMs: number;
  /** Stops inside the leg, at the leg's driving clock. */
  stops: { atMs: number; minutes: number }[];
}

/**
 * Cut at every stop for which `endsLeg` is true and at every censored stop.
 * The clock does not run during a stop, so a stop at driving `d` ends one leg
 * at `d` and the next leg starts there.
 */
export function legsOf(t: TruckStops, endsLeg: (e: Episode) => boolean): Leg[] {
  const legs: Leg[] = [];
  let start = 0;
  let stops: Leg['stops'] = [];
  const push = (end: number) => {
    if (end > start) legs.push({ drivingMs: end - start, stops });
    stops = [];
  };
  for (const e of t.episodes) {
    if (e.censoredStart || e.censoredEnd || endsLeg(e)) {
      push(e.drivingBeforeMs);
      start = e.drivingBeforeMs;
    } else {
      stops.push({ atMs: e.drivingBeforeMs - start, minutes: e.minutes });
    }
  }
  push(t.drivingMs);
  return legs;
}

/**
 * Minutes stopped in each window of `remainingMs` driving, one window every
 * `stepMs` of driving from the leg's start. A stop at the window's first
 * instant counts (the truck stops after the prediction); one at its last
 * instant does not (that is where the drive ends).
 */
export function windowStops(leg: Leg, remainingMs: number, stepMs: number = STEP_MS): number[] {
  const out: number[] = [];
  for (let c = 0; c + remainingMs <= leg.drivingMs; c += stepMs) {
    let sum = 0;
    for (const s of leg.stops) if (s.atMs >= c && s.atMs < c + remainingMs) sum += s.minutes;
    out.push(sum);
  }
  return out;
}

/** Per truck, per grid point g (remaining driving (g + 1) × step): window minutes. */
export type WindowTable = Map<string, number[][]>;

export function windowTable(
  legsByTruck: ReadonlyMap<string, readonly Leg[]>,
  points: number,
  stepMs: number = STEP_MS,
): WindowTable {
  const table: WindowTable = new Map();
  for (const [truck, legs] of legsByTruck) {
    table.set(
      truck,
      Array.from({ length: points }, (_, g) => legs.flatMap((leg) => windowStops(leg, (g + 1) * stepMs, stepMs))),
    );
  }
  return table;
}

/* -------------------------------- the fit -------------------------------- */

export interface Allowance {
  stepMs: number;
  /** The allowance, minutes, at remaining (g + 1) × step: median, then running maximum. */
  minutes: number[];
  /** Before the running maximum. */
  medians: number[];
  means: number[];
  p75: number[];
  p90: number[];
  /** Share of windows with no stop at all. */
  zeroShare: number[];
  windows: number[];
  trucks: number[];
}

/**
 * The allowance from every truck in the table but `leaveOut`. The curve ends
 * at the first grid point no window reaches.
 */
export function fitAllowance(table: WindowTable, leaveOut: string | null, stepMs: number = STEP_MS): Allowance {
  const points = Math.max(0, ...[...table.values()].map((rows) => rows.length));
  const fit: Allowance = {
    stepMs,
    minutes: [],
    medians: [],
    means: [],
    p75: [],
    p90: [],
    zeroShare: [],
    windows: [],
    trucks: [],
  };
  let floor = 0;
  for (let g = 0; g < points; g++) {
    const used = [...table].filter(([truck, rows]) => truck !== leaveOut && (rows[g]?.length ?? 0) > 0);
    const values = used.flatMap(([, rows]) => rows[g]!);
    if (values.length === 0) break;
    const m = median(values);
    floor = Math.max(floor, m);
    fit.minutes.push(floor);
    fit.medians.push(m);
    fit.means.push(values.reduce((a, b) => a + b, 0) / values.length);
    fit.p75.push(quantile(values, 0.75));
    fit.p90.push(quantile(values, 0.9));
    fit.zeroShare.push(values.filter((v) => v === 0).length / values.length);
    fit.windows.push(values.length);
    fit.trucks.push(used.length);
  }
  return fit;
}

/**
 * Minutes to add for `remainingMs` of driving still to do. Linear between grid
 * points, from zero at zero; past the curve's end it is held at the last
 * value and `beyond` says so. Null when the fit has no point at all.
 */
export function allowanceAt(
  fit: Allowance,
  remainingMs: number,
): { minutes: number; beyond: boolean } | null {
  const n = fit.minutes.length;
  if (n === 0) return null;
  if (remainingMs <= 0) return { minutes: 0, beyond: false };
  const x = remainingMs / fit.stepMs;
  if (x >= n) return { minutes: fit.minutes[n - 1]!, beyond: x > n };
  const lo = Math.floor(x);
  const at = (k: number) => (k === 0 ? 0 : fit.minutes[k - 1]!);
  return { minutes: at(lo) + (at(lo + 1) - at(lo)) * (x - lo), beyond: false };
}

/* ------------------------------ the relation ----------------------------- */

/**
 * For each complete stop, the driving since the end of the last stop of at
 * least `longMinutes` before it, on the same track. A censored stop at the
 * start counts as long when what was seen of it already is.
 */
export function sinceLongStop(
  t: TruckStops,
  longMinutes: number,
): { pairs: { sinceMs: number; minutes: number; episode: Episode }[]; noPriorLong: number } {
  const pairs: { sinceMs: number; minutes: number; episode: Episode }[] = [];
  let noPriorLong = 0;
  let lastLong: Episode | null = null;
  for (const e of t.episodes) {
    if (!e.censoredStart && !e.censoredEnd) {
      if (lastLong) pairs.push({ sinceMs: e.drivingBeforeMs - lastLong.drivingBeforeMs, minutes: e.minutes, episode: e });
      else noPriorLong++;
    }
    if (e.minutes >= longMinutes) lastLong = e;
  }
  return { pairs, noPriorLong };
}

/**
 * Bin edges at the values' own quantiles, repeated edges merged. Bin i holds
 * values in (edges[i], edges[i + 1]]; the first bin also holds the minimum.
 */
export function quantileEdges(values: readonly number[], parts: number): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const edges = [sorted[0]!];
  for (let k = 1; k < parts; k++) edges.push(quantile(sorted, k / parts));
  edges.push(sorted[sorted.length - 1]!);
  const merged = edges.filter((e, i) => i === 0 || e > edges[i - 1]!);
  // All values equal: one bin, [v, v].
  return merged.length === 1 ? [merged[0]!, merged[0]!] : merged;
}

export function binOf(edges: readonly number[], v: number): number {
  for (let i = 1; i < edges.length; i++) if (v <= edges[i]!) return i - 1;
  return edges.length - 2;
}

/* --------------------------------- replay -------------------------------- */

export interface WithAllowance {
  row: Scored;
  /** HERE's uncapped driving time from the prediction to the stop. */
  remainingMs: number;
  allowance: number;
  beyond: boolean;
  /** Actual minus predicted, minutes, for each of the three ETAs. */
  current: number;
  hereRaw: number;
  withAllowance: number;
}

/**
 * The three ETAs on each row that has HERE's duration: what the board showed,
 * HERE raw, and HERE raw plus the allowance fitted without the row's truck.
 */
export function replayWithAllowance(
  rows: readonly Scored[],
  fitFor: (truckId: string) => Allowance,
): { rows: WithAllowance[]; noRoute: number; noFit: number } {
  const out: WithAllowance[] = [];
  let noRoute = 0;
  let noFit = 0;
  for (const row of rows) {
    const here = row.eta['here-raw'];
    const current = errorOf(row, 'shown', false);
    const hereRaw = errorOf(row, 'here-raw', false);
    if (here === null || current === null || hereRaw === null) {
      noRoute++;
      continue;
    }
    const remainingMs = here - row.anchorMs;
    const a = allowanceAt(fitFor(row.stop.truck_id), remainingMs);
    if (!a) {
      noFit++;
      continue;
    }
    out.push({
      row,
      remainingMs,
      allowance: a.minutes,
      beyond: a.beyond,
      current,
      hereRaw,
      withAllowance: hereRaw - a.minutes,
    });
  }
  return { rows: out, noRoute, noFit };
}

/** Errors of `TAIL_MINUTES` or more each way. + is the ETA before the arrival. */
export function tails(errors: readonly number[]): { late: number; early: number } {
  return {
    late: errors.filter((e) => e >= TAIL_MINUTES).length,
    early: errors.filter((e) => e <= -TAIL_MINUTES).length,
  };
}
