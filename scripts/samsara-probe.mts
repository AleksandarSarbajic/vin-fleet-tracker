/**
 * Re-runs the calls behind docs/samsara.md against the live org and prints
 * what it finds. `npm run samsara:probe`.
 *
 * Read-only. Run it when something in that document stops matching reality.
 */
import { config as loadEnv } from 'dotenv';
import { SamsaraClient } from '../src/samsara/client.ts';
import { cityState, parseTruckNumber } from '../src/samsara/schemas.ts';

loadEnv({ path: '.env.local' });

const token = process.env.SAMSARA_API_TOKEN;
if (!token) throw new Error('SAMSARA_API_TOKEN is not set');

const quiet = { info: () => {}, warn: () => {}, error: console.error };
const samsara = new SamsaraClient({ token, logger: quiet });

const line = (s: string) =>
  console.log(`\n== ${s} ${'='.repeat(Math.max(0, 62 - s.length))}`);

line('/fleet/vehicles — name format and the tags disagreement');
const vehicles = await samsara.drainAll((a) => samsara.vehicles(a));
console.log(`vehicles: ${vehicles.length}`);
const unparsed = vehicles.filter((v) => parseTruckNumber(v.name) === null);
console.log(
  `names with no parsable number: ${unparsed.length}`,
  unparsed.length ? unparsed.map((v) => JSON.stringify(v.name)).join(', ') : '',
);

line('/fleet/vehicles/stats — position age spread (the dead-truck problem)');
const snapshot = await samsara.drainAll((a) => samsara.vehicleStatsSnapshot(a));
const now = Date.now();
const ages = snapshot
  .flatMap((r) => (r.gps ? [(now - Date.parse(r.gps.time)) / 86_400_000] : []))
  .sort((a, b) => a - b);
const active = ages.filter((d) => d <= 1).length;
console.log(`vehicles: ${snapshot.length}`);
console.log(
  `newest fix: ${ages[0]?.toFixed(4)} days   oldest: ${ages.at(-1)?.toFixed(1)} days`,
);
console.log(`would seed ACTIVE (fix within 24h): ${active}`);
console.log(`would seed INACTIVE              : ${ages.length - active}`);

line('gps.reverseGeo.formattedLocation — shapes, and the optional ZIP');
const locs = snapshot.flatMap((r) =>
  r.gps?.reverseGeo?.formattedLocation ? [r.gps.reverseGeo.formattedLocation] : [],
);
const withZip = locs.filter((l) => /,\s*\d{5}(-\d{4})?$/.test(l)).length;
console.log(`populated: ${locs.length}/${snapshot.length}`);
console.log(`with a trailing ZIP: ${withZip}   without: ${locs.length - withZip}`);
for (const l of locs.slice(0, 5))
  console.log(`  ${l}\n    -> cityState: ${cityState(l)}`);

line('/fleet/vehicles/stats/feed — gps is an ARRAY, and it is incremental');
const cold = await samsara.vehicleStatsFeed();
const warm = await samsara.vehicleStatsFeed(cold.endCursor);
console.log(
  `cold call (no cursor): ${cold.rows.length} vehicles, ` +
    `${cold.rows.reduce((n, r) => n + r.gps.length, 0)} readings`,
);
console.log(`warm call (cursor)   : ${warm.rows.length} vehicles`);
console.log(`cursor looks like    : ${cold.endCursor.slice(0, 12)}…`);

line('/fleet/drivers — no phone number, and the fields we refuse to store');
const drivers = await samsara.drainAll((a) => samsara.drivers(a));
console.log(`drivers: ${drivers.length}`);
console.log(`zones seen: ${[...new Set(drivers.map((d) => d.timezone))].join(', ')}`);

const raw = await fetch('https://api.samsara.com/fleet/drivers?limit=1', {
  headers: { Authorization: `Bearer ${token}` },
});
const rawJson = (await raw.json()) as { data: Record<string, unknown>[] | null };
const fields = Object.keys(rawJson.data?.[0] ?? {}).sort();
console.log(`fields actually returned: ${fields.join(', ')}`);
console.log(`has a phone field? ${fields.includes('phone') ? 'YES' : 'no'}`);
const refused = ['licenseNumber', 'licenseState', 'eldSettings', 'hosSetting'];
console.log(
  `present but deliberately NOT stored: ${refused.filter((f) => fields.includes(f)).join(', ')}`,
);

line('/fleet/driver-vehicle-assignments — filterBy is mandatory');
for (const q of ['', '?filterBy=vehicles', '?filterBy=drivers']) {
  const res = await fetch(
    `https://api.samsara.com/fleet/driver-vehicle-assignments${q}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const body = res.ok ? ((await res.json()) as { data: unknown }) : null;
  console.log(
    `  ${(q || '(no filterBy)').padEnd(22)} HTTP ${res.status}` +
      (body
        ? `  data=${JSON.stringify(body.data)}`
        : '  <- parameter error, NOT a scope error'),
  );
}

console.log('\nIf anything above disagrees with docs/samsara.md, update the doc.');
