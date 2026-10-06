import { STOPPED_BELOW_MPH } from './arrival';
import {
  ROUTE_PROVIDER,
  needsRecompute,
  projectDistance,
  type CachedRoute,
  type DistanceBasis,
} from './routing';
import { haversineMiles, type StatusConfig } from './status';

/**
 * ETA accuracy: the pieces the scorer (`npm run eta:score`) and the worker's
 * prediction log share (§12.111). Pure — fixes, routes and stops arrive as
 * arguments, so the rule that decides "the truck crossed 100 miles" is the
 * same rule in the log and in the replay, and both can be tested against a
 * real track without a database.
 *
 * Nothing here changes an ETA. It re-asks the engine (`projectDistance`, the
 * function the board uses) what it would have said, and measures that against
 * what happened.
 */

/**
 * Straight-line distances at which a prediction is worth keeping.
 *
 * Straight-line rather than road miles because road miles depend on the basis,
 * and comparing the bases against each other is half the point: a mark that
 * moved with the thing being measured would not be a fixed point.
 */
export const ETA_MARKS_MILES = [400, 200, 100, 50, 25, 10] as const;

/**
 * A destination point as the prediction log keys it: integer microdegrees,
 * `"lat:lng"` (§12.112).
 *
 * The log is keyed on stop, destination and distance, and the settle step
 * matches a stop's current point against the logged one. Raw doubles would
 * make both depend on a float surviving every round trip bit-for-bit; a
 * microdegree is ~0.1 m, so two spellings of one point are one key while any
 * real re-geocode — metres at the least — is a new one. `-0` and `0` are one
 * key too. This is the ONLY place the key is made: the worker writes it and
 * the settle step compares it, so the two cannot disagree about a point.
 */
export function destinationKey(lat: number, lng: number): string {
  const micro = (x: number) => {
    const v = Math.round(x * 1e6);
    return String(v === 0 ? 0 : v);
  };
  return `${micro(lat)}:${micro(lng)}`;
}

/**
 * Marks crossed for the first time by this observation.
 *
 * A mark counts only if the truck was first seen BEYOND it. A stop entered
 * while the truck is 80 mi out has no 100-mile prediction — the board never
 * showed one — and pretending the first sighting was a crossing would score a
 * number nobody saw.
 *
 * `logged` is what has already been recorded; a mark is never recorded twice,
 * so a truck that drives away and comes back does not log it again. The
 * database's unique (stop, mark) index says the same thing a second time.
 */
export function marksCrossed(
  firstSeenStraight: number,
  straightNow: number,
  logged: ReadonlySet<number>,
  marks: readonly number[] = ETA_MARKS_MILES,
): number[] {
  return marks.filter((m) => firstSeenStraight > m && straightNow <= m && !logged.has(m));
}

/* ------------------------------ stopped time ----------------------------- */

export interface TrackFix {
  atMs: number;
  lat: number;
  lng: number;
  speedMph: number | null;
}

/**
 * A stationary stretch shorter than this is driving: lights, queues, a slow
 * on-ramp. Ten minutes keeps fuel stops, rests and staging, which are what
 * "driving only" has to take out.
 */
export const MIN_STOP_MINUTES = 10;

/**
 * Between two fixes this far apart, the reported speeds are not enough on
 * their own — a feed gap can hide a hundred miles — so the displacement has to
 * agree that nothing moved.
 */
const GAP_CHECK_MS = 120_000;

/** The window must have a fix within this of each end to be called covered. */
const COVER_TOLERANCE_MS = 15 * 60_000;

export interface StoppedTime {
  /** Minutes in stationary episodes of at least `MIN_STOP_MINUTES`. */
  minutes: number;
  /** False when the fixes do not reach both ends of the window. */
  covered: boolean;
}

/**
 * Minutes the truck spent stopped between `fromMs` and `toMs`.
 *
 * Stopped uses the arrival sweep's own threshold (`STOPPED_BELOW_MPH`), so
 * the two can never disagree about whether a truck was moving. An interval
 * counts when both ends are stopped; across a gap longer than two minutes the
 * displacement must also imply no more than that speed, which is what an
 * ignition-off rest looks like (no fixes, no movement) and what a feed outage
 * on the interstate does not.
 */
export function stoppedMinutes(
  fixes: readonly TrackFix[],
  fromMs: number,
  toMs: number,
  minStopMinutes: number = MIN_STOP_MINUTES,
): StoppedTime {
  const inside = fixes.filter((f) => f.atMs >= fromMs && f.atMs <= toMs);
  const first = inside[0];
  const last = inside[inside.length - 1];
  const covered =
    first !== undefined &&
    last !== undefined &&
    first.atMs - fromMs <= COVER_TOLERANCE_MS &&
    toMs - last.atMs <= COVER_TOLERANCE_MS;

  let total = 0;
  let episode = 0;
  const close = () => {
    if (episode >= minStopMinutes * 60_000) total += episode;
    episode = 0;
  };
  for (let i = 1; i < inside.length; i++) {
    const a = inside[i - 1]!;
    const b = inside[i]!;
    const dt = b.atMs - a.atMs;
    if (dt <= 0) continue;
    if (stationaryBetween(a, b, dt)) episode += dt;
    else close();
  }
  close();
  return { minutes: total / 60_000, covered };
}

function stationaryBetween(a: TrackFix, b: TrackFix, dt: number): boolean {
  const slow = (f: TrackFix) => f.speedMph === null || f.speedMph <= STOPPED_BELOW_MPH;
  if (!slow(a) || !slow(b)) return false;
  const unknown = a.speedMph === null || b.speedMph === null;
  if (dt <= GAP_CHECK_MS && !unknown) return true;
  const mph = haversineMiles(a, b) / (dt / 3_600_000);
  return mph <= STOPPED_BELOW_MPH;
}

/* -------------------------------- crossing ------------------------------- */

/**
 * The first fix in a track at or inside `mark` straight-line miles of the
 * stop, by the same rule as `marksCrossed`: the earliest fix in the track
 * must be beyond the mark. Null when the track never shows a crossing.
 */
export function firstCrossing<F extends { lat: number; lng: number }>(
  track: readonly F[],
  stop: { lat: number; lng: number },
  mark: number,
): { fix: F; straight: number } | null {
  const head = track[0];
  if (!head || haversineMiles(head, stop) <= mark) return null;
  for (const fix of track) {
    const straight = haversineMiles(fix, stop);
    if (straight <= mark) return { fix, straight };
  }
  return null;
}

/* --------------------------------- replay -------------------------------- */

export interface Replayed {
  /** What the board showed: the real freshness rule, the real basis. */
  shown: { etaMs: number; miles: number; speedMph: number; basis: DistanceBasis };
  /** Each basis forced, from the same inputs. Null where it needs a route. */
  routed: number | null;
  laneEstimate: number | null;
  straightLine: number;
  /** The route's own duration, no cap. Null without a route. */
  hereRaw: number | null;
}

/**
 * Every ETA the engine could have produced at one fix.
 *
 * `fresh` is the board's own rule (`needsRecompute(...) === null`), so pass
 * the truck's coordinates and the instant the board would have read them; the
 * forced variants ignore it.
 */
export function replayAt(input: {
  anchorMs: number;
  straight: number;
  route: CachedRoute | null;
  fresh: boolean;
  config: Pick<StatusConfig, 'avgSpeedMph' | 'roadFactor'>;
}): Replayed {
  const { anchorMs, straight, route, fresh, config } = input;
  const at = (p: { miles: number; speedMph: number }) =>
    anchorMs + (p.miles / p.speedMph) * 3_600_000;
  const shown = projectDistance(straight, route, config.roadFactor, config.avgSpeedMph, fresh);
  return {
    shown: { etaMs: at(shown), miles: shown.miles, speedMph: shown.speedMph, basis: shown.basis },
    routed: route
      ? at(projectDistance(straight, route, config.roadFactor, config.avgSpeedMph, true))
      : null,
    laneEstimate: route
      ? at(projectDistance(straight, route, config.roadFactor, config.avgSpeedMph, false))
      : null,
    straightLine: at(projectDistance(straight, null, config.roadFactor, config.avgSpeedMph, false)),
    // An infinite average leaves `cappedSpeed` with the route's own speed.
    hereRaw: route ? at(projectDistance(straight, route, config.roadFactor, Infinity, true)) : null,
  };
}

/** The board's freshness rule, for a truck at `truck` read at `at`. */
export function routeFreshAt(
  route: CachedRoute | null,
  truck: { lat: number; lng: number },
  stop: { lat: number; lng: number },
  at: Date,
): boolean {
  return (
    route !== null &&
    needsRecompute(
      route,
      {
        truckLat: truck.lat,
        truckLng: truck.lng,
        stopLat: stop.lat,
        stopLng: stop.lng,
        provider: ROUTE_PROVIDER,
      },
      at,
    ) === null
  );
}

/**
 * The ZIP what-if: the same prediction, had the stop been geocoded to its ZIP
 * centre. The extra straight-line distance is turned into road miles at the
 * lane's ratio (or the fallback factor) and driven at the speed actually used,
 * so the difference is the precision and nothing else.
 */
export function zipWhatIfEtaMs(
  shown: Replayed['shown'],
  anchorMs: number,
  straightToStop: number,
  straightToCentroid: number,
  ratio: number,
): number {
  const miles = Math.max(0, shown.miles + (straightToCentroid - straightToStop) * ratio);
  return anchorMs + (miles / shown.speedMph) * 3_600_000;
}

/* ------------------------------- summaries ------------------------------- */

/**
 * How many places a set of observations really comes from — the
 * `shadow:analyse` measure (§12.73). `eff` is 1 / Σ share², which equals the
 * place count when every place supplies the same number and falls toward 1 as
 * one place dominates.
 */
export function concentration(places: readonly string[]): {
  places: number;
  top2: number;
  eff: number;
} {
  const counts = new Map<string, number>();
  for (const p of places) counts.set(p, (counts.get(p) ?? 0) + 1);
  const n = places.length;
  if (n === 0) return { places: 0, top2: 0, eff: 0 };
  const sorted = [...counts.values()].sort((a, b) => b - a);
  return {
    places: counts.size,
    top2: ((sorted[0] ?? 0) + (sorted[1] ?? 0)) / n,
    eff: 1 / sorted.reduce((acc, c) => acc + (c / n) ** 2, 0),
  };
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Nearest-rank quantile. Under ten values, q = 0.9 is the maximum. */
export function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

/** Within this of the ETA, a truck is neither early nor late. */
export const ON_TIME_BAND_MINUTES = 5;

export interface ErrorSummary {
  n: number;
  /** Positive: the truck arrived AFTER the ETA — the board was optimistic. */
  medianSigned: number;
  medianAbs: number;
  /** The worst 10%, as the 90th percentile of |error|. */
  p90Abs: number;
  late: number;
  early: number;
  within: number;
}

/** `errors` in minutes, actual minus predicted. */
export function summarise(errors: readonly number[]): ErrorSummary {
  const abs = errors.map(Math.abs);
  return {
    n: errors.length,
    medianSigned: median(errors),
    medianAbs: median(abs),
    p90Abs: quantile(abs, 0.9),
    late: errors.filter((e) => e > ON_TIME_BAND_MINUTES).length,
    early: errors.filter((e) => e < -ON_TIME_BAND_MINUTES).length,
    within: errors.filter((e) => Math.abs(e) <= ON_TIME_BAND_MINUTES).length,
  };
}
