import { config as loadEnv } from 'dotenv';
import { sql } from 'drizzle-orm';
import { createDirectDb } from '@/db/connection';
import { trucks } from '@/db/schema';
import { ServerEnv, report } from '@/env/schema';
import { SamsaraClient } from '@/samsara/client';
import { sleep } from '@/samsara/backoff';
import { logger } from './logger';
import { sweepArrivals } from './arrival';
import { sweepRouting, type RouteOutcome, type RoutingSweep } from './routing';
import { HereRouting } from '@/server/routing/provider';
import { detectMergeCandidates } from '@/server/drivers';
import { STALL_SECONDS } from './ingest';
import {
  summarizeStalls,
  utcDayStart,
  type StallDay,
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
  /**
   * §12.31. One provider instance for the process. Absent a token it answers
   * `not-configured` and the board degrades to the lane estimate — the same
   * shape as the geocoder, and for the same reason: an enrichment must not be
   * able to take the dispatch board down.
   */
  const router = new HereRouting(env.HERE_API_KEY);

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

  await reportDay(db, utcDayStart(new Date(), 1), 'the day before this start');

  try {
    // Startup runs inside the same reporting path as a poll. Without this a
    // bad token or a dead API kills the process with feed_health untouched,
    // so the console shows staleness with no reason next to it — and
    // feed_health.last_error is the only place a dispatcher's offline banner
    // can learn WHY the feed stopped.
    try {
      await syncRoster(db, samsara);
      await seedIfCold(db, samsara);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('startup failed', { error: message });
      await recordFailure(db, `startup: ${message}`);
      throw error;
    }

    let lastRoster = Date.now();
    let lastPrune = Date.now();
    /**
     * When the last poll SUCCEEDED, so a stall can be measured (§12.39).
     *
     * The worker stalled eleven times in one day, 5.8 to 51.1 minutes. Each
     * one logged a single line — at the END, when the hung query finally
     * threw — which read like one bad query rather than half an hour of a
     * dead fleet. The gap is the fact worth reporting, and nothing was
     * measuring it.
     */
    let lastSuccessAt = Date.now();
    /**
     * The UTC day this process has already reported on (§12.42).
     *
     * The startup line alone would not have answered the question it was
     * asked: if the stall fix works, this process runs for weeks and never
     * starts again, so the report that says "yesterday was clean" is exactly
     * the one that never prints. The rollover is what makes it arrive daily.
     */
    let reportedDay = utcDayStart(new Date()).getTime();

    while (!shuttingDown) {
      const startedAt = Date.now();

      const today = utcDayStart(new Date(startedAt)).getTime();
      if (today !== reportedDay) {
        await reportDay(db, new Date(reportedDay), 'yesterday');
        reportedDay = today;
      }
      const gapSeconds = (startedAt - lastSuccessAt) / 1000;
      try {
        await pollOnce(db, samsara, router, gapSeconds);
        if (gapSeconds >= STALL_SECONDS) {
          /**
           * Logged as its own event, at WARN, naming the duration. This is
           * the line that was missing: the error told us a query failed, not
           * that the fleet had been unobserved for 34 minutes.
           */
          logger.warn?.('poll stall ended', {
            stalledSeconds: Math.round(gapSeconds),
            missedCycles: Math.floor(gapSeconds / (POLL_INTERVAL_MS / 1000)),
          });
        }
        lastSuccessAt = Date.now();
      } catch (error: unknown) {
        // Never let one bad cycle kill the process — the next poll is 30s
        // away and the feed_health row is what tells the UI we are behind.
        const message = error instanceof Error ? error.message : String(error);
        logger.error('poll cycle failed', {
          error: message,
          // How long the fleet has been unobserved, which the error alone
          // never said.
          stalledSeconds: Math.round(gapSeconds),
        });
        await recordFailure(db, message);
      }

      if (!shuttingDown && Date.now() - lastRoster >= ROSTER_INTERVAL_MS) {
        await syncRoster(db, samsara).catch(async (e: unknown) => {
          const message = e instanceof Error ? e.message : String(e);
          logger.error('roster sync failed', { error: message });
          await recordFailure(db, `roster sync: ${message}`);
        });
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

/**
 * One day of stall history, logged (§12.42).
 *
 * WARN when the day had any stall at all, INFO when it was clean, so the line
 * that matters is not the same colour as the line that says nothing happened.
 *
 * Its own try: a reporting query must not be able to stop the worker from
 * polling. Logged, never swallowed — the failure mode this whole section
 * exists to prevent is an outage that leaves no trace.
 */
async function reportDay(
  db: ReturnType<typeof createDirectDb>['db'],
  dayStart: Date,
  label: string,
): Promise<void> {
  let day: StallDay;
  try {
    day = await summarizeStalls(db, dayStart);
  } catch (error: unknown) {
    logger.error('feed health report failed', {
      error: error instanceof Error ? error.message : String(error),
      day: dayStart.toISOString().slice(0, 10),
    });
    return;
  }

  const detail = {
    covering: label,
    day: day.day,
    stalls: day.stalls,
    missedCycles: day.missedCycles,
    longestStallSeconds: day.longestSeconds,
    longestStallMinutes: Math.round((day.longestSeconds / 60) * 10) / 10,
    longestStallAt: day.longestAt,
    totalStalledMinutes: Math.round((day.totalSeconds / 60) * 10) / 10,
    // Cumulative, since 0011 — the figure that is comparable across restarts.
    everMissedCycles: day.everMissedCycles,
    everLongestStallMinutes: Math.round((day.everLongestSeconds / 60) * 10) / 10,
    everLongestStallAt: day.everLongestAt,
    // Never let a zero stand in for "we were not recording".
    ...(day.complete ? {} : { partial: 'stall logging began part-way through this day' }),
  };

  if (day.stalls > 0) logger.warn?.('feed health: the fleet was unobserved', detail);
  // "No stalls" and "not recorded" read identically at a glance, and only one
  // of them is good news. The message, not just a field, has to say which.
  else if (!day.complete) logger.info('feed health: this day was not fully recorded', detail);
  else logger.info('feed health: no stalls', detail);
}

/** One poll: feed → positions → heartbeat. The cursor advances only on success. */
async function pollOnce(
  db: ReturnType<typeof createDirectDb>['db'],
  samsara: SamsaraClient,
  router: HereRouting,
  /** Seconds since the last SUCCESSFUL poll, recorded on the heartbeat. */
  gapSeconds = 0,
): Promise<void> {
  const cursor = await readCursor(db);
  const page = await samsara.vehicleStatsFeed(cursor ?? undefined);

  if (page.rows.length === 0) {
    await recordSuccess(db, page.endCursor || (cursor ?? ''), null, gapSeconds);
    logger.info('poll: no changes', { cursor: shortCursor(page.endCursor) });
    return;
  }

  const idMap = await upsertTrucks(
    db,
    page.rows.map((r) => ({ id: r.id, name: r.name })),
  );
  const pending = flattenFeed(page.rows);
  const result = await writePositions(db, pending, idMap);

  await recordSuccess(db, page.endCursor, result.newestRecordedAt, gapSeconds);

  /**
   * §12.27. AFTER the positions land, because it reads them back — running it
   * first would evaluate this poll against last poll's track.
   *
   * Deliberately outside the try that wraps ingestion at the call site is NOT
   * what happens here: a failure to detect an arrival must not lose the
   * positions we just wrote or stall the cursor, so it is caught on its own.
   * A missed arrival costs one poll; a lost cursor costs the feed.
   */
  let sweep = { arrived: 0, departed: 0, considered: 0 };
  try {
    sweep = await sweepArrivals(db, logger);
  } catch (error: unknown) {
    logger.error('arrival sweep failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  /**
   * §12.31. After arrivals, because an arrived stop is no longer routed to.
   * Caught on its own: a routing failure must not lose the positions we just
   * wrote or stall the cursor.
   */
  let routing: RoutingSweep = {
    considered: 0,
    routed: 0,
    skipped: 0,
    failed: 0,
    budgetExhausted: false,
    outcomes: {} as Record<RouteOutcome, number>,
    routedBecause: {},
    failures: {},
    blocked: [],
  };
  try {
    routing = await sweepRouting(db, router, logger, {
      ceiling: env.ROUTING_MONTHLY_CEILING,
    });
    if (routing.budgetExhausted) {
      logger.error('routing budget exhausted for the month — degrading to lane estimates', {
        ceiling: env.ROUTING_MONTHLY_CEILING,
      });
    }
  } catch (error: unknown) {
    logger.error('routing sweep failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.info('poll: ingested', {
    vehicles: page.rows.length,
    readings: pending.length,
    inserted: result.inserted,
    duplicates: pending.length - result.inserted - result.skippedUnknownTruck,
    skippedUnknownTruck: result.skippedUnknownTruck,
    newestPositionAt: result.newestRecordedAt?.toISOString() ?? null,
    cursor: shortCursor(page.endCursor),
    breaker: samsara.breakerState,
    arrivalsDetected: sweep.arrived,
    departuresDetected: sweep.departed,
    stopsWatched: sweep.considered,
    /**
     * §12.54. `routesSkipped` alone could not say whether twenty lanes were
     * correctly left alone or one was being dropped by the wrong rule.
     * `lanesConsidered` is the denominator, `routeOutcomes` sums to it, and
     * `lanesBlocked` names the ones that are not routing and not fine.
     */
    lanesConsidered: routing.considered,
    routed: routing.routed,
    routesSkipped: routing.skipped,
    routesFailed: routing.failed,
    routeOutcomes: routing.outcomes,
    routedBecause: routing.routedBecause,
    routeFailures: routing.failures,
    lanesBlocked: routing.blocked,
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

  /**
   * §12.35: RECORDS a possible duplicate, never acts on one. A driver a
   * dispatcher created by hand appears in Samsara weeks later, once
   * onboarding finishes, and the sync above has just made a second row for
   * the same person. A human decides whether they are the same person; this
   * only makes sure the question gets asked.
   */
  const candidates = await detectMergeCandidates(db);

  logger.info('roster synced', {
    vehicles: vehicles.length,
    drivers: driverRows.length,
    mergeCandidates: candidates,
  });
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
