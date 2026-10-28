/**
 * The trips `npm run eta:score` scores, and the predictions it holds against
 * them (§12.111): its database read and its selection rules, in one place.
 *
 * Moved here unchanged from `eta-score.mts` (phase 3au) so that `eta:stops`
 * replays exactly the rows the scorer scores. Two copies of "which prediction
 * counts at 100 miles" would drift apart without either one failing; one copy
 * cannot. The scorer's own documentation — sources, sign, what it cannot
 * support — stays with the scorer.
 *
 * Nothing here writes. `readEtaInputs` takes the caller's transaction, which
 * is `begin read only` in both scripts.
 */
import type { TransactionSql } from 'postgres';
import { zipCentroid } from '../src/lib/geo/zip-centroid';
import {
  destinationKey,
  firstCrossing,
  replayAt,
  routeFreshAt,
  stoppedMinutes,
  zipWhatIfEtaMs,
  type Replayed,
  type TrackFix,
} from '../src/lib/eta-marks';
import { ROUTE_PROVIDER, type CachedRoute } from '../src/lib/routing';
import { STATUS_DEFAULTS, haversineMiles } from '../src/lib/status';
import { DEMO_NOTE, DEMO_PREFIX } from '../src/server/demo-data';

/** The distances asked about. The log (§12.111) also keeps 400 and 10. */
export const SCORE_MARKS = [200, 100, 50, 25] as const;
/**
 * A fix is read by the board after the poll that carried it finishes, and the
 * worker routes inside that poll — so the route a dispatcher saw beside a fix
 * can be a few seconds younger than the fix itself.
 */
export const POLL_ALLOWANCE_MS = 60_000;
export const CONFIG = { avgSpeedMph: STATUS_DEFAULTS.avgSpeedMph, roadFactor: STATUS_DEFAULTS.roadFactor };

/* --------------------------------- inputs -------------------------------- */

export interface StopRow {
  stop_id: string;
  truck_id: string;
  truck_number: number | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number;
  lng: number;
  precision: 'street' | 'block' | 'zip' | null;
  arrived_at: Date | null;
  arrived_source: 'detected' | 'dispatcher' | null;
  load_created_at: Date;
}

export interface SampleRow {
  stop_id: string;
  measured_at: Date;
  straight_miles: number;
  routed_miles: number;
  lane_ratio: number;
  routed_duration_s: number;
  implied_mph: number | null;
  snap_from_m: number | null;
  snap_to_m: number | null;
  provider: string;
  dest_lat: number | null;
  dest_lng: number | null;
}

export interface PositionRow {
  truck_id: string;
  recorded_at: Date;
  lat: number;
  lng: number;
  speed_mph: number | null;
}

/** A settled `eta_marks` row (§12.112), as this script reads it. */
export interface LogRow {
  stop_id: string;
  dest_key: string;
  mark_miles: number;
  fix_recorded_at: Date;
  fix_lat: number;
  fix_lng: number;
  straight_miles: number;
  basis: string;
  eta_utc: Date;
  stopped_minutes: number | null;
  route_routed_miles: number | null;
  route_duration_s: number | null;
  route_straight_miles: number | null;
  route_lane_ratio: number | null;
  route_computed_at: Date | null;
}

export interface EtaInputs {
  stops: StopRow[];
  samples: SampleRow[];
  positions: PositionRow[];
  log: LogRow[];
  logPresent: boolean;
}

/**
 * Instants travel as epoch milliseconds. Drizzle's adapter replaces this
 * client's timestamp parsers with raw strings, so a `timestamptz` column comes
 * back as text and a `Date` parameter is refused; a float8 means the same
 * thing whatever the parsers are set to.
 */
export const epochMs = (tx: TransactionSql, column: string) =>
  tx.unsafe(`(extract(epoch from ${column}) * 1000)::float8`);
const toDate = (x: number | null) => (x === null ? null : new Date(x));

type Raw<T, K extends keyof T> = Omit<T, K> & { [P in K]: number | null };

export async function readEtaInputs(tx: TransactionSql): Promise<EtaInputs> {
  const ms = (column: string) => epochMs(tx, column);
  const stops = (
    await tx<Raw<StopRow, 'arrived_at' | 'load_created_at'>[]>`
    select s.id as stop_id, t.id as truck_id, t.truck_number, s.city, s.state, s.zip,
           s.lat, s.lng, s.geocode_precision as precision,
           ${ms('s.arrived_at')} as arrived_at, s.arrived_source,
           ${ms('l.created_at')} as load_created_at
    from stops s
    join loads l on l.id = s.load_id
    join trucks t on t.id = l.truck_id
    where s.lat is not null and s.lng is not null
      and (l.load_number is null
           or (l.load_number not like ${`${DEMO_PREFIX}%`} and l.load_number not like 'E2E-%'))
      and not exists (select 1 from stops d where d.load_id = l.id and d.dispatcher_note = ${DEMO_NOTE})
    order by s.arrived_at nulls last`
  ).map((r) => ({
    ...r,
    arrived_at: toDate(r.arrived_at),
    load_created_at: toDate(r.load_created_at)!,
  }));
  const ids = stops.map((s) => s.stop_id);
  const samples = (
    await tx<Raw<SampleRow, 'measured_at'>[]>`
    select stop_id, ${ms('measured_at')} as measured_at, straight_miles, routed_miles, lane_ratio,
           routed_duration_s, implied_mph, snap_from_m, snap_to_m, provider, dest_lat, dest_lng
    from route_samples
    where stop_id = any(${ids}) and provider = ${ROUTE_PROVIDER}
    order by stop_id, measured_at`
  ).map((r) => ({ ...r, measured_at: toDate(r.measured_at)! }));
  const windows = new Map<string, { from: Date; to: Date }>();
  for (const s of stops) {
    const to = s.arrived_at ?? new Date();
    const w = windows.get(s.truck_id);
    windows.set(s.truck_id, {
      from: w && w.from < s.load_created_at ? w.from : s.load_created_at,
      to: w && w.to > to ? w.to : to,
    });
  }
  const positions: PositionRow[] = [];
  for (const [truckId, w] of windows) {
    const rows = await tx<Raw<PositionRow, 'recorded_at'>[]>`
        select truck_id, ${ms('recorded_at')} as recorded_at, lat, lng, speed_mph from positions
        where truck_id = ${truckId}
          and recorded_at between ${w.from.toISOString()}::timestamptz and ${w.to.toISOString()}::timestamptz
        order by recorded_at`;
    positions.push(...rows.map((r) => ({ ...r, recorded_at: toDate(r.recorded_at)! })));
  }
  // The log exists once migration 0023 is applied; before that, there is none.
  const [regclass] = await tx<{ present: boolean }[]>`
    select to_regclass('public.eta_marks') is not null as present`;
  const present = regclass?.present === true;
  const log: LogRow[] = !present
    ? []
    : (
        await tx<
          Raw<LogRow, 'fix_recorded_at' | 'eta_utc' | 'route_computed_at'>[]
        >`
        select stop_id::text as stop_id, dest_key, mark_miles,
               ${ms('fix_recorded_at')} as fix_recorded_at, fix_lat, fix_lng, straight_miles,
               basis, ${ms('eta_utc')} as eta_utc, stopped_minutes,
               route_routed_miles, route_duration_s, route_straight_miles, route_lane_ratio,
               ${ms('route_computed_at')} as route_computed_at
        from eta_marks
        where settle_outcome = 'arrived' and mark_miles is not null`
      ).map((r) => ({
        ...r,
        fix_recorded_at: toDate(r.fix_recorded_at)!,
        eta_utc: toDate(r.eta_utc)!,
        route_computed_at: toDate(r.route_computed_at),
      }));
  return { stops, samples, positions, log, logPresent: present };
}

/* ------------------------------ merge tracks ----------------------------- */

/**
 * Tracks by truck number: the database's positions, then any saved copies,
 * sorted, one fix per instant.
 */
export function mergeTracks(
  stops: readonly StopRow[],
  positions: readonly PositionRow[],
  copies: readonly Map<number, TrackFix[]>[] = [],
): Map<number, TrackFix[]> {
  const truckNumberById = new Map(stops.map((s) => [s.truck_id, s.truck_number]));
  const tracks = new Map<number, TrackFix[]>();
  const addFixes = (truck: number, fixes: TrackFix[]) =>
    tracks.set(truck, [...(tracks.get(truck) ?? []), ...fixes]);
  for (const p of positions) {
    const truck = truckNumberById.get(p.truck_id);
    if (truck == null) continue;
    addFixes(truck, [
      { atMs: p.recorded_at.getTime(), lat: p.lat, lng: p.lng, speedMph: p.speed_mph },
    ]);
  }
  for (const copy of copies) for (const [truck, fixes] of copy) addFixes(truck, fixes);
  for (const [truck, fixes] of tracks) {
    const seen = new Set<number>();
    tracks.set(
      truck,
      fixes
        .sort((a, b) => a.atMs - b.atMs)
        .filter((f) => (seen.has(f.atMs) ? false : (seen.add(f.atMs), true))),
    );
  }
  return tracks;
}

export const trackBetween = (
  tracks: ReadonlyMap<number, TrackFix[]>,
  truck: number | null,
  fromMs: number,
  toMs: number,
) => (truck == null ? [] : tracks.get(truck) ?? []).filter((f) => f.atMs >= fromMs && f.atMs <= toMs);

/* --------------------------------- replay -------------------------------- */

const asRoute = (s: SampleRow, stop: StopRow): CachedRoute => ({
  provider: s.provider,
  routedMiles: s.routed_miles,
  routedDurationS: s.routed_duration_s,
  // Not stored on a sample, and not read by the projection or the freshness rule.
  fromLat: NaN,
  fromLng: NaN,
  straightAtRouteMiles: s.straight_miles,
  laneRatio: s.lane_ratio,
  stopLat: stop.lat,
  stopLng: stop.lng,
  snapFromM: s.snap_from_m,
  snapToM: s.snap_to_m,
  computedAtUtc: s.measured_at.toISOString(),
});

export const VARIANTS = ['shown', 'routed', 'lane-estimate', 'straight-line', 'here-raw', 'zip-what-if'] as const;
export type Variant = (typeof VARIANTS)[number];

export interface Scored {
  stop: StopRow;
  place: string;
  mark: number;
  source: 'log' | 'pos' | 'rec';
  atMiles: number;
  anchorMs: number;
  basisShown: string;
  /** Minutes stopped from the prediction to the arrival; null when unknown. */
  stopped: number | null;
  /** ETA instants by variant; null where the variant cannot be built. */
  eta: Record<Variant, number | null>;
}

export const placeOf = (s: StopRow) => `${s.city ?? '?'}, ${s.state ?? '?'}`;
const sameDest = (r: SampleRow, s: StopRow) => r.dest_lat === s.lat && r.dest_lng === s.lng;

function variantsFrom(
  replay: Replayed,
  anchorMs: number,
  zip: { straightStop: number; straightCentroid: number; ratio: number } | null,
): Record<Variant, number | null> {
  return {
    shown: replay.shown.etaMs,
    routed: replay.routed,
    'lane-estimate': replay.laneEstimate,
    'straight-line': replay.straightLine,
    'here-raw': replay.hereRaw,
    'zip-what-if': zip
      ? zipWhatIfEtaMs(replay.shown, anchorMs, zip.straightStop, zip.straightCentroid, zip.ratio)
      : null,
  };
}

export interface TripScores {
  arrivals: StopRow[];
  detected: StopRow[];
  /** Each stop's samples to its CURRENT point, in order. */
  samplesByStop: Map<string, SampleRow[]>;
  /** Samples measured to a point the stop no longer has. */
  repointed: number;
  scored: Scored[];
  unscorable: string[];
}

/**
 * Every detected arrival at every mark: the prediction the board made when
 * the truck first came inside that distance, from the log, then positions,
 * then the first recompute inside it.
 */
export function scoreTrips(input: {
  stops: readonly StopRow[];
  samples: readonly SampleRow[];
  log: readonly LogRow[];
  tracks: ReadonlyMap<number, TrackFix[]>;
  marks: readonly number[];
}): TripScores {
  const { stops, samples, log, tracks, marks } = input;
  const arrivals = stops.filter((s) => s.arrived_at !== null);
  const detected = arrivals.filter((s) => s.arrived_source === 'detected');
  const samplesByStop = new Map<string, SampleRow[]>();
  let repointed = 0;
  for (const r of samples) {
    const stop = stops.find((s) => s.stop_id === r.stop_id);
    if (!stop) continue;
    if (!sameDest(r, stop)) {
      repointed++;
      continue;
    }
    samplesByStop.set(r.stop_id, [...(samplesByStop.get(r.stop_id) ?? []), r]);
  }

  const scored: Scored[] = [];
  const unscorable: string[] = [];
  for (const stop of detected) {
    const arrivedMs = stop.arrived_at!.getTime();
    const own = (samplesByStop.get(stop.stop_id) ?? []).filter((r) => r.measured_at.getTime() <= arrivedMs);
    const track = trackBetween(tracks, stop.truck_number, stop.load_created_at.getTime(), arrivedMs);
    const centroid = zipCentroid(stop.zip);
    let any = false;
    for (const mark of marks) {
      const routeAt = (ms: number) => {
        const r = [...own].reverse().find((x) => x.measured_at.getTime() <= ms + POLL_ALLOWANCE_MS);
        return r ? asRoute(r, stop) : null;
      };
      /**
       * The log first: it is what the board actually said. Matched on the
       * stop's CURRENT point by the same key the worker wrote, so a stop edited
       * to a new destination cannot lend its predictions to this arrival.
       */
      const logged = log.find(
        (r) =>
          r.stop_id === stop.stop_id &&
          r.dest_key === destinationKey(stop.lat, stop.lng) &&
          r.mark_miles === mark,
      );
      if (logged) {
        const anchorMs = logged.fix_recorded_at.getTime();
        const route: CachedRoute | null =
          logged.route_routed_miles !== null &&
          logged.route_duration_s !== null &&
          logged.route_straight_miles !== null &&
          logged.route_lane_ratio !== null &&
          logged.route_computed_at !== null
            ? {
                provider: ROUTE_PROVIDER,
                routedMiles: logged.route_routed_miles,
                routedDurationS: logged.route_duration_s,
                fromLat: NaN,
                fromLng: NaN,
                straightAtRouteMiles: logged.route_straight_miles,
                laneRatio: logged.route_lane_ratio,
                stopLat: stop.lat,
                stopLng: stop.lng,
                snapFromM: null,
                snapToM: null,
                computedAtUtc: logged.route_computed_at.toISOString(),
              }
            : null;
        const replay = replayAt({
          anchorMs,
          straight: logged.straight_miles,
          route,
          fresh: logged.basis === 'routed',
          config: CONFIG,
        });
        const fix = { lat: logged.fix_lat, lng: logged.fix_lng };
        const eta = variantsFrom(
          replay,
          anchorMs,
          centroid
            ? {
                straightStop: logged.straight_miles,
                straightCentroid: haversineMiles(fix, centroid),
                ratio: route?.laneRatio ?? CONFIG.roadFactor,
              }
            : null,
        );
        // What the board said is the record, not the replay of it.
        eta.shown = logged.eta_utc.getTime();
        scored.push({
          stop,
          place: placeOf(stop),
          mark,
          source: 'log',
          atMiles: logged.straight_miles,
          anchorMs,
          basisShown: logged.basis,
          stopped: logged.stopped_minutes,
          eta,
        });
        any = true;
        continue;
      }
      const hit = firstCrossing(track, stop, mark);
      if (hit) {
        const anchorMs = hit.fix.atMs;
        const route = routeAt(anchorMs);
        const fresh = routeFreshAt(route, hit.fix, stop, new Date(anchorMs + POLL_ALLOWANCE_MS));
        const replay = replayAt({ anchorMs, straight: hit.straight, route, fresh, config: CONFIG });
        const stoppedTime = stoppedMinutes(track, anchorMs, arrivedMs);
        scored.push({
          stop,
          place: placeOf(stop),
          mark,
          source: 'pos',
          atMiles: hit.straight,
          anchorMs,
          basisShown: replay.shown.basis,
          stopped: stoppedTime.covered ? stoppedTime.minutes : null,
          eta: variantsFrom(
            replay,
            anchorMs,
            centroid
              ? {
                  straightStop: hit.straight,
                  straightCentroid: haversineMiles(hit.fix, centroid),
                  ratio: route?.laneRatio ?? CONFIG.roadFactor,
                }
              : null,
          ),
        });
        any = true;
        continue;
      }
      // No track across the mark: the recompute that fell inside it.
      const head = own[0];
      if (!head || head.straight_miles <= mark) continue;
      const r = own.find((x) => x.straight_miles <= mark);
      if (!r) continue;
      const anchorMs = r.measured_at.getTime();
      const replay = replayAt({
        anchorMs,
        straight: r.straight_miles,
        route: asRoute(r, stop),
        fresh: true,
        config: CONFIG,
      });
      const stoppedTime = stoppedMinutes(track, anchorMs, arrivedMs);
      scored.push({
        stop,
        place: placeOf(stop),
        mark,
        source: 'rec',
        atMiles: r.straight_miles,
        anchorMs,
        basisShown: replay.shown.basis,
        stopped: stoppedTime.covered ? stoppedTime.minutes : null,
        // No truck position, so no distance to the centroid: no ZIP what-if.
        eta: variantsFrom(replay, anchorMs, null),
      });
      any = true;
    }
    if (!any) {
      unscorable.push(
        `truck ${stop.truck_number} -> ${placeOf(stop)}: never observed beyond ${marks.at(-1)} mi while the stop existed`,
      );
    }
  }
  return { arrivals, detected, samplesByStop, repointed, scored, unscorable };
}

/* --------------------------------- error --------------------------------- */

const minutesBetween = (a: number, b: number) => (a - b) / 60_000;

/** Actual minus predicted, minutes; driving only subtracts the minutes stopped. */
export const errorOf = (s: Scored, v: Variant, drivingOnly: boolean): number | null => {
  const eta = s.eta[v];
  if (eta === null) return null;
  const actual = s.stop.arrived_at!.getTime();
  if (!drivingOnly) return minutesBetween(actual, eta);
  return s.stopped === null ? null : minutesBetween(actual, eta) - s.stopped;
};
