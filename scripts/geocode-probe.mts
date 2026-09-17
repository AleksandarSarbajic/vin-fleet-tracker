/**
 * Measure the geocoder's hit rate on a list of real addresses.
 * `npm run geocode:probe -- addresses.csv`
 *
 * READ-ONLY. It writes nothing to the database — not to `stops`, not even to
 * `geocode_cache` — so it can be pointed at a list of real destinations
 * without changing a single row of dispatch data. It needs no database
 * connection at all.
 *
 * Input: one address per line, comma-separated:
 *
 *     26416 S Walton Dr, Elwood, IL, 60421
 *     1804 North Washington Street, Grand Forks, ND, 58203
 *
 * A header line is detected and skipped. Blank lines are ignored. Quoted
 * fields are not supported, deliberately — the whole file is four fields and
 * a CSV parser would be more code than the thing it parses.
 *
 * Output: per-address result, then the rate by precision level, which is the
 * number that decides whether the fallback is carrying the fleet or idle.
 */
import { readFileSync } from 'node:fs';
import { geocodeOnce } from '../src/server/geocode.ts';
import { formatAddress, type AddressParts } from '../src/lib/address.ts';

const file = process.argv[2];
if (!file) {
  console.error(
    'usage: npm run geocode:probe -- <file>\n\n' +
      'One address per line: street, city, state, zip\n' +
      'Nothing is written to the database.',
  );
  process.exit(1);
}

const lines = readFileSync(file, 'utf8').split('\n');
const rows: AddressParts[] = [];
for (const [index, line] of lines.entries()) {
  const trimmed = line.trim();
  if (trimmed === '') continue;
  const parts = trimmed.split(',').map((p) => p.trim());
  // A header line, skipped rather than geocoded as an address.
  if (index === 0 && /street|address/i.test(parts[0] ?? '') && !/^\d/.test(parts[0] ?? '')) {
    continue;
  }
  rows.push({
    addressLine: parts[0] || null,
    city: parts[1] || null,
    state: parts[2] || null,
    zip: parts[3] || null,
  });
}

console.log(`${rows.length} address(es), read-only, nothing will be written\n`);

const tally = { street: 0, block: 0, zip: 0, miss: 0 };
let calls = 0;
/** Counts calls without touching the cache table. */
const counting: typeof fetch = async (...args) => {
  calls += 1;
  return fetch(...args);
};

for (const row of rows) {
  const outcome = await geocodeOnce(row, { fetchImpl: counting });
  const printed = formatAddress(row);
  if (outcome.ok) {
    tally[outcome.precision] += 1;
    const pm = outcome.accuracyMiles ? ` ±${outcome.accuracyMiles.toFixed(1)}mi` : '';
    console.log(
      `  ${outcome.precision.padEnd(6)}${pm.padEnd(9)} ${printed}  ->  ${outcome.matchedAddress}`,
    );
  } else {
    tally.miss += 1;
    console.log(`  MISS   (${outcome.reason})  ${printed}`);
  }
}

const n = rows.length || 1;
const pct = (v: number) => `${((v / n) * 100).toFixed(0)}%`.padStart(4);
console.log(`
─────────────────────────────────────────────
  street  ${String(tally.street).padStart(4)}  ${pct(tally.street)}   exact house number, arrival + at-risk enabled
  block   ${String(tally.block).padStart(4)}  ${pct(tally.block)}   right street, nearest block
  zip     ${String(tally.zip).padStart(4)}  ${pct(tally.zip)}   ZIP centroid, at-risk suppressed
  MISS    ${String(tally.miss).padStart(4)}  ${pct(tally.miss)}   no ETA at all
─────────────────────────────────────────────
  ${calls} Census call(s) for ${rows.length} address(es)
  ${(((tally.street + tally.block) / n) * 100).toFixed(0)}% got a usable street-level coordinate.
`);
