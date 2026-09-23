import { eq, inArray } from 'drizzle-orm';
import { stops } from '@/db/schema';
import type { BulkNoteInput, BulkOverrideInput } from '@/lib/override';
import { setOverride } from './override';
import { writeAudit, type Db, type Tx } from './audit';

/**
 * Bulk override and bulk note (§14, feature 2).
 *
 * ## One transaction, not N requests
 *
 * The obvious build is a loop of `POST /api/overrides` from the client. It is
 * wrong for a reason §12.28 already settled for the stop form: a dispatcher
 * forcing a status on four trucks is making ONE claim, and four requests can
 * half-succeed. The dispatcher then has two of four overridden, no record of
 * which, and a board that looks like they changed their mind partway.
 *
 * So it is one route, one transaction, and either every stop takes the
 * override or none does.
 *
 * `setOverride` opens its own transaction. Passing it the outer `tx` nests it
 * as a savepoint, which is what makes reuse safe here — the alternative,
 * copying its expiry resolution and audit write, is how the two would
 * eventually disagree about what an override is.
 */

export class BulkError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = 'BulkError';
  }
}

/** Refuses the whole act if any stop has gone, rather than silently doing fewer. */
async function requireAll(tx: Tx, stopIds: string[]): Promise<void> {
  const found = await tx
    .select({ id: stops.id })
    .from(stops)
    .where(inArray(stops.id, stopIds));
  if (found.length === stopIds.length) return;
  const missing = stopIds.length - found.length;
  throw new BulkError(
    `${missing} of these ${stopIds.length} stops no longer exist. Nothing was changed — refresh and try again.`,
    'stopIds',
  );
}

export async function bulkOverride(
  db: Db,
  input: {
    actorUserId: string | null;
    dispatchTz: string;
    override: BulkOverrideInput;
  },
): Promise<{ applied: number }> {
  const { stopIds, ...fields } = input.override;
  return db.transaction(async (tx) => {
    await requireAll(tx, stopIds);
    for (const stopId of stopIds) {
      await setOverride(tx, {
        actorUserId: input.actorUserId,
        dispatchTz: input.dispatchTz,
        override: { stopId, ...fields },
      });
    }
    return { applied: stopIds.length };
  });
}

export async function bulkNote(
  db: Db,
  input: { actorUserId: string | null; note: BulkNoteInput },
): Promise<{ applied: number }> {
  const { stopIds, note } = input.note;
  return db.transaction(async (tx) => {
    await requireAll(tx, stopIds);

    /**
     * Read before write, per stop, so the audit carries what the note
     * REPLACED. A bulk note overwrites whatever was there, and without the
     * before-value the log records that something changed without recording
     * what was lost — which is the state §9.5 built the log to avoid.
     */
    const before = await tx
      .select({ id: stops.id, dispatcherNote: stops.dispatcherNote })
      .from(stops)
      .where(inArray(stops.id, stopIds));
    const previous = new Map(before.map((r) => [r.id, r.dispatcherNote]));

    for (const stopId of stopIds) {
      await tx.update(stops).set({ dispatcherNote: note }).where(eq(stops.id, stopId));
    }

    await writeAudit(
      tx,
      stopIds.map((stopId) => ({
        actorUserId: input.actorUserId,
        entity: 'stop' as const,
        entityId: stopId,
        before: { dispatcherNote: previous.get(stopId) ?? null },
        after: { dispatcherNote: note },
      })),
    );

    return { applied: stopIds.length };
  });
}
