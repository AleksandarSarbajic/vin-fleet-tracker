/**
 * Logs the real query plan for the console's latest-position-per-truck query.
 * `npm run db:explain`.
 *
 * The point is to confirm the LATERAL join does ONE index seek per truck
 * rather than scanning the positions index, and to keep a baseline to compare
 * against when the table reaches its 7-day ceiling (~7-9M rows at 60 trucks).
 */
import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
loadEnv({ path: '.env.local' });
const sql = postgres(process.env.DIRECT_URL!, { max: 1 });

const QUERY = `
  select t.id::text, t.truck_number, t.samsara_name, d.name as driver_name,
         p.lat, p.lng, p.heading, p.speed_mph, p.recorded_at, p.formatted_location
  from trucks t
  left join assignments a on a.truck_id = t.id and a.ended_at is null
  left join drivers d     on d.id = a.driver_id
  left join lateral (
    select lat, lng, heading, speed_mph, recorded_at, formatted_location
    from positions where truck_id = t.id
    order by recorded_at desc limit 1
  ) p on true
  where t.active
  order by t.truck_number asc nulls last`;

const [size] = await sql`SELECT count(*) rows, pg_size_pretty(pg_total_relation_size('positions')) sz FROM positions`;
console.log(`positions: ${size!.rows} rows, ${size!.sz}\n`);

console.log('=== LATERAL (what we ship) ===');
for (const r of await sql.unsafe(`EXPLAIN (ANALYZE, BUFFERS) ${QUERY}`)) {
  console.log(' ', (r as Record<string, string>)['QUERY PLAN']);
}

console.log('\n=== DISTINCT ON (the alternative, for comparison) ===');
const ALT = `
  select t.id::text, t.truck_number, p.recorded_at
  from trucks t
  left join (
    select distinct on (truck_id) truck_id, recorded_at
    from positions order by truck_id, recorded_at desc
  ) p on p.truck_id = t.id
  where t.active`;
for (const r of await sql.unsafe(`EXPLAIN (ANALYZE, BUFFERS) ${ALT}`)) {
  console.log(' ', (r as Record<string, string>)['QUERY PLAN']);
}
await sql.end();
