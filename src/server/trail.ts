import { sql } from 'drizzle-orm';
import { TRAIL_WINDOW_MS, type TrailPoint } from '@/lib/trail';
import type { Db, Tx } from './audit';

/**
 * §14 feature 9 — half an hour of one truck's positions.
 *
 * One truck, because §14.3 made the trail selected-only: "thirty trails at
 * once would read as traffic, not history."
 *
 * ## One row per minute, decided here rather than in the client
 *
 * The feed returns several readings per vehicle per poll — one truck carried
 * five, five seconds apart (see `geo.ts`) — so half an hour of raw history is
 * anywhere between 60 and 300 rows, and the shape of that number is the
 * vendor's business, not the console's. `distinct on` a truncated minute caps
 * it at 30 whatever the feed does.
 *
 * A minute is far finer than it needs to be: `trailDots` buckets these into
 * five six-minute steps. The resolution is there so the dot in each step is
 * the NEWEST reading in it rather than whichever one survived a coarser cut.
 */
export async function loadTrail(
  db: Db | Tx,
  truckId: string,
  now = new Date(),
): Promise<TrailPoint[]> {
  const since = new Date(now.getTime() - TRAIL_WINDOW_MS);
  const rows = (await db.execute(sql`
    select distinct on (date_trunc('minute', p.recorded_at))
           p.lat, p.lng, p.recorded_at
    from positions p
    where p.truck_id = ${truckId}::uuid
      and p.recorded_at >= ${since.toISOString()}
      and p.recorded_at <= ${now.toISOString()}
    order by date_trunc('minute', p.recorded_at) desc, p.recorded_at desc
  `)) as unknown as { lat: number; lng: number; recorded_at: string | Date }[];

  return rows.map((r) => ({
    lat: r.lat,
    lng: r.lng,
    recordedAt:
      r.recorded_at instanceof Date ? r.recorded_at.toISOString() : r.recorded_at,
  }));
}
