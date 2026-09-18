import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { feedHealth, feedStalls } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import { STALL_SECONDS, recordSuccess, summarizeStalls, utcDayStart } from './ingest';
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

/* -------------------------------------------------------------------------
 * §12.42 — and the day it happened on
 *
 * The counters above are cumulative: they answer "has it ever been broken"
 * and cannot answer "was it broken yesterday", which is the question actually
 * worth asking the morning after a fix.
 * ---------------------------------------------------------------------- */

const DAY_MS = 86_400_000;

/**
 * Plants the feed_health singleton with a chosen start-of-logging.
 *
 * An UPDATE is not enough: globalSetup truncates, so on a fresh test database
 * there is no row to update and the summary would then be reading the
 * "nothing has ever been recorded" case by accident rather than on purpose.
 */
const beganLoggingAt = (tx: Tx, since: Date) =>
  tx
    .insert(feedHealth)
    .values({ id: 1, stallLogSince: since })
    .onConflictDoUpdate({ target: feedHealth.id, set: { stallLogSince: since } });

describeDb('one row per stall, and the day it belongs to', () => {
  it('writes a row whose window matches the gap that was missed', async () => {
    const rows = await rolledBack(async (tx) => {
      await recordSuccess(as(tx), 'c1', new Date(), 0);
      await recordSuccess(as(tx), 'c2', new Date(), 34 * 60);
      return tx.select().from(feedStalls);
    });

    expect(rows).toHaveLength(1);
    const [stall] = rows;
    expect(stall?.seconds).toBe(34 * 60);
    expect(stall?.missedCycles).toBe(68);
    // started_at is derived backwards from the recovery, so the row states
    // the window the fleet was unobserved rather than only its length.
    const spanMs = (stall?.endedAt.getTime() ?? 0) - (stall?.startedAt.getTime() ?? 0);
    expect(Math.round(spanMs / 1000)).toBe(34 * 60);
  });

  it('writes nothing for ordinary jitter', async () => {
    const rows = await rolledBack(async (tx) => {
      await recordSuccess(as(tx), 'c1', new Date(), STALL_SECONDS - 1);
      return tx.select().from(feedStalls);
    });
    expect(rows).toHaveLength(0);
  });

  it('keeps every stall, so the distribution survives (§12.39 was eleven)', async () => {
    const minutes = [10.6, 36.3, 28.4, 26.6, 51.1, 5.8];
    const summary = await rolledBack(async (tx) => {
      await beganLoggingAt(tx, new Date(Date.now() - 30 * DAY_MS));
      for (const m of minutes) await recordSuccess(as(tx), 'c', new Date(), m * 60);
      return summarizeStalls(as(tx), utcDayStart(new Date()));
    });

    expect(summary.stalls).toBe(minutes.length);
    expect(summary.longestSeconds).toBe(Math.round(51.1 * 60));
    expect(summary.totalSeconds).toBe(
      minutes.reduce((n, m) => n + Math.round(m * 60), 0),
    );
    expect(summary.complete).toBe(true);
  });

  it('counts only the day asked for', async () => {
    const at = new Date();
    const summary = await rolledBack(async (tx) => {
      await beganLoggingAt(tx, new Date(at.getTime() - 30 * DAY_MS));
      // Noon on each of three consecutive UTC days.
      for (const offset of [0, 1, 2]) {
        const endedAt = new Date(utcDayStart(at, offset).getTime() + 12 * 3_600_000);
        await tx.insert(feedStalls).values({
          startedAt: new Date(endedAt.getTime() - 600_000),
          endedAt,
          seconds: 600 * (offset + 1),
          missedCycles: 20 * (offset + 1),
        });
      }
      return summarizeStalls(as(tx), utcDayStart(at, 1));
    });

    expect(summary.stalls).toBe(1);
    expect(summary.longestSeconds).toBe(1200);
    expect(summary.missedCycles).toBe(40);
    expect(summary.day).toBe(utcDayStart(at, 1).toISOString().slice(0, 10));
  });

  /**
   * The zero that would have lied. On the first morning after this table
   * ships, the day before it has no rows — and reporting "0 stalls" for the
   * day that in fact lost 5.5 hours is worse than reporting nothing.
   */
  it('refuses to call an unrecorded day a clean one', async () => {
    const summary = await rolledBack(async (tx) => {
      await beganLoggingAt(tx, new Date());
      return summarizeStalls(as(tx), utcDayStart(new Date(), 1));
    });

    expect(summary.stalls).toBe(0);
    expect(summary.complete).toBe(false);
  });

  it('calls a day complete once logging predates it', async () => {
    const summary = await rolledBack(async (tx) => {
      await beganLoggingAt(tx, new Date(Date.now() - 3 * DAY_MS));
      return summarizeStalls(as(tx), utcDayStart(new Date(), 1));
    });

    expect(summary.stalls).toBe(0);
    expect(summary.complete).toBe(true);
  });
  /**
   * §12.34 recreated this row once already. A missing singleton means nothing
   * has been recorded, which is the same answer as "logging started today"
   * and emphatically not "a quiet day".
   */
  it('treats a missing feed_health row as unrecorded, not as clean', async () => {
    const summary = await rolledBack(async (tx) => {
      await tx.delete(feedHealth).where(eq(feedHealth.id, 1));
      return summarizeStalls(as(tx), utcDayStart(new Date(), 1));
    });
    expect(summary.complete).toBe(false);
  });
});
