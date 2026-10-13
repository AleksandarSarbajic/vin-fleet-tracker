import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { rateconAiReads } from '@/db/schema';
import type { Db, Tx } from '@/server/audit';

/**
 * The language-model reader's counts and daily caps
 * (docs/llm-reader-design.md §4). One row a read, COUNTS ONLY.
 *
 * A read is RESERVED before the vendor is called — the row is the read — and
 * its outcome lands after. A reservation that never finishes still counts:
 * a crashed read is not a free one.
 *
 * Atomic by an advisory lock held for the reservation's transaction. A count
 * then an insert without it lets two requests at cap−1 both through; the
 * lock makes them take turns (a test races two). The caps are compared,
 * never projected (§12.60). The day is the dispatch zone's calendar day,
 * reckoned by Postgres from the zone's name, so DST needs nothing from us.
 */

export type ReadOutcome = (typeof rateconAiReads.$inferSelect)['outcome'];
export type ReadVendor = (typeof rateconAiReads.$inferSelect)['vendor'];

/** Any fixed number: the one lock every reservation takes. */
const RESERVE_LOCK = 0x7263_6169; // "rcai"
const KEEP_DAYS = 90;

export async function reserveRead(
  db: Db | Tx,
  args: { userId: string; vendor: ReadVendor; linesSent: number; tz: string; userCap: number; dailyCap: number },
): Promise<{ id: string } | { capped: 'user' | 'daily' }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${RESERVE_LOCK})`);
    await tx.execute(sql`delete from ratecon_ai_reads where created_at < now() - make_interval(days => ${KEEP_DAYS})`);
    const [today] = (await tx.execute<{ mine: number; all: number }>(sql`
      select count(*) filter (where user_id = ${args.userId})::int as mine, count(*)::int as all
      from ratecon_ai_reads
      where (created_at at time zone ${args.tz})::date = (now() at time zone ${args.tz})::date`)) as unknown as {
      mine: number;
      all: number;
    }[];
    if (today!.mine >= args.userCap) return { capped: 'user' as const };
    if (today!.all >= args.dailyCap) return { capped: 'daily' as const };
    const [row] = await tx
      .insert(rateconAiReads)
      .values({ userId: args.userId, vendor: args.vendor, linesSent: args.linesSent })
      .returning({ id: rateconAiReads.id });
    return { id: row!.id };
  });
}

/** The read's outcome, and the vendor's token counts when it answered. */
export async function finishRead(
  db: Db | Tx,
  id: string,
  result: { outcome: Exclude<ReadOutcome, 'pending'>; inputTokens?: number; outputTokens?: number },
): Promise<void> {
  await db
    .update(rateconAiReads)
    .set({ outcome: result.outcome, inputTokens: result.inputTokens ?? null, outputTokens: result.outputTokens ?? null })
    .where(eq(rateconAiReads.id, id));
}
