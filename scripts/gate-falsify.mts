/**
 * STEP 0. Does a ratio-stability gate have any predictive power at all?
 *
 * The gate: at a recompute moment, SKIP if the lane's ratio has been stable,
 * i.e. |r(i-1) - r(i-2)| < eps. The decision uses only what was known before
 * the call, which is the whole point.
 *
 * The cost of skipping call i: the row keeps showing straight_i x r(i-1)
 * when the truth is straight_i x r_i, so the error is
 * straight_i x |r_i - r(i-1)|.
 *
 * FALSIFICATION: if the error among the moments the gate would skip looks
 * the same as among the moments it would not, the gate is predicting
 * nothing and no eps can save it. That comparison is the test; the skip
 * rate on its own is meaningless.
 *
 * Read-only. Touches no provider and writes nothing.
 */
import { config as loadEnv } from 'dotenv';
import { sql } from 'drizzle-orm';
import { createDirectDb } from '../src/db/connection.ts';
loadEnv({ path: '.env.local' });
const { client, db } = createDirectDb(process.env['DIRECT_URL']!);

const PROVIDER =
  process.argv.find((a) => a.startsWith('--provider='))?.split('=')[1] ??
  'here-routing-v8-truck';
/** The ETA engine's speed cap. 1 mile = 69 s at 52 mph. */
const CAP_MPH = 52;

interface S {
  lane: string; city: string | null; state: string | null;
  straight_miles: number; lane_ratio: number; measured_at: string;
}

const rows = (await db.execute(sql`
  select stop_id::text || '|' || dest_lat::text || '|' || dest_lng::text as lane,
         dest_city as city, dest_state as state,
         straight_miles, lane_ratio, measured_at
  from route_samples
  where provider = ${PROVIDER} and dest_lat is not null
  order by lane, measured_at`)) as unknown as S[];

const lanes = new Map<string, S[]>();
for (const r of rows) {
  if (!lanes.has(r.lane)) lanes.set(r.lane, []);
  lanes.get(r.lane)!.push(r);
}

/* ---------------------- density, for Step 1 feasibility ------------------ */

const counts = [...lanes.values()].map((l) => l.length);
const gaps: number[] = [];
for (const lane of lanes.values()) {
  for (let i = 1; i < lane.length; i++) {
    gaps.push(
      (new Date(lane[i]!.measured_at).getTime() -
        new Date(lane[i - 1]!.measured_at).getTime()) / 60_000,
    );
  }
}
const pct = (xs: number[], q: number) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};

console.log(`provider: ${PROVIDER}`);
console.log(`${rows.length} samples on ${lanes.size} lanes\n`);
console.log('SAMPLE DENSITY (what Step 1 would have to replay against)');
console.log(`  lanes with >=3 samples (a usable triple): ${counts.filter((c) => c >= 3).length} of ${lanes.size}`);
console.log(`  samples per lane   median ${pct(counts, 0.5)}   p90 ${pct(counts, 0.9)}   max ${Math.max(...counts)}`);
console.log(`  gap between samples on a lane   median ${pct(gaps, 0.5).toFixed(1)} min   p90 ${pct(gaps, 0.9).toFixed(1)} min`);
/**
 * Step 1's +/-3 min matching: a replay that skips a call needs a real
 * measurement at the moment it NEXT wants to route. The share of consecutive
 * gaps under 6 minutes is the optimistic bound on finding one; gaps far
 * larger than 6 minutes are where a replayed decision would find nothing and
 * have to be discarded.
 */
const within6 = gaps.filter((g) => g <= 6).length;
console.log(`  gaps <= 6 min (the +/-3 matching window): ${within6} of ${gaps.length} (${((within6 / Math.max(gaps.length, 1)) * 100).toFixed(0)}%)`);
console.log(`  => rough discard-fraction bound for Plan A: ${(100 - (within6 / Math.max(gaps.length, 1)) * 100).toFixed(0)}%\n`);

/* --------------------------- the falsification --------------------------- */

interface Triple {
  prevDelta: number;   // |r(i-1) - r(i-2)| -- what the gate SEES
  nextDelta: number;   // |r(i)   - r(i-1)| -- what it would COST
  straight: number;
  minutes: number;
  gapMin: number;
  label: string;
}
const triples: Triple[] = [];
for (const lane of lanes.values()) {
  for (let i = 2; i < lane.length; i++) {
    const a = lane[i - 2]!, b = lane[i - 1]!, c = lane[i]!;
    const gapMin =
      (new Date(c.measured_at).getTime() - new Date(b.measured_at).getTime()) / 60_000;
    if (gapMin <= 0) continue;
    const nextDelta = Math.abs(c.lane_ratio - b.lane_ratio);
    triples.push({
      prevDelta: Math.abs(b.lane_ratio - a.lane_ratio),
      nextDelta,
      straight: c.straight_miles,
      minutes: (nextDelta * c.straight_miles) / CAP_MPH * 60,
      gapMin,
      label: `${c.city ?? '?'}, ${c.state ?? '?'}`,
    });
  }
}

const report = (name: string, set: Triple[]) => {
  console.log(`\n${name}: ${set.length} recompute moments with a usable history`);
  if (set.length === 0) return;
  const all = set.map((t) => t.minutes);
  console.log(`  error if skipped, ALL moments   p50 ${pct(all, 0.5).toFixed(1)} min   p90 ${pct(all, 0.9).toFixed(1)} min   max ${Math.max(...all).toFixed(1)} min`);
  console.log('\n   eps   skip rate      SKIPPED p50/p90 min     KEPT p50/p90 min    separation');
  for (const eps of [0.005, 0.01, 0.02, 0.03, 0.05, 0.1]) {
    const skip = set.filter((t) => t.prevDelta < eps);
    const keep = set.filter((t) => t.prevDelta >= eps);
    if (skip.length === 0 || keep.length === 0) {
      console.log(`  ${eps.toFixed(3)}   ${((skip.length / set.length) * 100).toFixed(0).padStart(3)}%   (one side empty)`);
      continue;
    }
    const sp50 = pct(skip.map((t) => t.minutes), 0.5), sp90 = pct(skip.map((t) => t.minutes), 0.9);
    const kp50 = pct(keep.map((t) => t.minutes), 0.5), kp90 = pct(keep.map((t) => t.minutes), 0.9);
    const sep = kp50 > 0 ? sp50 / kp50 : NaN;
    console.log(
      `  ${eps.toFixed(3)}   ${((skip.length / set.length) * 100).toFixed(0).padStart(3)}% (${String(skip.length).padStart(3)})` +
      `   ${sp50.toFixed(1).padStart(6)} / ${sp90.toFixed(1).padStart(6)}` +
      `        ${kp50.toFixed(1).padStart(6)} / ${kp90.toFixed(1).padStart(6)}` +
      `      ${Number.isFinite(sep) ? `${sep.toFixed(2)}x` : '—'}`,
    );
  }
};

report('ALL recompute moments', triples);
/**
 * Only `truck-moved` is gateable. route_samples does not record the reason,
 * so this is the closest honest proxy: the truck got closer and the gap is
 * not a restart-sized hole.
 */
report(
  'PLAUSIBLY truck-moved (closing, gap <= 45 min)',
  triples.filter((t) => t.gapMin <= 45),
);
report(
  'the endgame: under 25 miles remaining',
  triples.filter((t) => t.straight < 25),
);
report(
  'beyond 25 miles remaining',
  triples.filter((t) => t.straight >= 25),
);

console.log('\nseparation = SKIPPED p50 / KEPT p50. At 1.0 the gate predicts nothing:');
console.log('the moments it would skip are exactly as costly as the ones it keeps.');
await client.end();
