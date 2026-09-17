/**
 * Give the original demo stops real, geocodable addresses — IN PLACE.
 * `npm run demo:relocate` (add `--dry-run` first).
 *
 * WHY THIS EXISTS INSTEAD OF A RE-SEED
 *
 * `seed:demo` clears demo loads and rewrites them, and the cascade would
 * delete stops a dispatcher has edited by hand. Truck 143's Grand Forks stop
 * sits on a seeded load, carries six hand edits and the FCFS receiving hours
 * being tested against. Re-seeding to fix fake addresses would destroy the
 * test case that proved the feature works.
 *
 * So this UPDATES the placeholder addresses the first seed wrote
 * ("2 DEMO Distribution Way") to the real ones in demo-places.mts, and
 * geocodes them through the same path a dispatcher's save uses.
 *
 * THE RULE IT WILL NOT BREAK
 *
 * Any stop with an entry in `audit_log` is LEFT ALONE, whatever its address
 * looks like. An audit row means a human touched it, and a human's dispatch
 * data is not this script's to rewrite. That is checked per stop, not
 * inferred from the address — 138's stop still reads "2 DEMO Distribution
 * Way" and was hand-edited, so it stays.
 */
import { config as loadEnv } from 'dotenv';
import { eq, sql } from 'drizzle-orm';
import { createDirectDb } from '../src/db/connection.ts';
import { auditLog, stops } from '../src/db/schema.ts';
import { formatAddress } from '../src/lib/address.ts';
import { geocodeAddress } from '../src/server/geocode.ts';
import { RELOCATE_BY_CITY } from './demo-places.mts';

loadEnv({ path: '.env.local' });

const dryRun = process.argv.includes('--dry-run');
const { client, db } = createDirectDb(process.env['DIRECT_URL']!);

/** The placeholder shape the first seed wrote: "<n> DEMO <something>". */
const candidates = await db
  .select({
    id: stops.id,
    addressLine: stops.addressLine,
    city: stops.city,
    state: stops.state,
    zip: stops.zip,
  })
  .from(stops)
  .where(sql`${stops.addressLine} ilike '%DEMO%'`)
  .orderBy(stops.id);

console.log(
  `${candidates.length} stop(s) still carry a placeholder address` +
    (dryRun ? ' — DRY RUN, nothing written' : ''),
);

let moved = 0;
let located = 0;
let skippedEdited = 0;
let skippedUnknown = 0;

for (const stop of candidates) {
  // An audit row means a human touched this stop. Not ours to rewrite.
  const [edit] = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(sql`${auditLog.entity} = 'stop' and ${auditLog.entityId} = ${stop.id}`)
    .limit(1);
  if (edit) {
    skippedEdited += 1;
    console.log(`  SKIP (hand-edited)  ${formatAddress(stop)}`);
    continue;
  }

  const place = stop.city ? RELOCATE_BY_CITY[stop.city] : undefined;
  if (!place) {
    skippedUnknown += 1;
    console.log(`  SKIP (no mapping)   ${formatAddress(stop)}`);
    continue;
  }

  const next = {
    addressLine: place.address,
    city: place.city,
    state: place.state,
    zip: place.zip,
  };

  if (dryRun) {
    console.log(`  would move  ${formatAddress(stop)}  ->  ${formatAddress(next)}`);
    continue;
  }

  const outcome = await geocodeAddress(db, next);
  await db
    .update(stops)
    .set({
      ...next,
      ...(outcome.ok
        ? {
            lat: outcome.lat,
            lng: outcome.lng,
            geocodePrecision: outcome.precision,
            geocodeConfidence: outcome.confidence,
            geocodedAddress: outcome.matchedAddress,
            geocodedAt: sql`now()`,
          }
        : {
            lat: null,
            lng: null,
            geocodePrecision: null,
            geocodeConfidence: null,
            geocodedAddress: null,
            geocodedAt: null,
          }),
    })
    .where(eq(stops.id, stop.id));

  moved += 1;
  if (outcome.ok) {
    located += 1;
    console.log(
      `  moved + located  ${formatAddress(next)}  ->  ${outcome.lat.toFixed(4)}, ${outcome.lng.toFixed(4)}`,
    );
  } else {
    console.log(`  moved, NOT located (${outcome.reason})  ${formatAddress(next)}`);
  }
}

if (!dryRun) {
  console.log(
    `\nmoved ${moved} (located ${located}) · left alone: ${skippedEdited} hand-edited, ${skippedUnknown} unmapped`,
  );
}
await client.end();
