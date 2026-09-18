import { z } from 'zod';
import { auditLog } from '@/db/schema';
import type { createPooledDb } from '@/db/connection';

/**
 * Every dispatcher edit writes here. When a delivery time is wrong at 3am,
 * someone has to be able to see who changed it and what it was before.
 *
 * Nothing reads this back in v1 — the audit log VIEW is deferred to v2
 * (§12.15). That is the reason to be strict about what goes in now: the rows
 * written today are the only ones that screen will ever have.
 */

export type Db = ReturnType<typeof createPooledDb>['db'];
/** A transaction handle. Same query surface as `db`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type Writer = Db | Tx;

/**
 * The entity names are a closed set, because a typo here is invisible: it
 * writes happily and the row is simply never found again by the screen that
 * eventually looks for it.
 */
export const AUDIT_ENTITIES = [
  'assignment',
  'stop',
  'load',
  'truck',
  'override',
  'driver',
  /** §12.45: a rename rewrites how every past override reads. */
  'profile',
] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

export const AuditEntry = z.object({
  /** Null only for a system action. Every dispatcher edit carries one. */
  actorUserId: z.string().uuid().nullable(),
  entity: z.enum(AUDIT_ENTITIES),
  entityId: z.string().uuid(),
  /** The row as it was. Null on a create. */
  before: z.unknown(),
  /** The row as it is now. Null on a delete. */
  after: z.unknown(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

/**
 * Writes one or more entries. Always call this INSIDE the transaction that
 * made the change — an audit row committed separately from the change it
 * describes is worse than none, because it is believed.
 *
 * Bulk edits write one row PER ENTITY sharing a `batch` id, not one row for
 * the batch. The question a dispatcher asks is "who put this driver on this
 * truck", never "what happened in batch 7"; per-truck history has to be
 * complete on its own. The batch id is there for the rarer second question.
 */
export async function writeAudit(
  writer: Writer,
  entries: AuditEntry | AuditEntry[],
): Promise<void> {
  const list = (Array.isArray(entries) ? entries : [entries]).map((e) => AuditEntry.parse(e));
  if (list.length === 0) return;

  await writer.insert(auditLog).values(
    list.map((e) => ({
      actorUserId: e.actorUserId,
      entity: e.entity,
      entityId: e.entityId,
      before: e.before ?? null,
      after: e.after ?? null,
    })),
  );
}

/** A batch id for a multi-row edit, carried inside `after` on every row. */
export function newBatchId(): string {
  return crypto.randomUUID();
}
