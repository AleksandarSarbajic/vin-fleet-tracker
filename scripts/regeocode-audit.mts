/**
 * Re-run every geocoded stop through the CURRENT chain and report what
 * changes. `npm run geocode:reaudit` — read-only unless told otherwise.
 *
 * §12.55 added a street-match guard, and a guard that only applies to future
 * saves is half a guard: every stop geocoded before it may be pinned to a
 * street nobody typed, and nothing on the board would show it. The precision
 * says `street` and the ± says 0.15 mi.
 *
 * Read-only BY DEFAULT, on purpose. Refusing a match costs the stop its
 * coordinates — no ETA, no arrival detection, a visible warning on the row —
 * and that is the right outcome for a wrong coordinate but a real cost for a
 * right one. How many stops go dark is a decision, not a consequence to
 * discover afterwards. The audit ran first and the list was read first; this
 * is the second half of that, not a shortcut past it.
 *
 *   (no flag)  report only. Uses `geocodeOnce`, which runs the whole chain
 *              and writes nothing: not the cache, not the stops.
 *   --apply    write the result to every stop behind each address. Uses
 *              `geocodeAddress`, so the cache ends up agreeing with the
 *              board rather than contradicting it on the next save.
 *
 * Deduplicated by normalised address so the same DC on six loads costs one
 * call. An address whose answer did not change is NOT written: touching it
 * would bump `geocoded_at` and drop a cached route to say nothing happened.
 */
import { config as loadEnv } from 'dotenv';
import { eq, inArray, sql } from 'drizzle-orm';
import { createDirectDb } from '../src/db/connection.ts';
import { stopRoutes, stops } from '../src/db/schema.ts';
import { geocodeAddress, geocodeOnce } from '../src/server/geocode.ts';
import { type AddressParts } from '../src/lib/address.ts';
import { haversineMiles } from '../src/lib/status.ts';
import { writeAudit } from '../src/server/audit.ts';

loadEnv({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const { client, db } = createDirectDb(process.env['DIRECT_URL']!);

interface Row {
  ids: string[];
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
  select array_agg(s.id::text) as ids, s.address_line, s.city, s.state, s.zip,
         min(s.lat) as lat, min(s.lng) as lng,
         min(s.geocode_precision::text) as geocode_precision,
         min(s.geocoded_address) as geocoded_address,
         count(*)::int as stops_using
  from stops s
  where s.geocode_precision is not null
  group by s.address_line, s.city, s.state, s.zip
  order by 2`)) as unknown as Row[];

console.log(APPLY ? '*** APPLYING — this writes ***\n' : '');
console.log(`distinct geocoded addresses: ${rows.length}`);
console.log(`stops behind them:           ${rows.reduce((n, r) => n + r.stops_using, 0)}\n`);

const kept: string[] = [];
const moved: string[] = [];
const demoted: string[] = [];
const dark: string[] = [];
let darkStops = 0;
let demotedStops = 0;
let written = 0;
let routesDropped = 0;

/**
 * The same columns the stop save writes, in the same two shapes (§12.24).
 * A refusal nulls them all: keeping the old coordinates would project an ETA
 * to a place the chain has just said it cannot stand behind.
 */
const CLEARED = {
  lat: null,
  lng: null,
  geocodePrecision: null,
  geocodeAccuracyMiles: null,
  geocodeConfidence: null,
  geocodedAddress: null,
  geocodedAt: null,
} as const;

async function applyToStops(
  row: Row,
  columns: Record<string, unknown>,
  after: Record<string, unknown>,
): Promise<void> {
  if (!APPLY) return;
  await db.transaction(async (tx) => {
    await tx.update(stops).set(columns).where(inArray(stops.id, row.ids));
    /**
     * §12.54. `stop_routes` is keyed on the stop's coordinates, so a row
     * whose stop has been re-geocoded describes a lane to somewhere else.
     * It is a cache and it is deletable; `route_samples` is a measurement
     * and keeps every row.
     */
    for (const id of row.ids) {
      const gone = await tx.delete(stopRoutes).where(eq(stopRoutes.stopId, id)).returning({
        id: stopRoutes.stopId,
      });
      routesDropped += gone.length;
    }
    await writeAudit(
      tx,
      row.ids.map((id) => ({
        // No dispatcher did this. A maintenance pass that left no trace
        // would be a set of coordinates nobody can account for.
        actorUserId: null,
        entity: 'stop' as const,
        entityId: id,
        before: {
          lat: row.lat,
          lng: row.lng,
          precision: row.geocode_precision,
          matchedAddress: row.geocoded_address,
        },
        after: { ...after, source: 'geocode:reaudit --apply', rule: '§12.55' },
      })),
    );
  });
  written += row.ids.length;
}

for (const r of rows) {
  const parts: AddressParts = {
    addressLine: r.address_line,
    city: r.city,
    state: r.state,
    zip: r.zip,
  };
  const label = `${r.address_line}, ${r.city}, ${r.state} ${r.zip}  [${r.stops_using} stop${r.stops_using === 1 ? '' : 's'}]`;
  // Report mode never touches the cache; apply mode wants it to agree.
  const out = APPLY ? await geocodeAddress(db, parts) : await geocodeOnce(parts);

  if (!out.ok) {
    dark.push(
      `  ${label}\n      was ${r.geocode_precision} "${r.geocoded_address}"\n      now REFUSED: ${out.reason}${out.unmatched?.length ? ` — ${out.unmatched.join(', ')}` : ''}${out.detail ? ` (${out.detail})` : ''}`,
    );
    darkStops += r.stops_using;
    await applyToStops(r, { ...CLEARED }, { located: false, refused: out.reason });
    continue;
  }
  const shift =
    r.lat !== null && r.lng !== null
      ? haversineMiles({ lat: r.lat, lng: r.lng }, { lat: out.lat, lng: out.lng })
      : null;

  const changed = out.precision !== r.geocode_precision || shift === null || shift > 0.05;

  if (changed) {
    await applyToStops(
      r,
      {
        lat: out.lat,
        lng: out.lng,
        geocodePrecision: out.precision,
        geocodeAccuracyMiles: out.accuracyMiles ?? null,
        geocodeConfidence: out.confidence,
        geocodedAddress: out.matchedAddress,
        geocodedAt: sql`now()`,
      },
      {
        lat: out.lat,
        lng: out.lng,
        precision: out.precision,
        matchedAddress: out.matchedAddress,
      },
    );
  }

  if (out.precision !== r.geocode_precision) {
    demoted.push(
      `  ${label}\n      ${r.geocode_precision} -> ${out.precision}   moves ${shift?.toFixed(3) ?? '?'} mi   "${out.matchedAddress}"`,
    );
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

console.log(`\n--- what applying this ${APPLY ? 'cost' : 'would cost'} ---`);
console.log(`  stops losing coordinates entirely: ${darkStops}`);
console.log(`  stops changing precision:          ${demotedStops}`);
if (APPLY) {
  console.log(`  stops written:                     ${written}`);
  console.log(`  cached routes dropped:             ${routesDropped}`);
  console.log('\nApplied. Every write carries an audit row naming this script.');
} else {
  console.log('\nRead-only. Nothing was written — not the stops, not the cache.');
}
await client.end();
