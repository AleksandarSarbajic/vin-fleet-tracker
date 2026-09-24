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
 * The approach bar is projected from its OWN observed rate, over a trailing
 * 24 hours. It used to be projected from arrivals, and the data disproved
 * that model.
 *
 * The old reasoning: the recompute floor is 10 miles, so a lane crossing its
 * last 25 miles triggers two or three recomputes before it arrives — supply
 * is bounded by trucks finishing runs, so project from arrivals per day.
 * What actually happened, read-only against production on 2026-09-24:
 *
 *   - the last detected arrival was 09-22 21:25 UTC, and none followed;
 *   - yet 12 under-25 observations accrued on 09-23 and 11 on 09-24;
 *   - so the script printed "nothing is being supplied" on a day that
 *     supplied eleven.
 *
 * The cause: most shadow lanes are `DEMO-` stops put on real trucks, and no
 * load has been entered since 09-22. The trucks are not driving to these
 * stops; they pass near them on their real routes, and a pass-by inside 25
 * miles is an under-25 observation with no arrival at the end of it. Arrivals
 * measure trucks finishing runs, which is not what this bar counts.
 *
 * Why 24 hours, not the run's average and not an hourly rate: the overnight
 * of 2026-09-22 produced 7 observations in 11.8 hours of a parked fleet, so
 * any window shorter than a day swings with the time of day. A full trailing
 * day holds one of each hour. Under 24 hours of run there is no full window,
 * and the script refuses to project rather than extrapolate from a partial
 * one — the §12.60 rule.
 */
const approaches = row?.approaches ?? 0;
const endgame = row?.endgame ?? 0;
console.log(
  `  approach yield   ${endgame} observations from ${approaches} approach${approaches === 1 ? '' : 'es'}` +
  (approaches > 0 ? `   (${(endgame / approaches).toFixed(1)} each)` : ''),
);

const [recent] = (await db.execute(sql`
  select count(*) filter (where ratio_prev is not null
                            and straight_miles < 25)::int as day
  from route_shadow
  where observed_at > now() - interval '24 hours'`)) as unknown as { day: number }[];
const endgamePerDay = recent?.day ?? 0;
const fullDay = (row?.hours ?? 0) >= 24;
console.log(
  fullDay
    ? `  under-25 rate    ${endgamePerDay} in the last 24 h`
    : `  under-25 rate    not projected: the run is ${(row?.hours ?? 0).toFixed(1)} h old, under one full day`,
);

/** Still printed, because it is still true — just not the supply. */
const [arr] = (await db.execute(sql`
  select count(*)::int as day from stops
  where arrived_at > now() - interval '24 hours'`)) as unknown as { day: number }[];
console.log(`  arrivals         ${arr?.day ?? 0} in the last 24 h (not the supply; see the comment above)`);

const done = (row?.usable ?? 0) >= NEED_USABLE && endgame >= NEED_ENDGAME;
if (done) {
  console.log('\n  BOTH THRESHOLDS MET — the run can stop and be analysed.');
} else if (endgame >= NEED_ENDGAME) {
  const hoursLeft = perHour > 0 ? (NEED_USABLE - (row?.usable ?? 0)) / perHour : 0;
  console.log(`\n  approaches done; ~${hoursLeft.toFixed(0)} h of driving left for the usable bar.`);
} else if (!fullDay) {
  console.log(`\n  ${NEED_ENDGAME - endgame} more under-25 observations needed; no projection until a full day has run.`);
} else if (endgamePerDay > 0) {
  const left = NEED_ENDGAME - endgame;
  console.log(
    `\n  ${left} more under-25 observation${left === 1 ? '' : 's'} needed; at the last day's ${endgamePerDay}/day, ` +
    `about ${(left / endgamePerDay).toFixed(1)} more day(s).`,
  );
} else {
  console.log(
    `\n  ${NEED_ENDGAME - endgame} more under-25 observations needed, and the last 24 h produced none —\n` +
    '  no truck passed within 25 miles of a warmed lane. No projection from a zero rate.',
  );
}
console.log();
await client.end();
