import { config as loadEnv } from 'dotenv';
import { sql } from 'drizzle-orm';
import { createDirectDb } from '@/db/connection';
import { trucks } from '@/db/schema';
import { ServerEnv, report } from '@/env/schema';
import { SamsaraClient } from '@/samsara/client';
import { sleep } from '@/samsara/backoff';
import { logger } from './logger';
import {
  flattenFeed,
  prunePositions,
  readCursor,
  recordFailure,
  recordSuccess,
  seedActiveFlags,
  upsertDrivers,
  upsertTrucks,
  writePositions,
} from './ingest';

/**
 * Standalone ingestion worker. `npm run worker`.
 *
 * Runs as its own Node process on a small VM, not on Supabase: pg_cron has a
 * one-minute floor and Edge Functions are not built for a persistent poller.
 * Connects over DIRECT_URL — the SESSION pooler — not the transaction pooler.
 *
 * Exactly one of these should run. It is the only thing that talks to
 * Samsara; every client reads our database.
 */

loadEnv({ path: '.env.local' });

const parsedEnv = ServerEnv.safeParse(process.env);
if (!parsedEnv.success) throw new Error(report('worker', parsedEnv.error));
const env = parsedEnv.data;

const POLL_INTERVAL_MS = 30_000;
const ROSTER_INTERVAL_MS = 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

let shuttingDown = false;

async function main(): Promise<void> {
  const { client, db } = createDirectDb(env.DIRECT_URL, 2);
  const samsara = new SamsaraClient({ token: env.SAMSARA_API_TOKEN, logger });

  logger.info('worker starting', {
    orgId: env.SAMSARA_ORG_ID,
    pollIntervalMs: POLL_INTERVAL_MS,
  });

  const stop = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutdown requested, finishing current cycle', { signal });
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  try {
    await syncRoster(db, samsara);
    await seedIfCold(db, samsara);

    let lastRoster = Date.now();
    let lastPrune = Date.now();

    while (!shuttingDown) {
      const startedAt = Date.now();
      try {
        await pollOnce(db, samsara);
      } catch (error: unknown) {
        // Never let one bad cycle kill the process — the next poll is 30s
        // away and the feed_health row is what tells the UI we are behind.
        const message = error instanceof Error ? error.message : String(error);
        logger.error('poll cycle failed', { error: message });
        await recordFailure(db, message);
      }

      if (!shuttingDown && Date.now() - lastRoster >= ROSTER_INTERVAL_MS) {
        await syncRoster(db, samsara).catch((e: unknown) =>
          logger.error('roster sync failed', { error: String(e) }),
        );
        lastRoster = Date.now();
      }

      if (!shuttingDown && Date.now() - lastPrune >= PRUNE_INTERVAL_MS) {
        await prunePositions(db, logger).catch((e: unknown) =>
          logger.error('prune failed', { error: String(e) }),
        );
        lastPrune = Date.now();
      }

      const elapsed = Date.now() - startedAt;
      const wait = Math.max(0, POLL_INTERVAL_MS - elapsed);
      // Sleep in slices so SIGTERM is not waiting up to 30s to be noticed.
      for (let slept = 0; slept < wait && !shuttingDown; slept += 500) {
        await sleep(Math.min(500, wait - slept));
      }
    }
  } finally {
    logger.info('worker stopped');
    await client.end({ timeout: 5 });
  }
}

/** One poll: feed → positions → heartbeat. The cursor advances only on success. */
async function pollOnce(
  db: ReturnType<typeof createDirectDb>['db'],
  samsara: SamsaraClient,
): Promise<void> {
  const cursor = await readCursor(db);
  const page = await samsara.vehicleStatsFeed(cursor ?? undefined);

  if (page.rows.length === 0) {
    await recordSuccess(db, page.endCursor || (cursor ?? ''), null);
    logger.info('poll: no changes', { cursor: shortCursor(page.endCursor) });
    return;
  }

  const idMap = await upsertTrucks(
    db,
    page.rows.map((r) => ({ id: r.id, name: r.name })),
  );
  const pending = flattenFeed(page.rows);
  const result = await writePositions(db, pending, idMap);

  await recordSuccess(db, page.endCursor, result.newestRecordedAt);

  logger.info('poll: ingested', {
    vehicles: page.rows.length,
    readings: pending.length,
    inserted: result.inserted,
    duplicates: pending.length - result.inserted - result.skippedUnknownTruck,
    skippedUnknownTruck: result.skippedUnknownTruck,
    newestPositionAt: result.newestRecordedAt?.toISOString() ?? null,
    cursor: shortCursor(page.endCursor),
    breaker: samsara.breakerState,
  });
}

async function syncRoster(
  db: ReturnType<typeof createDirectDb>['db'],
  samsara: SamsaraClient,
): Promise<void> {
  const vehicles = await samsara.drainAll((after) => samsara.vehicles(after));
  await upsertTrucks(
    db,
    vehicles.map((v) => ({ id: v.id, name: v.name })),
  );

  // Assignments are deliberately NOT polled: this org returns data:null for
  // both filterBy values, so there is nothing to sync. assignments is our
  // table, written by dispatchers. See docs/samsara.md §6.
  const driverRows = await samsara.drainAll((after) => samsara.drivers(after));
  await upsertDrivers(db, driverRows);

  logger.info('roster synced', { vehicles: vehicles.length, drivers: driverRows.length });
}

/**
 * First run only. Backfills last-known positions and derives trucks.active
 * from position recency, because Samsara exposes no active flag and a third
 * of this feed is trucks that have not moved in months.
 */
async function seedIfCold(
  db: ReturnType<typeof createDirectDb>['db'],
  samsara: SamsaraClient,
): Promise<void> {
  if (await readCursor(db)) return;

  logger.info('cold start: seeding from the stats snapshot');
  const snapshot = await samsara.drainAll((after) => samsara.vehicleStatsSnapshot(after));

  const idMap = await upsertTrucks(
    db,
    snapshot.map((r) => ({ id: r.id, name: r.name })),
  );

  const pending = snapshot.flatMap((row) =>
    row.gps
      ? [
          {
            samsaraVehicleId: row.id,
            lat: row.gps.latitude,
            lng: row.gps.longitude,
            heading:
              (row.gps.speedMilesPerHour ?? 0) === 0
                ? null
                : (row.gps.headingDegrees ?? null),
            speedMph: row.gps.speedMilesPerHour ?? null,
            recordedAt: new Date(row.gps.time),
            formattedLocation: row.gps.reverseGeo?.formattedLocation ?? null,
          },
        ]
      : [],
  );

  const written = await writePositions(db, pending, idMap);
  const flags = await seedActiveFlags(db, snapshot, new Date());

  logger.info('seed complete', {
    vehicles: snapshot.length,
    positionsWritten: written.inserted,
    active: flags.active,
    inactive: flags.inactive,
  });

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(trucks);
  logger.info('trucks in database', { count });
}

const shortCursor = (c: string): string => (c ? `${c.slice(0, 8)}…` : '(none)');

main().catch((error: unknown) => {
  logger.error('worker crashed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
