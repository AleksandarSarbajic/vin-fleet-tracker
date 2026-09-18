import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
loadEnv({ path: '.env.local' });
const sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });
const rows = await sql`
  select distinct on (s.lat, s.lng)
         s.lat, s.lng, s.geocode_precision as prec, s.address_line, s.city, s.state
  from stops s where s.lat is not null order by s.lat, s.lng`;

console.log(`${rows.length} distinct stop coordinates\n`);
console.log('prec    snap(m)   address');
const byPrec: Record<string, number[]> = {};
for (const r of rows) {
  // OSRM's waypoints[].distance is the snap distance in metres — the same
  // measurement Mapbox returns, against the same OSM road geometry.
  const url = `https://router.project-osrm.org/nearest/v1/driving/${r.lng},${r.lat}`;
  const res = await fetch(url);
  const d = (await res.json()) as { waypoints?: { distance: number }[] };
  const snap = d.waypoints?.[0]?.distance;
  if (snap === undefined) { console.log(`  ?       failed    ${r.address_line}`); continue; }
  const p = r.prec ?? 'null';
  (byPrec[p] ??= []).push(snap);
  console.log(
    `  ${p.padEnd(7)}${snap.toFixed(0).padStart(6)}   ${r.address_line}, ${r.city} ${r.state}`,
  );
  await new Promise((x) => setTimeout(x, 150));
}
console.log('\nsnap distance by precision level:');
for (const [p, list] of Object.entries(byPrec)) {
  list.sort((a, b) => a - b);
  const med = list[Math.floor(list.length / 2)]!;
  console.log(
    `  ${p.padEnd(7)} n=${String(list.length).padStart(2)}  median ${med.toFixed(0).padStart(5)} m  max ${list[list.length-1]!.toFixed(0).padStart(6)} m`,
  );
}
await sql.end();
