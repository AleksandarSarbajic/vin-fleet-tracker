/**
 * The §12.61 shadow run's verdict. `npm run shadow:analyse`
 *
 * The run is CLOSED (§12.73): it concluded on 2026-09-25, the gate is not
 * built, and `route_shadow` refuses new rows. This stays because the 412 rows
 * do — it re-reads the evidence the verdict rests on, and reads nothing else.
 *
 * Read-only. Sweeps eps over the truck-profile observations and asks, for
 * each, the only two questions that matter:
 *
 *   1. Are the recomputes the gate would SKIP cheaper than the ones it keeps?
 *      That is `separation` — SKIPPED p50 over KEPT p50. At 1.0 the gate is
 *      predicting nothing.
 *   2. Is that gap bigger than chance? A permutation test shuffles the
 *      labels 20,000 times and counts how often chance alone does as well.
 *
 * Question 2 exists because question 1 alone produced the wrong answer once
 * already. The Mapbox cohort showed 0.34x separation at eps=0.01 and that
 * became a recommendation; on truck data the same threshold gives 0.84x with
 * p=0.225, which is noise wearing the shape of a result. A separation figure
 * without a significance test beside it should not be believed, including
 * when it is flattering.
 *
 * Effect size is printed beside p for the same reason: a gap can be real and
 * still too small to act on. 0.77 minutes against a typical skip cost of 4.3
 * is not a reason to stop making a quarter of the recomputes.
 */
import { config as loadEnv } from 'dotenv';
import { sql } from 'drizzle-orm';
import { createDirectDb } from '../src/db/connection.ts';

loadEnv({ path: '.env.local' });
const { client, db } = createDirectDb(process.env['DIRECT_URL']!);

/** The ETA engine's speed cap: 1 mile is 69 seconds. */
const CAP_MPH = 52;
/** The distance §12.61 calls the approach, where drift was said to live. */
const APPROACH_MILES = 25;
const EPSILONS = [0.005, 0.01, 0.02, 0.03, 0.05, 0.1] as const;
const SHUFFLES = 20_000;

interface Row {
  stability: number;
  errorMiles: number;
  straight: number;
  city: string | null;
  /** Destination place, the unit of independence. See `lanes()`. */
  lane: string;
}

const rows = (await db.execute(sql`
  select abs(ratio_cached - ratio_prev) as stability,
         error_miles                   as "errorMiles",
         straight_miles                as straight,
         dest_city                     as city,
         coalesce(dest_city || ', ' || dest_state,
                  round(dest_lat::numeric, 2) || ',' || round(dest_lng::numeric, 2)) as lane
  from route_shadow
  -- Only truck-moved is gateable: the other reasons mean the cached row is
  -- about somewhere else, not merely older. A warmed lane only.
  where ratio_prev is not null and reason = 'truck-moved'
  order by observed_at`)) as unknown as Row[];

const minutes = (r: Row) => (r.errorMiles / CAP_MPH) * 60;
const pct = (xs: number[], q: number) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** How often chance alone splits the costs at least this favourably. */
function pOfChance(costs: number[], nSkip: number, observedGap: number): number {
  let atLeastAsExtreme = 0;
  for (let t = 0; t < SHUFFLES; t++) {
    const pool = [...costs];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    if (median(pool.slice(0, nSkip)) - median(pool.slice(nSkip)) <= observedGap) {
      atLeastAsExtreme += 1;
    }
  }
  return atLeastAsExtreme / SHUFFLES;
}

/**
 * How independent the observations are, printed beside every p it qualifies.
 *
 * The permutation test assumes exchangeable observations. They are not: rows
 * on one destination share its road network, its approach geometry and often
 * the same truck minutes apart. At 30 approach observations on 2026-09-24,
 * 22 came from Joliet and Minooka — two stops beside the yard the fleet
 * circulates around — so "30 observations" was nearer four places' worth.
 * A p over that set is optimistic by an amount the shuffle cannot see.
 *
 * The unit is the destination PLACE (city, state), not the stop: two stops in
 * Joliet are one approach geometry. That is the coarser grouping, so it errs
 * toward showing LESS independence, which is the safe direction.
 *
 *   top-2   share of the rows the two biggest places supply
 *   eff     effective number of places, 1 / sum(share^2) — equals the place
 *           count when rows are spread evenly, and falls toward 1 as one
 *           place dominates
 */
function lanes(set: Row[]): { places: number; top2: number; eff: number } {
  const counts = new Map<string, number>();
  for (const r of set) counts.set(r.lane, (counts.get(r.lane) ?? 0) + 1);
  const sorted = [...counts.values()].sort((a, b) => b - a);
  const n = set.length || 1;
  return {
    places: counts.size,
    top2: ((sorted[0] ?? 0) + (sorted[1] ?? 0)) / n,
    eff: 1 / sorted.reduce((acc, c) => acc + (c / n) ** 2, 0),
  };
}
const lanesText = (set: Row[]) => {
  const l = lanes(set);
  return `${String(l.places).padStart(2)} pl, top-2 ${(l.top2 * 100).toFixed(0).padStart(3)}%, eff ${l.eff.toFixed(1).padStart(4)}`;
};

function sweep(name: string, set: Row[]): void {
  console.log(`\n${name}: ${set.length} observations`);
  if (set.length === 0) return;
  const whole = lanes(set);
  const counts = new Map<string, number>();
  for (const r of set) counts.set(r.lane, (counts.get(r.lane) ?? 0) + 1);
  console.log(
    `  from ${whole.places} place(s), effectively ${whole.eff.toFixed(1)}; top two supply ${(whole.top2 * 100).toFixed(0)}%:  ` +
    [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '),
  );
  const all = set.map(minutes);
  console.log(
    `  cost if skipped, ALL   p50 ${pct(all, 0.5).toFixed(1)}  ` +
    `p90 ${pct(all, 0.9).toFixed(1)}  max ${Math.max(...all).toFixed(1)} min`,
  );
  console.log(
    '\n   eps   skip rate      SKIPPED p50/p90    KEPT p50/p90   separation   gap    p(chance)' +
    '   | SKIPPED from                 | KEPT from',
  );
  for (const eps of EPSILONS) {
    const skip = set.filter((r) => r.stability < eps);
    const keep = set.filter((r) => r.stability >= eps);
    const share = `${((skip.length / set.length) * 100).toFixed(0).padStart(3)}% (${String(skip.length).padStart(3)})`;
    if (skip.length === 0 || keep.length === 0) {
      console.log(`  ${eps.toFixed(3)}   ${share}   (one side empty — the gate never fires)`);
      continue;
    }
    const sk = skip.map(minutes);
    const kp = keep.map(minutes);
    const s50 = pct(sk, 0.5), k50 = pct(kp, 0.5);
    const gap = median(sk) - median(kp);
    /** Too lopsided to shuffle meaningfully; say so rather than print a number. */
    const p =
      skip.length < 3 || keep.length < 3
        ? null
        : pOfChance(set.map(minutes), skip.length, gap);
    console.log(
      `  ${eps.toFixed(3)}   ${share}   ` +
      `${s50.toFixed(1).padStart(6)} / ${pct(sk, 0.9).toFixed(1).padStart(6)}  ` +
      `${k50.toFixed(1).padStart(6)} / ${pct(kp, 0.9).toFixed(1).padStart(6)}   ` +
      `${(k50 > 0 ? `${(s50 / k50).toFixed(2)}x` : '—').padStart(8)}  ` +
      `${gap.toFixed(2).padStart(6)}  ${(p === null ? 'n/a' : p.toFixed(3)).padStart(9)}` +
      `   | ${lanesText(skip)} | ${lanesText(keep)}`,
    );
  }
}

sweep('ALL gateable', rows);
sweep(`THE APPROACH — under ${APPROACH_MILES} miles`, rows.filter((r) => r.straight < APPROACH_MILES));
sweep(`beyond ${APPROACH_MILES} miles`, rows.filter((r) => r.straight >= APPROACH_MILES));

/**
 * The approach rows in full, because the sample is small enough to read and
 * a percentile over nine numbers hides more than it shows.
 */
const approach = rows.filter((r) => r.straight < APPROACH_MILES);
console.log(`\n--- every approach observation (${approach.length}) ---`);
for (const r of approach) {
  console.log(
    `  ${(r.city ?? '?').padEnd(12)} straight ${r.straight.toFixed(1).padStart(5)}  ` +
    `stability ${r.stability.toFixed(4).padStart(7)}  cost ${minutes(r).toFixed(1).padStart(5)} min`,
  );
}
const facilities = new Set(approach.map((r) => r.city ?? '?'));
console.log(
  `\n  ${approach.length} observations from ${facilities.size} destination(s). ` +
  'Read the rows, not the percentiles.',
);
console.log(
  '\nseparation 1.0 = the gate predicts nothing. p(chance) is a permutation\n' +
  `test over ${SHUFFLES.toLocaleString()} relabelings; several eps are tested, so a single\n` +
  'borderline p is not evidence. The shuffle treats every row as independent; the\n' +
  '"from" columns say how true that is. A small p with a low eff, or with SKIPPED\n' +
  'and KEPT drawn from different places, may be measuring places rather than the gate.\n',
);
await client.end();
