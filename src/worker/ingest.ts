import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { createDirectDb } from '@/db/connection';
import { feedHealth, positions, trucks } from '@/db/schema';
import type { Logger } from '@/samsara/client';
import {
  parseTruckNumber,
  type DriverRow,
  type GpsReading,
  type VehicleFeedRow,
  type VehicleStatsRow,
} from '@/samsara/schemas';
import { drivers } from '@/db/schema';

export type Db = ReturnType<typeof createDirectDb>['db'];

/** A position ready to insert, with its Samsara vehicle id still attached. */
export interface PendingPosition {
  samsaraVehicleId: string;
  lat: number;
  lng: number;
  heading: number | null;
  speedMph: number | null;
  recordedAt: Date;
  formattedLocation: string | null;
}

/**
 * Flattens feed rows into positions.
 *
 * `gps` is an ARRAY on the feed endpoint — a vehicle that moved several times
 * between polls carries several readings, so this iterates rather than taking
 * [0]. See docs/samsara.md §4.
 *
 * `headingDegrees` is 0 on a stationary vehicle, which means "no heading",
 * not "north". It is normalised to null when speed is 0 so the map layer
 * cannot rotate a parked marker.
 */
export function flattenFeed(rows: VehicleFeedRow[]): PendingPosition[] {
  const out: PendingPosition[] = [];
  for (const row of rows) {
    for (const reading of row.gps) {
      out.push(toPending(row.id, reading));
    }
  }
  return out;
}

export function toPending(
  samsaraVehicleId: string,
  reading: GpsReading,
): PendingPosition {
  const speed = reading.speedMilesPerHour ?? null;
  const stationary = speed === null || speed === 0;
  return {
    samsaraVehicleId,
    lat: reading.latitude,
    lng: reading.longitude,
    heading: stationary ? null : (reading.headingDegrees ?? null),
    speedMph: speed,
    recordedAt: new Date(reading.time),
    formattedLocation: reading.reverseGeo?.formattedLocation ?? null,
  };
}

/** A fix within this window means the truck is in service. */
export const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Positions are kept as latest + a 7 day rolling window. */
export const POSITION_RETENTION_DAYS = 7;

export function isActiveByRecency(newestFix: Date | null, now: Date): boolean {
  if (!newestFix) return false;
  return now.getTime() - newestFix.getTime() <= ACTIVE_WINDOW_MS;
}

/**
 * Upserts the roster from whatever the feed just mentioned, so a vehicle
 * added in Samsara appears without waiting for the hourly roster sync.
 *
 * `active` is NOT set here — it is ours, seeded once from position recency
 * and flipped by an admin thereafter. Letting the feed touch it would undo
 * that decision on the next poll.
 */
export async function upsertTrucks(
  db: Db,
  rows: { id: string; name: string }[],
): Promise<Map<string, string>> {
  if (rows.length === 0) return new Map();

  await db
    .insert(trucks)
    .values(
      rows.map((r) => ({
        samsaraVehicleId: r.id,
        samsaraName: r.name,
        truckNumber: parseTruckNumber(r.name),
      })),
    )
    .onConflictDoUpdate({
      target: trucks.samsaraVehicleId,
      set: {
        samsaraName: sql`excluded.samsara_name`,
        truckNumber: sql`excluded.truck_number`,
      },
    });

  const ids = rows.map((r) => r.id);
  const found = await db
    .select({ id: trucks.id, samsaraVehicleId: trucks.samsaraVehicleId })
    .from(trucks)
    .where(inArray(trucks.samsaraVehicleId, ids));

  return new Map(found.map((t) => [t.samsaraVehicleId, t.id]));
}

/**
 * Drivers: id, name and the activation flag. Nothing else — the payload also
 * carries licenseNumber, licenseState, eldSettings and hosSetting, and none
 * of it is stored. `phone` is ours, entered by dispatchers, so it is never
 * touched here.
 */
export async function upsertDrivers(db: Db, rows: DriverRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  await db
    .insert(drivers)
    .values(
      rows.map((r) => ({
        samsaraDriverId: r.id,
        name: r.name,
        active: (r.driverActivationStatus ?? 'active') === 'active',
        source: 'samsara' as const,
      })),
    )
    .onConflictDoUpdate({
      target: drivers.samsaraDriverId,
      /**
       * REQUIRED, not optional (§12.35). `drivers_samsara_driver_id_key` is a
       * PARTIAL unique index now, and Postgres will not match an ON CONFLICT
       * target to a partial index unless the same predicate is given. Without
       * this the statement throws "no unique or exclusion constraint matching
       * the ON CONFLICT specification" — on the worker, on every poll.
       */
      targetWhere: sql`${drivers.samsaraDriverId} is not null`,
      set: { name: sql`excluded.name`, active: sql`excluded.active` },
      /**
       * The sync never overwrites a row it did not create.
       *
       * Today it cannot reach one anyway: an app-created driver has a NULL
       * Samsara id and this conflict target skips it. That is an accident of
       * the current shape, not a rule — and after a merge fills the id in, the
       * row IS reachable and still is not the sync's to rewrite. Stating it
       * here is what survives the merge.
       */
      setWhere: sql`${drivers.source} = 'samsara'`,
    });
  return rows.length;
}

export interface WriteResult {
  inserted: number;
  skippedUnknownTruck: number;
  newestRecordedAt: Date | null;
}

/**
 * Writes positions and advances trucks.last_seen_at.
 *
 * Conflicts on (truck_id, recorded_at) are ignored rather than updated: the
 * same fix re-delivered is not new information, and a retry after a partial
 * write must be harmless.
 */
export async function writePositions(
  db: Db,
  pending: PendingPosition[],
  truckIdBySamsaraId: Map<string, string>,
): Promise<WriteResult> {
  let skipped = 0;
  let newest: Date | null = null;

  const rows = [];
  for (const p of pending) {
    const truckId = truckIdBySamsaraId.get(p.samsaraVehicleId);
    if (!truckId) {
      skipped += 1;
      continue;
    }
    if (!newest || p.recordedAt > newest) newest = p.recordedAt;
    rows.push({
      truckId,
      lat: p.lat,
      lng: p.lng,
      heading: p.heading,
      speedMph: p.speedMph,
      recordedAt: p.recordedAt,
      formattedLocation: p.formattedLocation,
    });
  }

  if (rows.length === 0) {
    return { inserted: 0, skippedUnknownTruck: skipped, newestRecordedAt: null };
  }

  const inserted = await db
    .insert(positions)
    .values(rows)
    .onConflictDoNothing({ target: [positions.truckId, positions.recordedAt] })
    .returning({ id: positions.id });

  // last_seen_at only ever moves forward.
  const newestByTruck = new Map<string, Date>();
  for (const r of rows) {
    const current = newestByTruck.get(r.truckId);
    if (!current || r.recordedAt > current) newestByTruck.set(r.truckId, r.recordedAt);
  }
  for (const [truckId, at] of newestByTruck) {
    await db
      .update(trucks)
      .set({ lastSeenAt: at })
      .where(
        and(
          eq(trucks.id, truckId),
          // Typed operators, not a raw sql template: inside sql`` a JS Date
          // is serialised with toString() ("Wed Sep 16 2026 … (Central
          // European Summer Time)"), which Postgres cannot parse as
          // timestamptz. These use the column's own mapper.
          or(isNull(trucks.lastSeenAt), lt(trucks.lastSeenAt, at)),
        ),
      );
  }

  return {
    inserted: inserted.length,
    skippedUnknownTruck: skipped,
    newestRecordedAt: newest,
  };
}

/**
 * Heartbeat + cursor, persisted so a restart resumes instead of going cold.
 *
 * UPSERT, not UPDATE (§12.34). Migration 0001 seeds the singleton and nothing
 * else ever wrote one, so every path here was `update … where id = 1` — and an
 * UPDATE matching zero rows is not an error. Lose the row and three things
 * fail at once, silently:
 *
 *   - the cursor is never persisted, so every restart re-fetches from cold;
 *   - last_error is never recorded, so the offline banner has no cause;
 *   - newest_position_at stays null, and `isFeedStale(null, …)` is TRUE, so
 *     the console withdraws schedule colour from every row, permanently.
 *
 * None of it logs anything. The row came back the moment the worker ran again,
 * which is the property worth having: the feed's own health should not depend
 * on a row only a migration knows how to create.
 */
export async function recordSuccess(
  db: Db,
  cursor: string,
  newestPositionAt: Date | null,
): Promise<void> {
  const at = new Date();
  // Same Date-in-sql`` trap as above — pass an ISO string and cast.
  const newest = newestPositionAt
    ? {
        newestPositionAt: sql`greatest(coalesce(${feedHealth.newestPositionAt}, 'epoch'::timestamptz), ${newestPositionAt.toISOString()}::timestamptz)`,
      }
    : {};
  await db
    .insert(feedHealth)
    .values({
      id: 1,
      cursor,
      lastSuccessAt: at,
      lastError: null,
      updatedAt: at,
      ...(newestPositionAt ? { newestPositionAt } : {}),
    })
    .onConflictDoUpdate({
      target: feedHealth.id,
      // Inside DO UPDATE, `feed_health.newest_position_at` is the EXISTING
      // row, which is what makes greatest() keep the high-water mark.
      set: { cursor, lastSuccessAt: at, lastError: null, updatedAt: at, ...newest },
    });
}

export async function recordFailure(db: Db, message: string): Promise<void> {
  const at = new Date();
  const lastError = message.slice(0, 1000);
  await db
    .insert(feedHealth)
    .values({ id: 1, lastError, updatedAt: at })
    .onConflictDoUpdate({ target: feedHealth.id, set: { lastError, updatedAt: at } });
}

export async function readCursor(db: Db): Promise<string | null> {
  const [row] = await db
    .select({ cursor: feedHealth.cursor })
    .from(feedHealth)
    .where(eq(feedHealth.id, 1))
    .limit(1);
  return row?.cursor ?? null;
}

/** Trims the rolling window. Keeps each truck's newest fix regardless of age. */
export async function prunePositions(db: Db, log: Logger): Promise<number> {
  const cutoff = new Date(Date.now() - POSITION_RETENTION_DAYS * 86_400_000);
  const deleted = await db
    .delete(positions)
    .where(
      and(
        lt(positions.recordedAt, cutoff),
        sql`${positions.id} not in (
          select distinct on (truck_id) id from positions
          order by truck_id, recorded_at desc
        )`,
      ),
    )
    .returning({ id: positions.id });
  if (deleted.length > 0) {
    log.info('pruned old positions', {
      deleted: deleted.length,
      olderThan: cutoff.toISOString(),
    });
  }
  return deleted.length;
}

/**
 * Seeds trucks.active from position recency, once. Only ever runs against
 * trucks that have never been seen, so it cannot overwrite an admin's choice.
 */
export async function seedActiveFlags(
  db: Db,
  snapshot: VehicleStatsRow[],
  now: Date,
): Promise<{ active: number; inactive: number }> {
  let active = 0;
  let inactive = 0;
  for (const row of snapshot) {
    const fix = row.gps ? new Date(row.gps.time) : null;
    const isActive = isActiveByRecency(fix, now);
    if (isActive) active += 1;
    else inactive += 1;
    await db
      .update(trucks)
      .set({ active: isActive, ...(fix ? { lastSeenAt: fix } : {}) })
      .where(eq(trucks.samsaraVehicleId, row.id));
  }
  return { active, inactive };
}
