/**
 * A stop allowance, measured (phase 3au). `npm run eta:stops`
 *
 * REPORT ONLY. Nothing in the engine, the worker or the board reads it, and
 * nothing it prints is a decision. Learned from our own positions only — the
 * fixes the worker already stores — with no constant from any rule book: the
 * stopped rule is the scorer's, the bins are the data's quantiles, and the
 * allowance is whatever the windows say. See `eta-stops.mts` for the method.
 *
 * Read-only, like `eta:score`: every query runs inside one `begin read only`
 * transaction, and the first line printed is the database's own
 * `transaction_read_only`. The connection string is never printed.
 *
 * PRINTS COUNTS AND TRUCK NUMBERS ONLY. `eta:score` prints destinations; this
 * does not — no place, no city, no address, no driver. The concentration
 * figures ("12 pl, top-2 38%, eff 9.1") are counts of places, not names.
 *
 * Sign as in `eta:score`: actual minus predicted, minutes; + means the truck
 * arrived AFTER the ETA, the direction that hides LATE.
 */
import { config as loadEnv } from 'dotenv';
import { createDirectDb } from '../src/db/connection.ts';
import {
  MIN_STOP_MINUTES,
  ON_TIME_BAND_MINUTES,
  concentration,
  median,
  quantile,
  summarise,
  type TrackFix,
} from '../src/lib/eta-marks.ts';
import { POSITION_RETENTION_DAYS } from '../src/worker/ingest.ts';
import {
  KNOWN_STOP_RADIUS_MILES,
  STEP_MS,
  TAIL_MINUTES,
  atKnownStop,
  binOf,
  cleanTrack,
  fitAllowance,
  legsOf,
  quantileEdges,
  replayWithAllowance,
  sinceLongStop,
  tails,
  truckStops,
  windowTable,
  type Allowance,
  type Leg,
  type TruckStops,
  type WithAllowance,
} from './eta-stops.mjs';
import { SCORE_MARKS, epochMs, mergeTracks, readEtaInputs, scoreTrips } from './eta-trips.mjs';

loadEnv({ path: '.env.local' });

/** `eta:score`'s distances, and 400, which the prediction log also keeps. */
const MARKS = [400, ...SCORE_MARKS] as const;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/* --------------------------------- read ---------------------------------- */

const { client } = createDirectDb(process.env['DIRECT_URL']!);
const read = await client.begin('read only', async (tx) => {
  const [guard] = await tx<{ transaction_read_only: string }[]>`show transaction_read_only`;
  const inputs = await readEtaInputs(tx);
  const [window] = await tx<{ now_ms: number; cutoff_ms: number }[]>`
    select ${epochMs(tx, 'now()')} as now_ms,
           ${epochMs(tx, `now() - make_interval(days => ${POSITION_RETENTION_DAYS})`)} as cutoff_ms`;
  /**
   * The prune keeps each truck's newest fix "regardless of age", so a truck
   * silent for months has one fix from then; if it reports again before the
   * next prune, that fix and the new ones would make one interval of months.
   * Only fixes inside the retention window are read.
   */
  const all = await tx<{ truck_id: string; truck_number: number | null; at_ms: number; lat: number; lng: number; speed_mph: number | null }[]>`
    select p.truck_id, t.truck_number, ${epochMs(tx, 'p.recorded_at')} as at_ms, p.lat, p.lng, p.speed_mph
    from positions p join trucks t on t.id = p.truck_id
    where p.recorded_at >= now() - make_interval(days => ${POSITION_RETENTION_DAYS})
    order by p.truck_id, p.recorded_at`;
  return { guard: guard?.transaction_read_only ?? 'unknown', inputs, window: window!, all };
});
await client.end();

const { stops, samples, positions, log } = read.inputs;

/* ------------------------------ the trips -------------------------------- */

// The scorer's own tracks and rules, so these are exactly its rows.
const scoringTracks = mergeTracks(stops, positions);
const { detected, scored, unscorable } = scoreTrips({ stops, samples, log, tracks: scoringTracks, marks: MARKS });

/* ---------------------------- stop episodes ------------------------------ */

const fixesByTruck = new Map<string, TrackFix[]>();
const numberOf = new Map<string, number | null>();
for (const p of read.all) {
  numberOf.set(p.truck_id, p.truck_number);
  const list = fixesByTruck.get(p.truck_id) ?? [];
  list.push({ atMs: p.at_ms, lat: p.lat, lng: p.lng, speedMph: p.speed_mph });
  fixesByTruck.set(p.truck_id, list);
}
const points = [...new Map(stops.map((s) => [`${s.lat}:${s.lng}`, { lat: s.lat, lng: s.lng }])).values()];
const known = (e: { lat: number; lng: number }) => atKnownStop(e, points);

const byTruck = new Map<string, { fixes: number; t: TruckStops; legs: Leg[] }>();
for (const [truck, fixes] of fixesByTruck) {
  const clean = cleanTrack(fixes);
  if (clean.length < 2) continue;
  const t = truckStops(clean);
  byTruck.set(truck, { fixes: clean.length, t, legs: legsOf(t, known) });
}
const allEpisodes = [...byTruck.values()].flatMap((v) => v.t.episodes);
const complete = allEpisodes.filter((e) => !e.censoredStart && !e.censoredEnd);
const censored = allEpisodes.length - complete.length;
const completeKnown = complete.filter(known);
const completeElsewhere = complete.filter((e) => !known(e));
const drivingH = [...byTruck.values()].reduce((a, v) => a + v.t.drivingMs, 0) / HOUR_MS;
const stoppedH = complete.reduce((a, e) => a + e.minutes, 0) / 60;
const parked = [...byTruck.values()].reduce(
  (a, v) => ({ count: a.count + v.t.parkedGaps.count, minutes: a.minutes + v.t.parkedGaps.minutes }),
  { count: 0, minutes: 0 },
);
let fragments = 0;
for (const { t } of byTruck.values()) {
  for (let i = 1; i < t.episodes.length; i++) {
    if (t.episodes[i]!.drivingBeforeMs - t.episodes[i - 1]!.drivingBeforeMs < MIN_STOP_MINUTES * MINUTE_MS) {
      fragments++;
    }
  }
}

/* ---------------------------- the allowance ------------------------------ */

const remaining = scored
  .filter((s) => s.eta['here-raw'] !== null)
  .map((s) => s.eta['here-raw']! - s.anchorMs);
const gridPoints = Math.max(1, Math.ceil(Math.max(0, ...remaining) / STEP_MS));
const table = windowTable(new Map([...byTruck].map(([truck, v]) => [truck, v.legs])), gridPoints);
const fleet = fitAllowance(table, null);
/** Their pickups and deliveries are in no stop of ours, so every one of their stops counts as on the road. */
const noKnownStop = new Set([...byTruck].filter(([, v]) => !v.t.episodes.some(known)).map(([truck]) => truck));
const scoredTrucks = [...new Set(scored.map((s) => s.stop.truck_id))];
const folds = new Map<string, Allowance>(scoredTrucks.map((t) => [t, fitAllowance(table, t)]));
const replay = replayWithAllowance(scored, (t) => folds.get(t)!);

/* --------------------------------- print --------------------------------- */

const signed = (x: number | null, w = 6) =>
  x === null || Number.isNaN(x) ? '—'.padStart(w) : `${x > 0 ? '+' : ''}${Math.round(x)}`.padStart(w);
const plain = (x: number, w = 6) => (Number.isNaN(x) ? '—' : `${Math.round(x)}`).padStart(w);
const hours = (ms: number, w = 5) => (Number.isNaN(ms) ? '—' : (ms / HOUR_MS).toFixed(1)).padStart(w);
const pct = (x: number, w = 4) => (Number.isNaN(x) ? '—' : `${Math.round(x * 100)}%`).padStart(w);
const conc = (places: string[]) => {
  const c = concentration(places);
  return `${String(c.places).padStart(2)} pl, top-2 ${(c.top2 * 100).toFixed(0).padStart(3)}%, eff ${c.eff.toFixed(1).padStart(4)}`;
};
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const truckLabel = (id: string) => String(numberOf.get(id) ?? '?');
const spread = (xs: number[]) =>
  `p10 ${plain(quantile(xs, 0.1), 4)} / p25 ${plain(quantile(xs, 0.25), 4)} / median ${plain(median(xs), 4)} / ` +
  `p75 ${plain(quantile(xs, 0.75), 4)} / p90 ${plain(quantile(xs, 0.9), 4)} / max ${plain(Math.max(...xs), 5)}`;

console.log(`ETA stop allowance — descriptive, not a verdict. Read ${new Date().toISOString()}.`);
console.log(`transaction_read_only: ${read.guard}`);
console.log(
  `error = actual − predicted, minutes; + means the truck arrived AFTER the ETA (hides LATE). ` +
    `"within" is ±${ON_TIME_BAND_MINUTES} min. Counts and truck numbers only.`,
);

console.log('\n## 1. Stop episodes from positions\n');
console.log(
  `Stopped = the scorer's rule: reported speed ≤ 3 mph (and, across a gap, a displacement that agrees) ` +
    `for ${MIN_STOP_MINUTES}+ min. Shorter stationary runs are driving.`,
);
console.log(
  `Positions: ${read.all.length} fixes, ${byTruck.size} trucks with a track, ` +
    `${iso(read.all.reduce((a, p) => Math.min(a, p.at_ms), Infinity))} to ` +
    `${iso(read.all.reduce((a, p) => Math.max(a, p.at_ms), -Infinity))} UTC ` +
    `(read from ${iso(read.window.cutoff_ms)}, the ${POSITION_RETENTION_DAYS}-day retention).`,
);
console.log(
  `Known stop points: ${points.length} (every real stop with coordinates); a stop starting within ` +
    `${KNOWN_STOP_RADIUS_MILES} mi of one is AT a known stop.`,
);
console.log(
  `Stops: ${complete.length} complete on ` +
    `${[...byTruck.values()].filter((v) => v.t.episodes.some((e) => !e.censoredStart && !e.censoredEnd)).length} trucks; ` +
    `${censored} more cut by the window's ends (length unknown, not in the figures). ` +
    `Driving ${drivingH.toFixed(0)} h, stopped ${stoppedH.toFixed(0)} h (complete stops).`,
);
console.log(`\nStop minutes, complete stops:`);
console.log(`  all             n=${String(complete.length).padStart(4)}  ${spread(complete.map((e) => e.minutes))}`);
console.log(`  at a known stop n=${String(completeKnown.length).padStart(4)}  ${spread(completeKnown.map((e) => e.minutes))}`);
console.log(`  elsewhere       n=${String(completeElsewhere.length).padStart(4)}  ${spread(completeElsewhere.map((e) => e.minutes))}`);
const doubling: number[] = [];
for (let b = MIN_STOP_MINUTES; b <= Math.max(...complete.map((e) => e.minutes)); b *= 2) doubling.push(b);
console.log(`  doubling from ${MIN_STOP_MINUTES} min (the definition's floor, not a rule):`);
console.log(
  `    ${doubling
    .map((b, i) => {
      const hi = doubling[i + 1] ?? Infinity;
      return `${b}–${hi === Infinity ? '' : hi}: ${complete.filter((e) => e.minutes >= b && e.minutes < hi).length}`;
    })
    .join('   ')}`,
);
console.log(
  `\n${fragments} stops begin within ${MIN_STOP_MINUTES} min of driving after the previous one: ` +
    `often one park the rule reads as two, sometimes two stops close together. The rule is not changed here.`,
);
console.log(
  `${parked.count} gaps of ${MIN_STOP_MINUTES}+ min, ${(parked.minutes / 60).toFixed(1)} h in all, are counted as DRIVING ` +
    `by the rule although the displacement is under 3 mph: an end fix reads above 3 mph. Not reclassified.`,
);

console.log('\nPer truck:');
console.log('  truck   fixes  stops  at known  cut  driving h  stopped h  legs');
for (const [truck, v] of [...byTruck].sort((a, b) => (numberOf.get(a[0]) ?? 0) - (numberOf.get(b[0]) ?? 0))) {
  const c = v.t.episodes.filter((e) => !e.censoredStart && !e.censoredEnd);
  console.log(
    `  ${truckLabel(truck).padStart(5)} ${String(v.fixes).padStart(7)} ${String(c.length).padStart(6)} ` +
      `${String(c.filter(known).length).padStart(9)} ${String(v.t.episodes.length - c.length).padStart(4)} ` +
      `${hours(v.t.drivingMs, 10)} ${(c.reduce((a, e) => a + e.minutes, 0) / 60).toFixed(1).padStart(10)} ${String(v.legs.length).padStart(5)}`,
  );
}

const longMinutes = quantile(complete.map((e) => e.minutes), 0.75);
const relation = [...byTruck.values()].map((v) => sinceLongStop(v.t, longMinutes));
const pairs = relation.flatMap((r) => r.pairs);
const noPrior = relation.reduce((a, r) => a + r.noPriorLong, 0);
const edges = quantileEdges(pairs.map((p) => p.sinceMs), 4);
console.log('\nDriving since the last long stop, and the next stop:');
console.log(
  `  "long" = the upper quartile of complete stops: ${Math.round(longMinutes)}+ min. Bins = quartiles of the driving. ` +
    `${pairs.length} stops with a long stop before them on the same track; ${noPrior} with none seen (not binned).`,
);
console.log('  driving since (h)   n   next stop min: median   p75   p90   next is long   at a known stop');
for (let i = 0; i + 1 < edges.length; i++) {
  const inBin = pairs.filter((p) => binOf(edges, p.sinceMs) === i);
  const mins = inBin.map((p) => p.minutes);
  console.log(
    `  ${hours(edges[i]!, 5)} – ${hours(edges[i + 1]!, 5)}  ${String(inBin.length).padStart(5)}  ` +
      `${plain(median(mins), 20)} ${plain(quantile(mins, 0.75), 5)} ${plain(quantile(mins, 0.9), 5)}  ` +
      `${pct(mins.filter((m) => m >= longMinutes).length / mins.length, 13)}  ${String(inBin.filter((p) => known(p.episode)).length).padStart(15)}`,
  );
}

console.log('\n## 2. The stop allowance\n');
console.log(
  `Legs: each track cut at its stops AT a known stop and at the window's ends (${[...byTruck.values()].reduce((a, v) => a + v.legs.length, 0)} legs). ` +
    `A window starts every ${STEP_MS / MINUTE_MS} min of driving; for R of driving still to do it counts the minutes ` +
    `stopped before R is driven. The allowance is the median over all windows, made non-decreasing in R. ` +
    `R runs to ${hours(gridPoints * STEP_MS, 0).trim()} h, the longest HERE duration among the scored rows.`,
);
console.log(
  `Leave-one-truck-out: ${folds.size} fits, one per truck with a scored row; each leaves all of that truck's windows out.`,
);
console.log('\nAll trucks in (for reading; no trip is scored with this one), at each whole hour of R:');
console.log(
  `   R h  windows  trucks  allowance  median   mean   p75   p90  no stop  from the ${noKnownStop.size} trucks with no known stop   folds: allowance min–max`,
);
for (let g = 0; g < fleet.minutes.length; g++) {
  const rMs = (g + 1) * STEP_MS;
  if (rMs % HOUR_MS !== 0) continue;
  const foldValues = [...folds.values()].map((f) => f.minutes[g]).filter((m): m is number => m !== undefined);
  const fromNoKnown = [...noKnownStop].reduce((a, truck) => a + (table.get(truck)?.[g]?.length ?? 0), 0);
  console.log(
    `  ${hours(rMs, 4)} ${String(fleet.windows[g]).padStart(8)} ${String(fleet.trucks[g]).padStart(7)} ` +
      `${plain(fleet.minutes[g]!, 10)} ${plain(fleet.medians[g]!, 7)} ${plain(fleet.means[g]!, 6)} ` +
      `${plain(fleet.p75[g]!, 5)} ${plain(fleet.p90[g]!, 5)} ${pct(fleet.zeroShare[g]!, 8)} ` +
      `${pct(fromNoKnown / fleet.windows[g]!, 43)}   ` +
      `${foldValues.length ? `${plain(Math.min(...foldValues), 4)} – ${plain(Math.max(...foldValues), 4)}` : '—'}`,
  );
}
if (fleet.minutes.length < gridPoints) {
  console.log(`  (no window reaches past ${hours(fleet.minutes.length * STEP_MS, 0).trim()} h of driving)`);
}

console.log('\n## 3. Replay on the trips eta:score scores\n');
console.log(
  `${detected.length} detected arrivals; ${unscorable.length} never observed beyond ${MARKS.at(-1)} mi. Rows without HERE's ` +
    `duration: ${replay.noRoute}; rows whose fold has no data: ${replay.noFit}. The three ETAs are compared on the same rows.`,
);
console.log(
  `  current = what the board showed (52 mph cap, no stops). here-raw = HERE's duration, no cap. ` +
    `+ allowance = here-raw plus the allowance at HERE's remaining duration, fitted without the trip's truck.`,
);
console.log(
  `  "${TAIL_MINUTES}+ late" = the ETA was ${TAIL_MINUTES}+ min BEFORE the arrival (hides LATE); ` +
    `"${TAIL_MINUTES}+ early" = ${TAIL_MINUTES}+ min AFTER it (a LATE that is not).`,
);

function line(label: string, rows: WithAllowance[], pick: (r: WithAllowance) => number): string {
  const errors = rows.map(pick);
  const sum = summarise(errors);
  if (sum.n === 0) return `  ${label.padEnd(16)} n= 0`;
  const t = tails(errors);
  return (
    `  ${label.padEnd(16)} n=${String(sum.n).padStart(2)}  median ${signed(sum.medianSigned)}  ` +
    `med|e| ${plain(sum.medianAbs)}  worst10% ${plain(sum.p90Abs)}  ` +
    `late/within/early ${sum.late}/${sum.within}/${sum.early}   [${conc(rows.map((r) => r.row.place))}]   ` +
    `${TAIL_MINUTES}+ late ${t.late}/${sum.n}  ${TAIL_MINUTES}+ early ${t.early}/${sum.n}`
  );
}

for (const mark of MARKS) {
  const rows = replay.rows.filter((r) => r.row.mark === mark);
  const all = scored.filter((s) => s.mark === mark);
  const count = (source: string) => all.filter((r) => r.source === source).length;
  console.log(`\n${mark} mi  (${count('log')} log, ${count('pos')} pos, ${count('rec')} rec)`);
  if (rows.length === 0) {
    console.log('  no rows');
    continue;
  }
  const stoppedKnown = rows.filter((r) => r.row.stopped !== null);
  console.log(
    `  HERE's remaining driving: median ${hours(median(rows.map((r) => r.remainingMs))).trim()} h ` +
      `(${hours(Math.min(...rows.map((r) => r.remainingMs))).trim()}–${hours(Math.max(...rows.map((r) => r.remainingMs))).trim()}); ` +
      `allowance added: median ${plain(median(rows.map((r) => r.allowance)), 0)} min ` +
      `(${plain(Math.min(...rows.map((r) => r.allowance)), 0)}–${plain(Math.max(...rows.map((r) => r.allowance)), 0)}); ` +
      `past the curve's end: ${rows.filter((r) => r.beyond).length}`,
  );
  console.log(
    `  minutes actually stopped, where known (n=${stoppedKnown.length}): median ` +
      `${plain(median(stoppedKnown.map((r) => r.row.stopped!)), 0)}; stopped − allowance median ` +
      `${signed(median(stoppedKnown.map((r) => r.row.stopped! - r.allowance)), 0)}`,
  );
  console.log(line('current', rows, (r) => r.current));
  console.log(line('here-raw', rows, (r) => r.hereRaw));
  console.log(line('+ allowance', rows, (r) => r.withAllowance));
}

console.log('\nPer truck (each truck’s rows, all marks; allowance from the fit without it):');
console.log('  truck  rows  current median  here-raw median  + allowance median   60+ late now → with allowance');
for (const truck of [...new Set(replay.rows.map((r) => r.row.stop.truck_id))].sort(
  (a, b) => (numberOf.get(a) ?? 0) - (numberOf.get(b) ?? 0),
)) {
  const rows = replay.rows.filter((r) => r.row.stop.truck_id === truck);
  console.log(
    `  ${truckLabel(truck).padStart(5)} ${String(rows.length).padStart(5)} ${signed(median(rows.map((r) => r.current)), 15)} ` +
      `${signed(median(rows.map((r) => r.hereRaw)), 16)} ${signed(median(rows.map((r) => r.withAllowance)), 19)}   ` +
      `${String(tails(rows.map((r) => r.current)).late).padStart(12)} → ${tails(rows.map((r) => r.withAllowance)).late}`,
  );
}

const replayedStops = new Set(replay.rows.map((r) => r.row.stop.stop_id));
const replayedTrucks = new Set(replay.rows.map((r) => r.row.stop.truck_id));
const replayedPlaces = new Set(replay.rows.map((r) => r.row.place));
console.log(`
## 4. What this cannot support

- ${replayedStops.size} arrivals on ${replayedTrucks.size} trucks to ${replayedPlaces.size} destinations; n per distance is above.
  Medians on n < 30 describe these trips, not the fleet; worst-10% under n = 10 is the worst trip.
- The distances within one trip are not independent: one long stop counts at every distance before it.
- The fit sees one window of positions (${POSITION_RETENTION_DAYS} days, one weekend at most). A fit on another week could differ.
- The windows overlap (one every ${STEP_MS / MINUTE_MS} min of driving), so "windows" is not a count of independent drives.
- Leave-one-truck-out keeps a truck's own windows out of its fit, but not its lanes or customers: other trucks drive them
  too, and the fit's week overlaps the scored trips' own days.
- The allowance depends on remaining driving only. It cannot know whether this truck will stop for the night on this trip —
  the long stops that make the worst 10% — only how much trucks stop over that much driving, typically.
- The fit's R is a truck's driving time; the replay's R is HERE's duration, which runs short of the truck when it drives.
- A stop at a pickup or delivery that is not in our stops (another load, a yard) counts as a stop on the road. For the
  ${noKnownStop.size} trucks with no stop near any known point that is every one of theirs; their share of windows is in section 2.
- The stopped rule: ${parked.count} gaps (${(parked.minutes / 60).toFixed(1)} h) are driving to it although nothing moved, and ${fragments} stops
  begin within ${MIN_STOP_MINUTES} min of driving after another. Both are the scorer's rule as it stands, here and in eta:score.
- "Driving only" in eta:score needs positions; rows here use HERE's duration and need none, so n is eta:score's as-seen n.
`);
