import { expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { describeDb, rolledBack } from '@/test/db';
import { makeRoutableLane } from '@/test/fleet';

/**
 * §12.73. The §12.61 shadow run concluded and its instrumentation is gone.
 *
 * Removing the writer is not the same as closing the table: a stale deploy,
 * a script, or a hand-typed INSERT would quietly reopen the experiment. So
 * migration 0019 makes the database refuse, and this holds it to that.
 */
/** Drizzle wraps the driver's error; Postgres's own message is the cause. */
async function refusal(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof Error ? cause.message : String(error);
  }
  return 'NOT REFUSED';
}

describeDb('the shadow run is closed (§12.73)', () => {
  it('route_shadow refuses a new row', async () => {
    const message = await refusal(
      rolledBack((tx) =>
        tx.execute(sql`
          insert into route_shadow
            (dest_lat, dest_lng, reason, straight_miles, ratio_cached, ratio_now, error_miles, provider)
          values (41.5, -88.1, 'truck-moved', 12, 1.2, 1.25, 0.6, 'here')`),
      ),
    );
    expect(message).toMatch(/route_shadow is closed/);
  });

  it('route_shadow refuses an update to the rows it keeps', async () => {
    // A kept row to update. The trigger refuses inserts too, so it is lifted
    // for this one insert only, inside a transaction that always rolls back.
    const message = await refusal(
      rolledBack(async (tx) => {
        await tx.execute(sql`alter table route_shadow disable trigger route_shadow_closed`);
        await tx.execute(sql`
          insert into route_shadow
            (dest_lat, dest_lng, reason, straight_miles, ratio_cached, ratio_now, error_miles, provider)
          values (41.5, -88.1, 'truck-moved', 12, 1.2, 1.25, 0.6, 'here')`);
        await tx.execute(sql`alter table route_shadow enable trigger route_shadow_closed`);
        return tx.execute(sql`update route_shadow set provider = 'x'`);
      }),
    );
    expect(message).toMatch(/route_shadow is closed/);
  });

  /**
   * The failure the first draft of 0019 had: a foreign key with ON DELETE
   * SET NULL updates route_shadow on every stop deletion, and the closing
   * trigger refused it — every load or stop deletion in the product broke.
   */
  it('closing it does not stop loads and stops from being deleted', async () => {
    const left = await rolledBack(async (tx) => {
      await makeRoutableLane(tx);
      await tx.execute(sql`delete from loads`);
      const [row] = (await tx.execute(
        sql`select (select count(*) from loads)::int as loads, (select count(*) from stops)::int as stops`,
      )) as unknown as { loads: number; stops: number }[];
      return row;
    });
    expect(left).toEqual({ loads: 0, stops: 0 });
  });

  it('the cache row no longer carries the shadow-only prev_lane_ratio', async () => {
    const cols = await rolledBack((tx) =>
      tx.execute(sql`
        select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'stop_routes'`),
    );
    const names = (cols as unknown as { column_name: string }[]).map((c) => c.column_name);
    expect(names).toContain('lane_ratio');
    expect(names).not.toContain('prev_lane_ratio');
  });
});
