/**
 * Give existing stops coordinates. `npm run geocode:backfill`.
 *
 * Why this is a script and not part of migration 0005: it spends money at a
 * third party. That does not belong in something `db:migrate` runs
 * unattended on a deploy.
 *
 * No API key: the US Census geocoder needs none (§12.24).
 *
 * Every stop with an address and no coordinates, one forward call each,
 * through the SAME code path a dispatcher's save uses — so the demo data and
 * the backfilled data exercise what real data will, rather than a shortcut
 * that happens to produce numbers.
 *
 *   --dry-run   report what it would do, spend nothing
 *   --all       re-geocode stops that already have coordinates too
 *   --limit=N   stop after N stops
 */
import { config as loadEnv } from 'dotenv';
import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { createDirectDb } from '../src/db/connection.ts';
import { stops } from '../src/db/schema.ts';
import { formatAddress } from '../src/lib/address.ts';
import { geocodeAddress, sweepGeocodeCache } from '../src/server/geocode.ts';

loadEnv({ path: '.env.local' });

const dryRun = process.argv.includes('--dry-run');
const all = process.argv.includes('--all');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;

const { client, db } = createDirectDb(process.env['DIRECT_URL']!);

const swept = await sweepGeocodeCache(db);
if (swept > 0) console.log(`swept ${swept} expired cache row(s)`);

const candidates = await db
  .select({
    id: stops.id,
    addressLine: stops.addressLine,
    city: stops.city,
    state: stops.state,
    zip: stops.zip,
    lat: stops.lat,
  })
  .from(stops)
  .where(
    and(
      // Something to geocode.
      or(isNotNull(stops.addressLine), isNotNull(stops.city), isNotNull(stops.zip)),
      all ? sql`true` : isNull(stops.lat),
    ),
  )
  .orderBy(stops.id);

const work = limit ? candidates.slice(0, limit) : candidates;
console.log(
  `${candidates.length} stop(s) need coordinates` +
    (limit ? `, doing ${work.length}` : '') +
    (dryRun ? ' — DRY RUN, nothing will be spent or written' : ''),
);

let located = 0;
let missed = 0;

for (const stop of work) {
  const printed = formatAddress(stop);
  if (dryRun) {
    console.log(`  would geocode  ${printed}`);
    continue;
  }

  const outcome = await geocodeAddress(db, stop);

  if (outcome.ok) {
    await db
      .update(stops)
      .set({
        lat: outcome.lat,
        lng: outcome.lng,
        geocodePrecision: outcome.precision,
        // The ± that goes with a coarse level (§12.30).
        geocodeAccuracyMiles: outcome.accuracyMiles ?? null,
        geocodeConfidence: outcome.confidence,
        geocodedAddress: outcome.matchedAddress,
        geocodedAt: sql`now()`,
      })
      .where(eq(stops.id, stop.id));
    located += 1;
    console.log(
      `  ${outcome.precision.padEnd(7)} ${outcome.lat.toFixed(4)}, ${outcome.lng.toFixed(4)}` +
        `  ${printed}  ->  ${outcome.matchedAddress}`,
    );
  } else {
    missed += 1;
    console.log(
      `  MISS (${outcome.reason})  ${printed}` +
        (outcome.unmatched.length > 0 ? `  [could not match ${outcome.unmatched.join(', ')}]` : ''),
    );
    // A miss is left as NULL rather than guessed at. The board degrades to
    // the clock and says so on the row (§12.24).
  }
}

if (!dryRun) console.log(`\nlocated ${located}, missed ${missed}`);
await client.end();
