/**
 * What a cooldown actually COSTS, measured rather than modelled.
 *
 * Between recomputes the row shows straight_now * cached lane_ratio. So the
 * error a deferral introduces is straight * |ratio_then - ratio_now|. Every
 * consecutive pair of real samples on the same lane gives one observation of
 * that, indexed by the gap between them.
 */
import { config as loadEnv } from 'dotenv';
import { sql } from 'drizzle-orm';
import { createDirectDb } from '../src/db/connection.ts';
loadEnv({ path: '.env.local' });
const { client, db } = createDirectDb(process.env['DIRECT_URL']!);
/**
 * Which provider's measurements to read. Never mixed (§12.59) — a car ratio
 * and a truck ratio are different numbers for the same lane. The older
 * Mapbox rows are still a valid cohort for asking whether ratio drift tracks
 * TIME or PROXIMITY, which is a question about the shape of a road network
 * rather than about a vehicle profile.
 */
const PROVIDER =
  process.argv.find((a) => a.startsWith('--provider='))?.split('=')[1] ??
  'here-routing-v8-truck';

interface S { stop_id: string; dest_lat: number; dest_lng: number;
  straight_miles: number; lane_ratio: number; measured_at: string; }

const rows = (await db.execute(sql`
  select stop_id::text as stop_id, dest_lat, dest_lng, straight_miles, lane_ratio,
         measured_at
  from route_samples
  where provider = ${PROVIDER} and dest_lat is not null
  order by stop_id, dest_lat, dest_lng, measured_at`)) as unknown as S[];

const lanes = new Map<string, S[]>();
for (const r of rows) {
  const k = `${r.stop_id}|${r.dest_lat}|${r.dest_lng}`;
  if (!lanes.has(k)) lanes.set(k, []);
  lanes.get(k)!.push(r);
}

interface Obs { gapMin: number; dRatio: number; miles: number; straight: number; }
const obs: Obs[] = [];
for (const lane of lanes.values()) {
  for (let i = 1; i < lane.length; i++) {
    const a = lane[i - 1]!, b = lane[i]!;
    const gapMin = (new Date(b.measured_at).getTime() - new Date(a.measured_at).getTime()) / 60_000;
    if (gapMin <= 0 || gapMin > 45) continue;
    const dRatio = Math.abs(b.lane_ratio - a.lane_ratio);
    obs.push({ gapMin, dRatio, miles: dRatio * b.straight_miles, straight: b.straight_miles });
  }
}

console.log(`${rows.length} ${PROVIDER} samples on ${lanes.size} lanes -> ${obs.length} consecutive pairs\n`);
const p = (xs: number[], q: number) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};
console.log('gap between        pairs   median dRatio   p90 dRatio   median mi   p90 mi   worst mi');
for (const [lo, hi] of [[0, 10], [10, 15], [15, 20], [20, 30], [30, 45]] as const) {
  const g = obs.filter((o) => o.gapMin >= lo && o.gapMin < hi);
  if (g.length === 0) { console.log(`${lo}-${hi} min`.padEnd(18) + '       0'); continue; }
  const mi = g.map((o) => o.miles);
  console.log(
    `${`${lo}-${hi} min`.padEnd(18)} ${String(g.length).padStart(6)} ` +
    `${p(g.map((o) => o.dRatio), 0.5).toFixed(4).padStart(15)} ${p(g.map((o) => o.dRatio), 0.9).toFixed(4).padStart(12)} ` +
    `${p(mi, 0.5).toFixed(2).padStart(11)} ${p(mi, 0.9).toFixed(2).padStart(8)} ${Math.max(...mi).toFixed(2).padStart(10)}`,
  );
}
console.log('\nmiles of error = |ratio drift| x straight-line distance remaining.');
console.log('At the 52 mph cap, 1 mile is 69 seconds of ETA.');
await client.end();
