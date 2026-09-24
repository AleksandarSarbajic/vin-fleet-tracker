import { and, eq, inArray, isNotNull, like, or, sql } from 'drizzle-orm';
import { loads, stops } from '@/db/schema';
import type { Db, Tx } from './audit';

/**
 * Finding and removing the seeded demo data (phase 6, item 6).
 *
 * Extracted out of `scripts/seed-demo.mts` so it can be TESTED rather than
 * trusted. The brief's instruction — clear the demo data before deploying — is
 * one command, and that command has been wrong before: §12.21 made an empty
 * load number a real state, the seed writes some to exercise it, and
 * `load_number LIKE 'DEMO-%'` does not match NULL. One demo load in seven
 * survived the clear, which is exactly the data that must not reach production
 * surviving the one command whose job is to remove it.
 *
 * A script cannot assert about itself. This can.
 */

/** Every demo load number starts with this. Some demo loads have none at all. */
export const DEMO_PREFIX = 'DEMO-';

/**
 * On EVERY seeded stop, including the ones whose load has no number.
 *
 * This is the marker that actually closes §12.21's hole: the load number is
 * optional and therefore cannot identify anything, but the note is written
 * unconditionally.
 */
export const DEMO_NOTE = 'DEMO SEED — safe to delete';

/**
 * The ids of every load this seed has ever written, and nothing else.
 *
 * Matched on the note as WELL as the number, by design. Either alone is
 * incomplete: a load with no number is invisible to the prefix, and a load
 * whose stops were all deleted by hand is invisible to the note.
 */
export async function findDemoLoads(db: Db | Tx): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: loads.id })
    .from(loads)
    .leftJoin(stops, eq(stops.loadId, loads.id))
    .where(or(like(loads.loadNumber, `${DEMO_PREFIX}%`), eq(stops.dispatcherNote, DEMO_NOTE)));
  return rows.map((r) => r.id);
}

export interface DemoRemnants {
  /** Loads still carrying a DEMO- number. */
  numberedLoads: number;
  /** Stops still carrying the seed note. */
  notedStops: number;
  /** Loads reachable from a noted stop, whatever their number. */
  loadsWithNotedStops: number;
}

/**
 * What is left. The answer that matters is all zeros.
 *
 * Counted three ways on purpose. A single count answers "did the query I just
 * ran delete what that query selected", which is true of any query and is the
 * shape of check that let §12.21's survivor through. These ask independently
 * whether anything recognisably demo remains.
 */
export async function countDemoRemnants(db: Db | Tx): Promise<DemoRemnants> {
  const [row] = (await db.execute(sql`
    select
      (select count(*) from loads where load_number like ${`${DEMO_PREFIX}%`})::int
        as numbered_loads,
      (select count(*) from stops where dispatcher_note = ${DEMO_NOTE})::int
        as noted_stops,
      (select count(distinct l.id) from loads l
         join stops s on s.load_id = l.id
        where s.dispatcher_note = ${DEMO_NOTE})::int
        as loads_with_noted_stops`)) as unknown as {
    numbered_loads: number;
    noted_stops: number;
    loads_with_noted_stops: number;
  }[];

  return {
    numberedLoads: row?.numbered_loads ?? 0,
    notedStops: row?.noted_stops ?? 0,
    loadsWithNotedStops: row?.loads_with_noted_stops ?? 0,
  };
}

export interface ClearResult {
  loadsDeleted: number;
  remnants: DemoRemnants;
}

/**
 * Removes the demo data and then CHECKS, rather than reporting what it tried.
 *
 * `stops` cascade from `loads`. Stops carrying the note whose load is not
 * itself demo are swept separately — the seed does not create those, but a
 * half-finished manual edit can, and leaving them would mean the count above
 * never reaches zero while the command keeps claiming success.
 */
export async function clearDemoData(db: Db | Tx): Promise<ClearResult> {
  const ids = await findDemoLoads(db);
  if (ids.length > 0) await db.delete(loads).where(inArray(loads.id, ids));

  // Orphaned noted stops, if any survived their load being re-pointed.
  await db
    .delete(stops)
    .where(and(eq(stops.dispatcherNote, DEMO_NOTE), isNotNull(stops.id)));

  return { loadsDeleted: ids.length, remnants: await countDemoRemnants(db) };
}

/** True when nothing recognisably demo is left. */
export const isClean = (r: DemoRemnants): boolean =>
  r.numberedLoads === 0 && r.notedStops === 0 && r.loadsWithNotedStops === 0;
