/**
 * What the board says about one truck, right now. `npm run check:truck -- 143`
 *
 * Reads through loadFleet — the same path the console renders from — so this
 * is what a dispatcher is looking at, not a re-derivation that could agree
 * with the engine while the screen disagrees with both.
 */
import { config as loadEnv } from 'dotenv';
import { eq } from 'drizzle-orm';
import { createDirectDb } from '../src/db/connection.ts';
import { feedHealth } from '../src/db/schema.ts';
import { LATEST_POSITION_SQL, applyStatus, parseFleetRows } from '../src/server/fleet-query.ts';
import { STATUS_DEFAULTS, isFeedStale } from '../src/lib/status.ts';

loadEnv({ path: '.env.local' });

/**
 * Composed here rather than importing loadFleet, which carries `server-only`
 * and cannot load under tsx. Same query, same parse, same applyStatus — the
 * only thing not shared is the four lines that assemble them.
 */
const { client, db } = createDirectDb(process.env['DIRECT_URL']!);
const config = {
  ...STATUS_DEFAULTS,
  dispatchTz: process.env['DISPATCH_TZ'] ?? 'America/Chicago',
};

const now = new Date();
const [result, health] = await Promise.all([
  db.execute(LATEST_POSITION_SQL),
  db.select({ newestPositionAt: feedHealth.newestPositionAt })
    .from(feedHealth).where(eq(feedHealth.id, 1)).limit(1),
]);
const fleet = applyStatus(parseFleetRows(result), config, now);
const fetchedAt = now.toISOString();
const feedStale = isFeedStale(
  health[0]?.newestPositionAt?.toISOString() ?? null, config, now,
);

const wanted = Number(process.argv[2] ?? 143);
const row = fleet.find((r) => r.truckNumber === wanted);

if (!row) {
  console.error(`no truck ${wanted}`);
  await client.end();
  process.exit(1);
}

const tz = row.nextStop?.apptTz ?? 'America/Chicago';
const fmt = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(new Date(iso))
    : '—';

console.log(`fetched ${fetchedAt}   feedStale=${feedStale}`);
console.log(`truck ${row.truckNumber}  driver ${row.driverName ?? '(none)'}`);
console.log(`  position    ${row.formattedLocation ?? '—'}  @ ${row.recordedAt}`);
console.log(`  speed       ${row.speedMph ?? '—'} mph`);
console.log(`  next stop   ${[row.nextStop?.addressLine, row.nextStop?.city, row.nextStop?.state, row.nextStop?.zip].filter(Boolean).join(', ') || '—'}`);
console.log(`  coords      ${row.nextStop?.lat ?? 'NULL'}, ${row.nextStop?.lng ?? 'NULL'}  (${row.nextStop?.precision ?? 'no precision'})`);
console.log(`  appt        ${row.nextStop?.apptType} ${fmt(row.nextStop?.apptStartUtc ?? null)}–${fmt(row.nextStop?.apptEndUtc ?? null)} ${tz}`);
console.log(`  ---`);
console.log(`  MILES       ${row.milesRemaining === null ? '—' : `${Math.round(row.milesRemaining)} mi`}`);
console.log(`  ETA         ${fmt(row.etaUtc)}   (${row.etaAbsence})`);
console.log(`  STATUS      ${row.status}`);
await client.end();
