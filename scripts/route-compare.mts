/**
 * Car versus truck on our own lanes, through HERE. `npm run route:compare`.
 *
 * §12.31 justified the provider seam with a measured gap: Mapbox's car
 * routing against Valhalla's truck routing was **+3.0 mi mean, +15.6 mi
 * worst** on our lanes. §12.59 spent that seam on HERE Routing v8, so the
 * same question has to be asked again with the profile we actually bought —
 * otherwise the swap rests on a number measured against a third provider.
 *
 * Read-only. It writes nothing and it is NOT counted against
 * `routing_budget`, because it is not the board routing a lane: it is two
 * calls per lane for a measurement, run by hand. Keep that in mind — a run
 * over 10 lanes spends 20 of the month's 5,000 transactions.
 *
 * Lanes come from `route_samples`, which is the record of what this company
 * actually runs (§12.31) and holds the destination coordinates the row was
 * measured against (§12.54) — so this compares the same endpoints, not
 * whatever those stops have since been re-pointed to.
 *
 * ## The origin problem, and why one column is checked and another is not
 *
 * `route_samples` stores the destination it measured but NOT the origin —
 * only `straight_miles`, the distance between them at the time. The origin
 * has to come from `stop_routes`, which holds the CURRENT cached origin, and
 * on any lane re-routed since the sample those are different points.
 *
 * The first run of this script reported Salt Lake City as Mapbox 1338.8 vs
 * HERE car 1140.0 — a 199-mile "provider disagreement" that was nothing of
 * the sort. The two numbers measured different journeys.
 *
 * So: **car-vs-truck is always sound** — both calls leave from the same
 * point in the same minute, which is the comparison §12.31 actually asked
 * for. The Mapbox column is only comparable when the stored `straight_miles`
 * still matches the geometry of the origin we have, and it is printed as
 * `—` when it does not, rather than being quietly averaged in.
 */
import { config as loadEnv } from 'dotenv';
import { sql } from 'drizzle-orm';
import { createDirectDb } from '../src/db/connection.ts';
import { metresToMiles } from '../src/lib/routing.ts';
import { haversineMiles } from '../src/lib/status.ts';

loadEnv({ path: '.env.local' });
const key = process.env['HERE_API_KEY'];
if (!key) throw new Error('HERE_API_KEY is not set — nothing to compare.');

const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 10);
const { client, db } = createDirectDb(process.env['DIRECT_URL']!);

interface Lane {
  truck: number | null;
  city: string | null;
  state: string | null;
  from_lat: number;
  from_lng: number;
  dest_lat: number;
  dest_lng: number;
  straight_miles: number;
  mapbox_miles: number;
  mapbox_s: number;
}

/**
 * The most recent Mapbox sample per distinct destination, longest first.
 * One per destination: six loads to the same DC is one lane, and routing it
 * six times would spend six transactions to learn one number.
 */
const lanes = (await db.execute(sql`
  select distinct on (round(dest_lat::numeric,3), round(dest_lng::numeric,3))
         t.truck_number as truck, rs.dest_city as city, rs.dest_state as state,
         sr.from_lat, sr.from_lng, rs.dest_lat, rs.dest_lng,
         rs.straight_miles, rs.routed_miles as mapbox_miles,
         rs.routed_duration_s as mapbox_s
  from route_samples rs
  left join stops s on s.id = rs.stop_id
  left join loads l on l.id = s.load_id
  left join trucks t on t.id = l.truck_id
  left join stop_routes sr on sr.stop_id = rs.stop_id
  where rs.provider = 'mapbox-directions-driving'
    and rs.dest_lat is not null and sr.from_lat is not null
  order by round(dest_lat::numeric,3), round(dest_lng::numeric,3),
           rs.measured_at desc`)) as unknown as Lane[];

const work = lanes.sort((a, b) => b.straight_miles - a.straight_miles).slice(0, limit);
console.log(`comparing ${work.length} distinct lanes, ${work.length * 2} HERE calls\n`);

async function here(mode: 'car' | 'truck', lane: Lane) {
  const q = new URLSearchParams({
    transportMode: mode,
    origin: `${lane.from_lat},${lane.from_lng}`,
    destination: `${lane.dest_lat},${lane.dest_lng}`,
    return: 'summary',
    apiKey: key!,
  });
  const r = await fetch(`https://router.hereapi.com/v8/routes?${q}`, {
    headers: { accept: 'application/json' },
  });
  if (!r.ok) return null;
  const body = (await r.json()) as {
    routes?: { sections?: { summary?: { length: number; duration: number } }[] }[];
  };
  const s = body.routes?.[0]?.sections?.[0]?.summary;
  return s ? { miles: metresToMiles(s.length), seconds: s.duration } : null;
}

const rows: {
  label: string;
  straight: number;
  /** Null when the cached origin is not the one this sample was measured from. */
  mapbox: number | null;
  car: number;
  truck: number;
}[] = [];

for (const lane of work) {
  const [car, truck] = [await here('car', lane), await here('truck', lane)];
  if (!car || !truck) {
    console.log(`  ${lane.city}, ${lane.state}: no route`);
    continue;
  }
  /**
   * Does the origin we have actually belong to this sample? The sample's own
   * `straight_miles` is the distance it was measured over; recomputing it
   * from the cached origin answers the question without storing anything new.
   * 1% of tolerance covers rounding, not a truck that has driven on.
   */
  const straightFromCachedOrigin = haversineMiles(
    { lat: lane.from_lat, lng: lane.from_lng },
    { lat: lane.dest_lat, lng: lane.dest_lng },
  );
  const sameOrigin =
    Math.abs(straightFromCachedOrigin - lane.straight_miles) / lane.straight_miles < 0.01;

  rows.push({
    label: `${lane.truck ?? '—'} -> ${lane.city ?? '?'}, ${lane.state ?? '?'}`,
    straight: straightFromCachedOrigin,
    mapbox: sameOrigin ? lane.mapbox_miles : null,
    car: car.miles,
    truck: truck.miles,
  });
  await new Promise((r) => setTimeout(r, 200));
}

const pad = (s: string, n: number) => s.padEnd(n);
const num = (v: number, n = 8) => v.toFixed(1).padStart(n);
const cell = (v: number | null, n = 13) => (v === null ? '—'.padStart(n) : num(v, n));
console.log(
  pad('lane', 30) +
    ['straight', 'mapbox car', 'HERE car', 'HERE truck', 'truck-car', 'truck-mapbox']
      .map((h) => h.padStart(13))
      .join(''),
);
for (const r of rows) {
  console.log(
    pad(r.label.slice(0, 29), 30) +
      num(r.straight, 13) + cell(r.mapbox) + num(r.car, 13) +
      num(r.truck, 13) + num(r.truck - r.car, 13) +
      cell(r.mapbox === null ? null : r.truck - r.mapbox),
  );
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const gapVsCar = rows.map((r) => r.truck - r.car);
const pct = rows.map((r) => ((r.truck - r.car) / r.car) * 100);
const comparable = rows.filter((r) => r.mapbox !== null) as (typeof rows[number] & { mapbox: number })[];

console.log(`\n--- ${rows.length} lanes, ${comparable.length} with a comparable Mapbox figure ---`);
console.log(
  `HERE truck vs HERE car   mean ${mean(gapVsCar).toFixed(1)} mi ` +
    `(${mean(pct).toFixed(2)}%), worst ${Math.max(...gapVsCar).toFixed(1)} mi`,
);
if (comparable.length) {
  const carVsMapbox = comparable.map((r) => Math.abs(r.car - r.mapbox));
  console.log(
    `HERE car vs Mapbox car   mean |diff| ${mean(carVsMapbox).toFixed(2)} mi, ` +
      `worst ${Math.max(...carVsMapbox).toFixed(1)} mi  (same profile, two vendors)`,
  );
}

/**
 * The mean is the wrong summary for this and the distribution says why.
 * Truck routing either agrees with car routing exactly — an interstate lane
 * with no HGV restriction to apply — or departs from it by tens of miles.
 * Averaging those describes no lane we run. Same lesson as §13.7's yard.
 */
const identical = gapVsCar.filter((g) => Math.abs(g) < 0.5).length;
const divergent = gapVsCar.filter((g) => Math.abs(g) >= 0.5);
console.log(
  `\nBIMODAL: ${identical}/${rows.length} lanes identical to the car route ` +
    `(<0.5 mi); the other ${divergent.length} differ by ` +
    `${divergent.length ? mean(divergent.map(Math.abs)).toFixed(1) : '0'} mi mean, ` +
    `${divergent.length ? Math.max(...divergent.map(Math.abs)).toFixed(1) : '0'} mi worst.`,
);
console.log(`\n§12.31 measured the gap it opened this seam for at +3.0 mi mean / +15.6 mi worst.`);
await client.end();
