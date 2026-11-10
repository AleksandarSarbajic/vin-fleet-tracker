/**
 * ETA accuracy, measured. `npm run eta:score [-- --positions <file.csv> ...]`
 *
 * Read-only (§12.111): every query runs inside one `begin read only`
 * transaction, which the database refuses to write in. It writes nothing,
 * anywhere, and changes nothing in the engine — it re-asks
 * the engine's own `projectDistance` what it would have said and holds that
 * against what happened.
 *
 * DESCRIPTIVE, NOT A VERDICT. There is no stopping rule and no threshold
 * here, on purpose: at the volume this fleet runs, a handful of arrivals from
 * three or four places can produce any shape, and a figure printed as a
 * conclusion becomes one. Every figure carries its n and where it came from
 * (places, top-2 share, eff — the `shadow:analyse` measure), and the last
 * section says what the numbers cannot support.
 *
 * ## Where a prediction comes from
 *
 *   `log` — the prediction log (§12.112): what the board said, recorded when
 *           the truck crossed the distance, settled with the minutes stopped.
 *           Preferred wherever it exists.
 *   `pos` — positions. The first fix inside the mark, the route the board held
 *           once that fix's poll finished, the board's own freshness rule.
 *           Exact, but positions are kept seven days, so only recent trips.
 *   `rec` — recompute. The first `route_samples` row inside the mark: the
 *           board at the moment it re-routed, which is always `routed`. The
 *           mark lands where the recompute fell (3–30 mi under it), and the
 *           anchor is the routing instant rather than the fix.
 *
 * `--positions` adds saved copies (columns `truck_number, recorded_at, lat,
 * lng, speed_mph`) to whatever the database still holds.
 *
 * ## Sign
 *
 * Error is ACTUAL minus PREDICTED, in minutes. Positive: the truck arrived
 * after the ETA — the board was optimistic, which is the direction that hides
 * LATE. "Driving only" subtracts the stationary episodes of 10 minutes or more
 * between the prediction and the arrival; it needs positions for the whole
 * stretch and is left blank without them.
 */
import { readFileSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
import { createDirectDb } from '../src/db/connection.ts';
import {
  MIN_STOP_MINUTES,
  ON_TIME_BAND_MINUTES,
  concentration,
  median,
  quantile,
  stoppedMinutes,
  summarise,
  type TrackFix,
} from '../src/lib/eta-marks.ts';
import { haversineMiles } from '../src/lib/status.ts';
import {
  MIN_GAIN_MINUTES,
  candidateErrors,
  fitConstant,
  judge,
  lateAtMarks,
  type LateCell,
} from './eta-candidates.mjs';
import {
  CANDIDATE_CEILING_MPH,
  CONFIG,
  SCORE_MARKS,
  VARIANTS,
  errorOf,
  mergeTracks,
  placeOf,
  readEtaInputs,
  scoreTrips,
  trackBetween as between,
  type Scored,
  type Variant,
} from './eta-trips.mjs';

loadEnv({ path: '.env.local' });

/** For the 52 mph test, a stop this long disqualifies a segment. */
const SEGMENT_STOP_MINUTES = 5;

/* --------------------------------- inputs -------------------------------- */

function positionFiles(): string[] {
  const files: string[] = [];
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--positions' && args[i + 1]) files.push(args[++i]!);
  }
  return files;
}

/** A saved copy, keyed by truck number. Header names, not positions, decide. */
function readPositionCsv(path: string): Map<number, TrackFix[]> {
  const [header, ...lines] = readFileSync(path, 'utf8').trim().split('\n');
  const cols = (header ?? '').split(',');
  const at = (name: string) => {
    const i = cols.indexOf(name);
    if (i < 0) throw new Error(`${path}: no "${name}" column`);
    return i;
  };
  const [iTruck, iAt, iLat, iLng, iSpeed] = [
    at('truck_number'),
    at('recorded_at'),
    at('lat'),
    at('lng'),
    at('speed_mph'),
  ];
  const out = new Map<number, TrackFix[]>();
  for (const line of lines) {
    const f = line.split(',');
    const truck = Number(f[iTruck]);
    const fix: TrackFix = {
      atMs: Date.parse((f[iAt] ?? '').replace(/\+00$/, 'Z')),
      lat: Number(f[iLat]),
      lng: Number(f[iLng]),
      speedMph: f[iSpeed] === '' || f[iSpeed] === undefined ? null : Number(f[iSpeed]),
    };
    if (!Number.isFinite(fix.atMs) || !Number.isFinite(fix.lat)) {
      throw new Error(`${path}: unreadable row "${line.slice(0, 40)}…"`);
    }
    out.set(truck, [...(out.get(truck) ?? []), fix]);
  }
  return out;
}

const { client } = createDirectDb(process.env['DIRECT_URL']!);
// Read and selection live in `eta-trips.mts`, shared with `eta:stops` (phase 3au).
const { stops, samples, positions, log, logPresent } = await client.begin('read only', readEtaInputs);
await client.end();

const files = positionFiles();
const tracks = mergeTracks(stops, positions, files.map(readPositionCsv));
const trackBetween = (truck: number | null, fromMs: number, toMs: number) =>
  between(tracks, truck, fromMs, toMs);
const { arrivals, detected, samplesByStop, repointed, scored, unscorable } = scoreTrips({
  stops,
  samples,
  log,
  tracks,
  marks: SCORE_MARKS,
});

/* --------------------------------- print --------------------------------- */

const signed = (x: number | null, w = 6) =>
  x === null || Number.isNaN(x) ? '—'.padStart(w) : `${x > 0 ? '+' : ''}${Math.round(x)}`.padStart(w);
const plain = (x: number, w = 6) => (Number.isNaN(x) ? '—' : `${Math.round(x)}`).padStart(w);
const conc = (places: string[]) => {
  const c = concentration(places);
  return `${String(c.places).padStart(2)} pl, top-2 ${(c.top2 * 100).toFixed(0).padStart(3)}%, eff ${c.eff.toFixed(1).padStart(4)}`;
};
const fmtUtc = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

console.log(`ETA accuracy — descriptive, not a verdict. Read ${new Date().toISOString()}.`);
console.log(
  `error = actual − predicted, minutes; + means the truck arrived AFTER the ETA. ` +
    `"within" is ±${ON_TIME_BAND_MINUTES} min. Driving only removes stops of ${MIN_STOP_MINUTES}+ min.`,
);
console.log(
  `\nReal stops with coordinates: ${stops.length}. Arrived: ${arrivals.length} ` +
    `(${detected.length} detected, ${arrivals.length - detected.length} marked by hand — a typed time, not scored).`,
);
const precisionCount = (p: string | null) => stops.filter((s) => s.precision === p).length;
console.log(
  `Precision of all real stops: street ${precisionCount('street')}, block ${precisionCount('block')}, zip ${precisionCount('zip')}. ` +
    `Only street stops can be detected as arrived (§12.30).`,
);
console.log(
  `route_samples used: ${samples.length - repointed}; ${repointed} skipped (measured to a point the stop no longer has).`,
);
console.log(
  logPresent
    ? `Prediction log: ${log.length} settled rows with an arrival.`
    : 'Prediction log: not present (migration 0023 not applied).',
);
console.log(
  `Position files: ${files.length ? files.join(', ') : 'none'}. Trucks with any track: ${[...tracks.values()].filter((t) => t.length).length}.`,
);
if (unscorable.length) console.log(`Not scorable:\n  ${unscorable.join('\n  ')}`);

console.log('\n## Per arrival (shown = what the board said; here-raw = HERE duration, no 52 mph cap)\n');
console.log(
  'truck  destination              arrived (UTC)      mark src   at mi  basis          stopped  shown:seen  drive | here-raw:seen  drive',
);
for (const s of scored.sort(
  (a, b) => a.stop.arrived_at!.getTime() - b.stop.arrived_at!.getTime() || b.mark - a.mark,
)) {
  console.log(
    `${String(s.stop.truck_number).padStart(5)}  ${s.place.padEnd(24)} ${fmtUtc(s.stop.arrived_at!.getTime())}  ` +
      `${String(s.mark).padStart(4)} ${s.source}  ${s.atMiles.toFixed(0).padStart(5)}  ${s.basisShown.padEnd(14)} ` +
      `${s.stopped === null ? '      —' : plain(s.stopped, 7)}  ${signed(errorOf(s, 'shown', false), 10)} ${signed(errorOf(s, 'shown', true), 6)} | ` +
      `${signed(errorOf(s, 'here-raw', false), 13)} ${signed(errorOf(s, 'here-raw', true), 6)}`,
  );
}

function summaryLine(label: string, rows: Scored[], v: Variant, drivingOnly: boolean): string {
  const pairs = rows
    .map((s) => ({ s, e: errorOf(s, v, drivingOnly) }))
    .filter((p): p is { s: Scored; e: number } => p.e !== null);
  const sum = summarise(pairs.map((p) => p.e));
  if (sum.n === 0) return `  ${label.padEnd(16)} n= 0`;
  return (
    `  ${label.padEnd(16)} n=${String(sum.n).padStart(2)}  median ${signed(sum.medianSigned)}  ` +
    `med|e| ${plain(sum.medianAbs)}  worst10% ${plain(sum.p90Abs)}  ` +
    `late/within/early ${sum.late}/${sum.within}/${sum.early}   [${conc(pairs.map((p) => p.s.place))}]`
  );
}

console.log('\n## By distance — one observation per arrival per distance\n');
console.log('worst10% is the 90th percentile of |error|; under ten observations it is the maximum.');
console.log(
  `capped and route-speed (§12.150) are replays at the basis the board had: the route's speed capped at ` +
    `${CONFIG.avgSpeedMph} mph, and the route's own speed under ${CANDIDATE_CEILING_MPH} mph. ` +
    `On log rows "shown" is the record, so it is whichever of the two the worker ran at the time.`,
);
for (const mark of SCORE_MARKS) {
  const rows = scored.filter((s) => s.mark === mark);
  const count = (source: Scored['source']) => rows.filter((r) => r.source === source).length;
  const src = `${count('log')} log, ${count('pos')} pos, ${count('rec')} rec`;
  console.log(`\n${mark} mi  (${src})`);
  for (const mode of [false, true]) {
    console.log(mode ? ' driving only' : ' as the dispatcher saw it');
    for (const v of VARIANTS) {
      if (v === 'zip-what-if') continue;
      console.log(summaryLine(v, rows, v, mode));
    }
  }
}

console.log('\n## By basis shown — what the board was actually displaying at the mark\n');
for (const basis of ['routed', 'lane-estimate', 'straight-line']) {
  const rows = scored.filter((s) => s.basisShown === basis);
  console.log(summaryLine(`${basis} (all marks)`, rows, 'shown', false));
}
console.log(
  '  (All marks pooled, so one arrival can appear up to four times; the replayed rows above are the comparison.)',
);

/* ----------------------- §12.150: the two candidates --------------------- */

const one = (x: number, w = 6) => (Number.isNaN(x) ? '—' : `${x > 0 ? '+' : ''}${x.toFixed(1)}`).padStart(w);
const abs1 = (x: number, w = 6) => (Number.isNaN(x) ? '—' : x.toFixed(1)).padStart(w);

console.log('\n## Route speed, with and without an arrival constant (§12.150)\n');
console.log(
  `A = route-speed. B = A plus one fixed number of minutes on every routed or lane-estimate ETA, fitted as the ` +
    `median driving-only error of A, in whole minutes, WITHOUT the row's own truck.`,
);
console.log(
  `The rule, set before these numbers were seen: B only if, driving only, it beats A on med|e| by ${MIN_GAIN_MINUTES}+ min ` +
    `at EVERY distance and raises worst10% at none. Otherwise A.`,
);
const fit = fitConstant(scored);
const folds = [...fit.without.values()].filter((c): c is number => c !== null);
console.log(
  `Constant: ${fit.all === null ? '—' : `${fit.all > 0 ? '+' : ''}${fit.all}`} min from all trucks (${fit.rows} rows, for reading); ` +
    `leave-one-truck-out ${folds.length ? `${Math.min(...folds)} to ${Math.max(...folds)}` : '—'} min over ${fit.without.size} trucks.`,
);
const candidateLine = (label: string, errors: readonly number[]) => {
  const sum = summarise(errors);
  if (sum.n === 0) return `  ${label.padEnd(4)} n= 0`;
  return (
    `  ${label.padEnd(4)} n=${String(sum.n).padStart(2)}  median ${one(sum.medianSigned)}  med|e| ${abs1(sum.medianAbs)}  ` +
    `worst10% ${abs1(sum.p90Abs, 7)}  late/within/early ${sum.late}/${sum.within}/${sum.early}`
  );
};
const drivingByMark: { mark: number; a: number[]; b: number[] }[] = [];
for (const mark of SCORE_MARKS) {
  const rows = scored.filter((s) => s.mark === mark);
  console.log(`\n${mark} mi`);
  for (const mode of [false, true]) {
    const e = candidateErrors(rows, fit, mode);
    console.log(
      `${mode ? ' driving only' : ' as the dispatcher saw it'}${e.noFit ? ` (${e.noFit} rows with no other truck to fit from, in neither)` : ''}`,
    );
    console.log(candidateLine('A', e.a));
    console.log(candidateLine('B', e.b));
    if (mode) drivingByMark.push({ mark, a: e.a, b: e.b });
  }
}
const verdict = judge(drivingByMark);
console.log('\nThe rule, driving only:');
for (const m of verdict.marks) {
  console.log(
    `  ${String(m.mark).padStart(3)} mi  med|e| A ${abs1(m.a.medianAbs)}  B ${abs1(m.b.medianAbs)}  gain ${one(m.gain)} ` +
      `(${m.gainEnough ? `${MIN_GAIN_MINUTES}+: yes` : `${MIN_GAIN_MINUTES}+: NO`})   ` +
      `worst10% A ${abs1(m.a.p90Abs)}  B ${abs1(m.b.p90Abs)} (${m.worstRaised ? 'RAISED' : 'not raised'})`,
  );
}
console.log(`  By the rule: ${verdict.shipB ? 'B' : 'A'}.`);

/* -------------------------- §12.150: LATE at the mark -------------------- */

console.log('\n## LATE at the mark — capped vs route speed (§12.150)\n');
console.log(
  `Would the LATE rule have fired when the truck crossed the distance: the ETA after the deadline. Log rows only, ` +
    `with the deadline the log stored at the mark. "Actually late" = the detected arrival was after that deadline.`,
);
console.log(
  `Not replayed: whether the row was showing LATE. An override, a truck with no driver and a stale position all ` +
    `outrank it, none is stored at the mark, and none depends on the ETA, so they are the same under both.`,
);
const lateCell = (c: LateCell) =>
  `n=${String(c.n).padStart(2)}  capped ${String(c.before).padStart(2)}  route-speed ${String(c.after).padStart(2)}  ` +
  `(lost ${c.lost}, gained ${c.gained})`;
for (const m of lateAtMarks(scored, SCORE_MARKS)) {
  console.log(
    `  ${String(m.mark).padStart(3)} mi  actually late ${lateCell(m.actuallyLate)}   |   on time ${lateCell(m.onTime)}   |   ` +
      `deadline already past at the mark: ${m.pastAtMark}; no deadline stored at the mark, cannot be replayed: ${m.notReplayable}`,
  );
}
// The replay is only as good as its agreement with what the worker wrote.
const logRows = scored.filter((s) => s.source === 'log');
const agrees = (s: Scored, v: Variant) => Math.abs(s.eta[v]! - s.eta.shown!) <= 1000;
const asCapped = logRows.filter((s) => agrees(s, 'capped')).length;
const asRouteSpeed = logRows.filter((s) => !agrees(s, 'capped') && agrees(s, 'route-speed')).length;
console.log(
  `  Check: of ${logRows.length} log rows, the recorded ETA is the capped replay to the second in ${asCapped}, ` +
    `the route-speed replay in ${asRouteSpeed}, neither in ${logRows.length - asCapped - asRouteSpeed}.`,
);

console.log('\n## By precision\n');
console.log('  street (measured): every scored arrival — see above.');
console.log('  block: no real stop has ever had block precision. Nothing to score.');
for (const mark of SCORE_MARKS) {
  const rows = scored.filter((s) => s.mark === mark && s.eta['zip-what-if'] !== null);
  console.log(summaryLine(`zip what-if ${mark}`, rows, 'zip-what-if', false));
  console.log(summaryLine(`  same, street`, rows, 'shown', false));
}
console.log(
  '  The what-if moves the stop to its ZIP centre and nothing else; it needs the truck position, so `pos` rows only.\n' +
    '  Real ZIP stops have no arrival time at all (detection is street-only, none marked by hand), so they cannot be scored directly.',
);

console.log('\n## By destination — median error as seen, shown basis\n');
const placesSeen = [...new Set(scored.map((s) => s.place))].sort();
console.log(`  ${'destination'.padEnd(24)} arrivals ${SCORE_MARKS.map((m) => `${m} mi`.padStart(8)).join('')}`);
for (const place of placesSeen) {
  const rows = scored.filter((s) => s.place === place);
  const n = new Set(rows.map((r) => r.stop.stop_id)).size;
  const cells = SCORE_MARKS.map((m) => {
    const es = rows
      .filter((r) => r.mark === m)
      .map((r) => errorOf(r, 'shown', false))
      .filter((e): e is number => e !== null);
    return signed(es.length ? median(es) : null, 8);
  });
  console.log(`  ${place.padEnd(24)} ${String(n).padStart(8)} ${cells.join('')}`);
}

/* ---------------------------- the 52 mph test ---------------------------- */

interface Segment {
  place: string;
  truck: number | null;
  stopId: string;
  miles: number;
  hours: number;
  hereMph: number | null;
  /** Miles along the fixes themselves — independent of either route. Null without cover. */
  gpsMiles: number | null;
  verdict: 'no-stop' | 'stopped' | 'unverified';
}

/** Path length along a track: a check on routed(i) − routed(i+1) that no route touches. */
const pathMiles = (track: readonly TrackFix[]) =>
  track.slice(1).reduce((acc, f, i) => acc + haversineMiles(track[i]!, f), 0);

const segments: Segment[] = [];
for (const stop of stops) {
  const own = samplesByStop.get(stop.stop_id) ?? [];
  const endMs = stop.arrived_at?.getTime() ?? Infinity;
  for (let i = 1; i < own.length; i++) {
    const a = own[i - 1]!;
    const b = own[i]!;
    if (b.measured_at.getTime() > endMs) break;
    const miles = a.routed_miles - b.routed_miles;
    const ms = b.measured_at.getTime() - a.measured_at.getTime();
    // Under 5 mi or 5 min the routing instants dominate; over 12 h it is a stale re-route.
    if (miles < 5 || ms < 5 * 60_000 || ms > 12 * 3_600_000) continue;
    const track = trackBetween(stop.truck_number, a.measured_at.getTime(), b.measured_at.getTime());
    const stopped = stoppedMinutes(track, a.measured_at.getTime(), b.measured_at.getTime(), SEGMENT_STOP_MINUTES);
    segments.push({
      place: placeOf(stop),
      truck: stop.truck_number,
      stopId: stop.stop_id,
      miles,
      hours: ms / 3_600_000,
      hereMph: a.implied_mph,
      gpsMiles: stopped.covered ? pathMiles(track) : null,
      verdict: !stopped.covered ? 'unverified' : stopped.minutes > 0 ? 'stopped' : 'no-stop',
    });
  }
}

function speedReport(label: string, set: Segment[]): void {
  console.log(`\n${label}: ${set.length} segments, ${new Set(set.map((s) => s.stopId)).size} trips, trucks ${new Set(set.map((s) => s.truck)).size}   [${conc(set.map((s) => s.place))}]`);
  if (set.length === 0) return;
  const mph = set.map((s) => s.miles / s.hours);
  const vsHere = set.filter((s) => s.hereMph !== null).map((s) => s.miles / s.hours - s.hereMph!);
  const capCost = set.map((s) => (100 / CONFIG.avgSpeedMph - 100 / (s.miles / s.hours)) * 60);
  const gps = set.filter((s) => s.gpsMiles !== null);
  const gpsMph = gps.map((s) => s.gpsMiles! / s.hours);
  console.log(
    `  actual mph   p10 ${plain(quantile(mph, 0.1), 4)}  median ${plain(median(mph), 4)}  p90 ${plain(quantile(mph, 0.9), 4)}   ` +
      `faster than ${CONFIG.avgSpeedMph}: ${mph.filter((m) => m > CONFIG.avgSpeedMph).length} of ${mph.length}`,
  );
  console.log(
    `  actual − ${CONFIG.avgSpeedMph} mph       median ${signed(median(mph.map((m) => m - CONFIG.avgSpeedMph)), 4)}   ` +
      `actual − HERE raw   median ${signed(median(vsHere), 4)} (n=${vsHere.length})`,
  );
  if (gps.length) {
    console.log(
      `  check: GPS path mph  median ${plain(median(gpsMph), 4)}  (n=${gps.length}); ` +
        `route-based − GPS  median ${signed(median(gps.map((s) => (s.miles - s.gpsMiles!) / s.hours)), 4)} mph`,
    );
  }
  console.log(
    `  the cap's cost, min per 100 road mi (+ = ETA later than the truck)   median ${signed(median(capCost), 4)}  p10 ${signed(quantile(capCost, 0.1), 4)}  p90 ${signed(quantile(capCost, 0.9), 4)}`,
  );
}

console.log('\n## The 52 mph test — speed covered between consecutive recomputes\n');
console.log(
  `Road miles covered = routed(i) − routed(i+1) on the same lane; time = the routing instants. ` +
    `"No stop" means positions cover the segment and show no stationary episode of ${SEGMENT_STOP_MINUTES}+ min.`,
);
speedReport('No stop (verified by positions)', segments.filter((s) => s.verdict === 'no-stop'));
speedReport('Contains a stop (excluded)', segments.filter((s) => s.verdict === 'stopped'));
speedReport('Unverified — no positions; may hide stops, so a LOWER bound on driving speed', segments.filter((s) => s.verdict === 'unverified'));

console.log(`
## What this cannot support

- ${detected.length} detected arrivals, all street precision, from ${new Set(detected.map(placeOf)).size} destinations. Medians on n < 30 are
  descriptions of these trips, not of the fleet; worst-10% under n = 10 is simply the worst trip.
- The four distances within one trip are not independent: a long stop counts at every distance before it.
- \`rec\` rows are anchored at the routing instant and land 3–30 mi under the mark; \`pos\` rows are exact.
- Driving-only needs positions for the whole stretch; only trips inside the 7-day window (or a saved copy) have them.
- "Stopped" is reported speed ≤ 3 mph for ${MIN_STOP_MINUTES}+ min. A crawl in traffic counts as driving.
- The basis rows other than "shown" are replays: what that basis WOULD have said from the same inputs, not what anyone saw.
- No ZIP stop has an arrival time, so the ZIP figures are what-ifs on street trips. No block stop exists.
- Segment speeds assume consecutive routes share a path; a re-route onto a different road reads as a speed change.
`);
