/**
 * Re-run every geocoded stop through the CURRENT chain and report what
 * changes. `npm run geocode:reaudit` — read-only by default.
 *
 * §12.55 added a street-match guard, and a guard that only applies to future
 * saves is half a guard: every stop geocoded before it may be pinned to a
 * street nobody typed, and nothing on the board would show it. The precision
 * says `street` and the ± says 0.15 mi.
 *
 * Read-only ON PURPOSE, and it stays that way until someone reads the list.
 * Refusing a match costs the stop its coordinates — no ETA, no arrival
 * detection, a visible warning on the row — and that is the right outcome for
 * a wrong coordinate but a real cost for a right one. How many stops go dark
 * is a decision, not a consequence to discover afterwards.
 *
 * Uses `geocodeOnce`, which runs the whole chain and writes nothing: not the
 * cache, not the stops. Deduplicated by normalised address so the same DC on
 * six loads costs one call.
 */
import { config as loadEnv } from 'dotenv';
import { sql } from 'drizzle-orm';
import { createDirectDb } from '../src/db/connection.ts';
import { geocodeOnce } from '../src/server/geocode.ts';
import { normalizeAddress, type AddressParts } from '../src/lib/address.ts';
import { haversineMiles } from '../src/lib/status.ts';

loadEnv({ path: '.env.local' });
const { client, db } = createDirectDb(process.env['DIRECT_URL']!);

interface Row {
  id: string;
  address_line: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  geocode_precision: string | null;
  geocoded_address: string | null;
  stops_using: number;
}

const rows = (await db.execute(sql`
  select min(s.id::text) as id, s.address_line, s.city, s.state, s.zip,
         min(s.lat) as lat, min(s.lng) as lng,
         min(s.geocode_precision::text) as geocode_precision,
         min(s.geocoded_address) as geocoded_address,
         count(*)::int as stops_using
  from stops s
  where s.geocode_precision is not null
  group by s.address_line, s.city, s.state, s.zip
  order by 2`)) as unknown as Row[];

console.log(`distinct geocoded addresses: ${rows.length}`);
console.log(`stops behind them:           ${rows.reduce((n, r) => n + r.stops_using, 0)}\n`);

const kept: string[] = [];
const moved: string[] = [];
const demoted: string[] = [];
const dark: string[] = [];
let darkStops = 0;
let demotedStops = 0;

for (const r of rows) {
  const parts: AddressParts = {
    addressLine: r.address_line,
    city: r.city,
    state: r.state,
    zip: r.zip,
  };
  const label = `${r.address_line}, ${r.city}, ${r.state} ${r.zip}  [${r.stops_using} stop${r.stops_using === 1 ? '' : 's'}]`;
  const out = await geocodeOnce(parts);

  if (!out.ok) {
    dark.push(`  ${label}\n      was ${r.geocode_precision} "${r.geocoded_address}"\n      now REFUSED: ${out.reason}${out.unmatched?.length ? ` — ${out.unmatched.join(', ')}` : ''}${out.detail ? ` (${out.detail})` : ''}`);
    darkStops += r.stops_using;
    continue;
  }
  const shift =
    r.lat !== null && r.lng !== null
      ? haversineMiles({ lat: r.lat, lng: r.lng }, { lat: out.lat, lng: out.lng })
      : null;

  if (out.precision !== r.geocode_precision) {
    demoted.push(`  ${label}\n      ${r.geocode_precision} -> ${out.precision}   moves ${shift?.toFixed(3) ?? '?'} mi   "${out.matchedAddress}"`);
    demotedStops += r.stops_using;
  } else if (shift !== null && shift > 0.05) {
    moved.push(`  ${label}\n      same precision, moves ${shift.toFixed(3)} mi   "${out.matchedAddress}"`);
  } else {
    kept.push(`  ${label}`);
  }
  // Census is free and unauthenticated; do not hammer it.
  await new Promise((resolve) => setTimeout(resolve, 250));
}

const section = (title: string, list: string[]) => {
  console.log(`\n=== ${title}: ${list.length} ===`);
  for (const line of list) console.log(line);
};

section('UNCHANGED — same coordinates, same precision', kept);
section('MOVED — same precision, coordinates shifted', moved);
section('PRECISION CHANGED', demoted);
section('GOES DARK — the chain now refuses this address', dark);

console.log('\n--- what applying this would cost ---');
console.log(`  stops losing coordinates entirely: ${darkStops}`);
console.log(`  stops changing precision:          ${demotedStops}`);
console.log('\nRead-only. Nothing was written — not the stops, not the cache.');
await client.end();
