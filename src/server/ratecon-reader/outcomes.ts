import 'server-only';
import { and, eq } from 'drizzle-orm';
import { rateconAiOutcomeFields, rateconAiOutcomes, rateconAiReads } from '@/db/schema';
import type { Db, Tx } from '@/server/audit';
import type { FieldCounts } from '@/lib/ratecon/outcome-codes';

/**
 * What the dispatcher did with an AI read (docs/llm-reader-design.md §4;
 * Alex, 2026-10-14): COUNTS ONLY, once per read.
 *
 * The read must be the caller's own and must have answered (`ok`): a read id
 * that is anyone else's, that does not exist, or whose pair failed is
 * `unknown_read`, the same to all three. The outcome's parent row is the
 * once-per-read marker (its primary key is the read): inserted
 * `on conflict do nothing`, and only a post that inserted it stores the
 * counts and the layout fingerprint, in the same transaction. A second post,
 * or a second at the same moment, stores nothing.
 */

export type RecordResult = 'recorded' | 'already' | 'unknown_read';

export async function recordOutcome(
  db: Db | Tx,
  args: { userId: string; readId: string; fields: readonly FieldCounts[]; layout?: readonly string[] },
): Promise<RecordResult> {
  return db.transaction(async (tx) => {
    const [mine] = await tx
      .select({ id: rateconAiReads.id })
      .from(rateconAiReads)
      .where(and(eq(rateconAiReads.id, args.readId), eq(rateconAiReads.userId, args.userId), eq(rateconAiReads.outcome, 'ok')));
    if (!mine) return 'unknown_read' as const;
    // The layout fingerprint (hashes only; the route has parsed it strictly) goes on the same row as the marker:
    // whichever post inserts it stores its layout, and a second post stores nothing.
    const first = await tx
      .insert(rateconAiOutcomes)
      .values({ readId: args.readId, layout: [...(args.layout ?? [])] })
      .onConflictDoNothing()
      .returning({ readId: rateconAiOutcomes.readId });
    if (first.length === 0) return 'already' as const;
    await tx.insert(rateconAiOutcomeFields).values(
      args.fields.map((f) => ({
        readId: args.readId,
        field: f.field,
        kept: f.kept,
        changed: f.changed,
        cleared: f.cleared,
        blankFilled: f.blankFilled,
        blankLeft: f.blankLeft,
      })),
    );
    return 'recorded' as const;
  });
}

