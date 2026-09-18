import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { feedHealth } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import { recordFailure, recordSuccess } from './ingest';
import type { Db } from '@/server/audit';

/**
 * §12.34. The singleton the worker has to be able to recreate.
 *
 * Migration 0001 seeds `feed_health` and nothing else ever wrote one, so every
 * worker path was `update … where id = 1`. An UPDATE matching zero rows is not
 * an error: lose the row and the cursor stops persisting, `last_error` stops
 * recording, and `isFeedStale(null, …)` returns true forever — the console
 * withdraws schedule colour from every row and nothing says why.
 *
 * The test database starts empty (§12.32), so it is in exactly that state
 * without having to arrange it.
 */
describeDb('feed_health when the row is missing', () => {
  it('has no row to begin with, which is the case being tested', async () => {
    const rows = await rolledBack((tx) => tx.select().from(feedHealth));
    expect(rows).toEqual([]);
  });

  it('recordSuccess creates the singleton rather than silently doing nothing', async () => {
    const newest = new Date('2026-09-18T08:26:50.519Z');
    const row = await rolledBack(async (tx) => {
      await recordSuccess(tx as unknown as Db, 'cursor-1', newest);
      const [found] = await tx.select().from(feedHealth).where(eq(feedHealth.id, 1));
      return found;
    });
    expect(row?.id).toBe(1);
    expect(row?.cursor).toBe('cursor-1');
    expect(row?.newestPositionAt?.toISOString()).toBe(newest.toISOString());
    expect(row?.lastError).toBeNull();
  });

  it('recordFailure creates it too, so the banner has a cause', async () => {
    const row = await rolledBack(async (tx) => {
      await recordFailure(tx as unknown as Db, 'samsara 401');
      const [found] = await tx.select().from(feedHealth).where(eq(feedHealth.id, 1));
      return found;
    });
    expect(row?.id).toBe(1);
    expect(row?.lastError).toBe('samsara 401');
  });

  it('keeps the high-water mark when a later poll carries an older fix', async () => {
    const newer = new Date('2026-09-18T08:30:00.000Z');
    const older = new Date('2026-09-18T08:00:00.000Z');
    const row = await rolledBack(async (tx) => {
      await recordSuccess(tx as unknown as Db, 'c1', newer);
      // Samsara can return a stale reading for a truck that has not moved.
      // greatest() must not let it drag the feed's health backwards.
      await recordSuccess(tx as unknown as Db, 'c2', older);
      const [found] = await tx.select().from(feedHealth).where(eq(feedHealth.id, 1));
      return found;
    });
    expect(row?.newestPositionAt?.toISOString()).toBe(newer.toISOString());
    expect(row?.cursor).toBe('c2');
  });

  it('clears a previous error on the next success', async () => {
    const row = await rolledBack(async (tx) => {
      await recordFailure(tx as unknown as Db, 'samsara 500');
      await recordSuccess(tx as unknown as Db, 'c3', new Date());
      const [found] = await tx.select().from(feedHealth).where(eq(feedHealth.id, 1));
      return found;
    });
    expect(row?.lastError).toBeNull();
  });

  it('never writes a second row — the singleton check would reject it anyway', async () => {
    const count = await rolledBack(async (tx) => {
      await recordSuccess(tx as unknown as Db, 'c1', new Date());
      await recordFailure(tx as unknown as Db, 'boom');
      await recordSuccess(tx as unknown as Db, 'c2', new Date());
      return (await tx.select().from(feedHealth)).length;
    });
    expect(count).toBe(1);
  });
});
