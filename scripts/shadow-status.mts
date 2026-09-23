/**
 * How the §12.61 shadow run is going. `npm run shadow:status`
 *
 * Read-only, and it answers the two questions that decide when the run
 * stops: are there enough truck-profile observations to set an eps from, and
 * enough of them ON THE APPROACH to confirm or revise the under-25-mile
 * result — which is the strongest claim standing on the thinnest cohort.
 *
 * `usable` is the count that matters, not `rows`. An observation needs
 * `ratio_prev` to have a stability figure at all, and every lane's first
 * recompute after the deploy has none, because the cache row it replaced
 * predates the column that carries it.
 */
import { config as loadEnv } from 'dotenv';
import { sql } from 'drizzle-orm';
import { createDirectDb } from '../src/db/connection.ts';

loadEnv({ path: '.env.local' });
const { client, db } = createDirectDb(process.env['DIRECT_URL']!);

/** The stopping rule, stated before the run rather than after it. */
const NEED_USABLE = 150;
const NEED_ENDGAME = 40;

interface Row {
  rows: number; usable: number; endgame: number; lanes: number;
  gateable: number; first: string | null; last: string | null; hours: number | null;
  /** Distinct lanes that have been observed inside 25 miles. */
  approaches: number;
}

const [row] = (await db.execute(sql`
  select count(*)::int                                            as rows,
         count(*) filter (where ratio_prev is not null)::int       as usable,
         count(*) filter (where ratio_prev is not null
                            and straight_miles < 25)::int          as endgame,
         -- Only truck-moved is gateable at all: the others mean the cached
         -- row is about somewhere else, not merely older.
         count(*) filter (where ratio_prev is not null
                            and reason = 'truck-moved')::int       as gateable,
         count(distinct (stop_id, dest_lat, dest_lng))::int        as lanes,
         -- The unit the approach bar actually accrues in. See below.
         count(distinct (stop_id, dest_lat, dest_lng))
           filter (where ratio_prev is not null
                     and straight_miles < 25)::int                  as approaches,
         to_char(min(observed_at) at time zone 'UTC','MM-DD HH24:MI') as first,
         to_char(max(observed_at) at time zone 'UTC','MM-DD HH24:MI') as last,
         round(extract(epoch from (max(observed_at) - min(observed_at))) / 3600.0, 2)::float as hours
  from route_shadow`)) as unknown as Row[];

const bar = (have: number, need: number) => {
  const filled = Math.min(20, Math.round((have / need) * 20));
  return `[${'#'.repeat(filled)}${'.'.repeat(20 - filled)}] ${have}/${need}`;
};

console.log(`\nshadow run (§12.61)   ${row?.rows ?? 0} rows on ${row?.lanes ?? 0} lanes`);
if (row?.first) console.log(`collecting since ${row.first} UTC, latest ${row.last} UTC\n`);

console.log(`  usable observations   ${bar(row?.usable ?? 0, NEED_USABLE)}`);
console.log(`  under 25 miles        ${bar(row?.endgame ?? 0, NEED_ENDGAME)}`);
console.log(`  of those, gateable    ${row?.gateable ?? 0} (reason = truck-moved)`);

/**
 * Rate for the USABLE bar, floored on elapsed time — the §12.60 rule. A run
 * twelve minutes old divides by 0.2 hours and projects arithmetic fiction.
 *
 * Hours is the right unit here and the WRONG one for the approach bar, which
 * is why the two are projected differently below.
 */
const hours = Math.max(row?.hours ?? 0, 1);
const perHour = (row?.usable ?? 0) / hours;
console.log(`\n  usable rate   ${perHour.toFixed(1)}/h over ${hours.toFixed(1)} h`);

/**
 * The approach bar accrues per APPROACH, not per hour, and the overnight of
 * 2026-09-22 proved it: 11.8 uninterrupted hours produced two arrivals and
 * seven observations inside 25 miles, so an hourly rate read 0.6/h and
 * forecast 55 hours that had nothing to do with anything.
 *
 * The cause is structural. The recompute floor is 10 miles, so a lane
 * crossing its last 25 miles can only trigger two or three recomputes before
 * it arrives. The supply is bounded by how many trucks finish a run, and a
 * parked fleet at 3am supplies none however long it is left.
 */
const approaches = row?.approaches ?? 0;
const endgame = row?.endgame ?? 0;
const perApproach = approaches > 0 ? endgame / approaches : 0;

console.log(
  `  approach yield   ${endgame} observations from ${approaches} approach${approaches === 1 ? '' : 'es'}` +
  (approaches > 0 ? `   (${perApproach.toFixed(1)} each)` : ''),
);
if (approaches > 0 && approaches < 3) {
  console.log('  ^ provisional: fewer than three approaches is not a yield yet.');
}

/** How often the fleet actually finishes a run — the supply side. */
const [arr] = (await db.execute(sql`
  select count(*)::int as day from stops
  where arrived_at > now() - interval '24 hours'`)) as unknown as { day: number }[];
const arrivalsPerDay = arr?.day ?? 0;

const done = (row?.usable ?? 0) >= NEED_USABLE && endgame >= NEED_ENDGAME;
if (done) {
  console.log('\n  BOTH THRESHOLDS MET — the run can stop and be analysed.');
} else if (endgame >= NEED_ENDGAME) {
  const hoursLeft = perHour > 0 ? (NEED_USABLE - (row?.usable ?? 0)) / perHour : 0;
  console.log(`\n  approaches done; ~${hoursLeft.toFixed(0)} h of driving left for the usable bar.`);
} else if (perApproach > 0) {
  const needed = Math.ceil((NEED_ENDGAME - endgame) / perApproach);
  console.log(`\n  ~${needed} more approach${needed === 1 ? '' : 'es'} needed — trucks finishing a run,`);
  if (arrivalsPerDay > 0) {
    console.log(
      `  not hours. The fleet completed ${arrivalsPerDay} in the last 24 h,\n` +
      `  which puts it near ${(needed / arrivalsPerDay).toFixed(1)} more active day(s) at that pace.`,
    );
  } else {
    console.log('  not hours. No arrivals in the last 24 h, so nothing is being supplied.');
  }
} else {
  console.log('\n  no approach observed yet: nothing has come inside 25 miles on a warmed lane.');
}
console.log();
await client.end();
