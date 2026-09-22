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
 * Rate, floored on elapsed time — the §12.60 rule. A run twelve minutes old
 * divides by 0.2 hours and projects a finish that is pure arithmetic fiction.
 */
const hours = Math.max(row?.hours ?? 0, 1);
const perHour = (row?.usable ?? 0) / hours;
const endgamePerHour = (row?.endgame ?? 0) / hours;
console.log(`\n  rate   ${perHour.toFixed(1)} usable/h   ${endgamePerHour.toFixed(1)} endgame/h`);

const done =
  (row?.usable ?? 0) >= NEED_USABLE && (row?.endgame ?? 0) >= NEED_ENDGAME;
if (done) {
  console.log('\n  BOTH THRESHOLDS MET — the run can stop and be analysed.');
} else if (perHour > 0 && endgamePerHour > 0) {
  const hoursLeft = Math.max(
    (NEED_USABLE - (row?.usable ?? 0)) / perHour,
    (NEED_ENDGAME - (row?.endgame ?? 0)) / endgamePerHour,
  );
  console.log(
    `\n  ~${hoursLeft.toFixed(1)} h left at this rate, and the rate only holds\n` +
    '  while the fleet is moving — an idle night counts for nothing.',
  );
} else {
  console.log('\n  not accruing yet: nothing has been recomputed on a warmed lane.');
}
console.log();
await client.end();
