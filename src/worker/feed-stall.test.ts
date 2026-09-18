import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { feedHealth } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import { STALL_SECONDS, recordSuccess } from './ingest';
import type { Db, Tx } from '@/server/audit';

/**
 * §12.39. A missed cycle has to outlive its own recovery.
 *
 * The worker stalled eleven times in one day — 5.8 to 51.1 minutes, 329
 * minutes in total — and every stall vanished on recovery: Samsara returned
 * the backlog, `newest_position_at` jumped forward, the staleness banner
 * cleared, and the next `recordSuccess` wiped `last_error`. Afterwards the
 * board looked healthy and nothing recorded that 5.5 hours of a 9.5 hour day
 * had gone unobserved.
 */

const as = (tx: Tx) => tx as unknown as Db;
const read = async (tx: Tx) =>
  (await tx.select().from(feedHealth).where(eq(feedHealth.id, 1)))[0];

describeDb('a stall survives the recovery that hid it', () => {
  it('records the gap, the worst one, and the cycles missed', async () => {
    const row = await rolledBack(async (tx) => {
      await recordSuccess(as(tx), 'c1', new Date(), 0);
      // 34 minutes, the gap that swallowed truck 116's dwell.
      await recordSuccess(as(tx), 'c2', new Date(), 34 * 60);
      return read(tx);
    });

    expect(row?.longestStallSeconds).toBe(34 * 60);
    expect(row?.longestStallAt).toBeInstanceOf(Date);
    // 30-second cycles.
    expect(row?.missedCycles).toBe(68);
    // And the thing that hid it: the error really is cleared on success.
    expect(row?.lastError).toBeNull();
  });

  it('accumulates, so many short stalls are as visible as one long one', async () => {
    const row = await rolledBack(async (tx) => {
      for (const minutes of [10.6, 36.3, 28.4, 26.6]) {
        await recordSuccess(as(tx), 'c', new Date(), minutes * 60);
      }
      return read(tx);
    });
    expect(row?.missedCycles).toBe(
      [10.6, 36.3, 28.4, 26.6].reduce((n, m) => n + Math.floor((m * 60) / 30), 0),
    );
    // The worst is kept, not the latest.
    expect(row?.longestStallSeconds).toBe(Math.round(36.3 * 60));
  });

  it('keeps the worst even after healthy polls follow', async () => {
    const row = await rolledBack(async (tx) => {
      await recordSuccess(as(tx), 'c1', new Date(), 20 * 60);
      for (let i = 0; i < 5; i += 1) await recordSuccess(as(tx), 'c', new Date(), 30);
      return read(tx);
    });
    expect(row?.longestStallSeconds).toBe(20 * 60);
    // No live stall.
    expect(row?.stallStartedAt).toBeNull();
  });

  it('does not treat ordinary jitter as a stall', async () => {
    const row = await rolledBack(async (tx) => {
      // A poll that took a little longer than the interval is not an outage.
      await recordSuccess(as(tx), 'c1', new Date(), STALL_SECONDS - 1);
      return read(tx);
    });
    expect(row?.missedCycles).toBe(0);
    expect(row?.longestStallSeconds).toBeNull();
  });
});
