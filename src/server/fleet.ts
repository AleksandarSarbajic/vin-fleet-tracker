import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { feedHealth } from '@/db/schema';
import { serverEnv } from '@/env/server';
import { STATUS_DEFAULTS, isFeedStale, type StatusConfig } from '@/lib/status';
import { LATEST_POSITION_SQL, applyStatus, parseFleetRows } from './fleet-query';

export type { FleetRow } from './fleet-query';

/** One config object, assembled once. `dispatchTz` is the only env-derived part. */
export const statusConfig: StatusConfig = {
  ...STATUS_DEFAULTS,
  dispatchTz: serverEnv.DISPATCH_TZ,
};

export interface FleetPayload {
  fleet: Awaited<ReturnType<typeof parseFleetRows>>;
  fetchedAt: string;
  /**
   * §5.9, a hard requirement. When the FEED is stale the client withdraws
   * schedule colour from every row — a green row built on nine-minute-old GPS
   * is worse than no row. Read from feed_health, which the worker maintains;
   * deriving it from the rows on screen would only ever see the trucks that
   * are already in the payload.
   */
  feedStale: boolean;
  feedNewestAt: string | null;
}

export async function loadFleet(now = new Date()): Promise<FleetPayload> {
  const [result, health] = await Promise.all([
    db.execute(LATEST_POSITION_SQL),
    db
      .select({ newestPositionAt: feedHealth.newestPositionAt })
      .from(feedHealth)
      .where(eq(feedHealth.id, 1))
      .limit(1),
  ]);

  // Validated at the boundary, exactly like every Samsara response.
  const rows = parseFleetRows(result);

  // A typed select applies the column decoders, so this one IS a Date —
  // unlike everything arriving through db.execute.
  const newestPositionAt = health[0]?.newestPositionAt ?? null;

  return {
    fleet: applyStatus(rows, statusConfig, now),
    fetchedAt: now.toISOString(),
    feedStale: isFeedStale(newestPositionAt?.toISOString() ?? null, statusConfig, now),
    feedNewestAt: newestPositionAt?.toISOString() ?? null,
  };
}
