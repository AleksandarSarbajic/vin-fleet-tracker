import { expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLog } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import { makeDispatcher } from '@/test/fleet';
import { AUDIT_ENTITIES, writeAudit } from './audit';

/**
 * The audit entity set is closed on purpose, and its own comment says why: a
 * typo here is invisible. It writes happily, and the row is simply never found
 * again by the screen that eventually looks for it.
 *
 * So adding `'profile'` to it (§12.45) is exactly the kind of change that
 * deserves an assertion rather than a reading — the failure mode is silence.
 */

describeDb('the audit entity set', () => {
  it('accepts a profile rename, which is a new member (§12.45)', async () => {
    const written = await rolledBack(async (tx) => {
      // An actor has to exist: actor_user_id references profiles, and a
      // profile only exists because the signup trigger made one.
      const actor = await makeDispatcher(tx, 'Before Name');

      await writeAudit(tx, {
        actorUserId: actor.id,
        entity: 'profile',
        entityId: actor.id,
        before: { fullName: 'Before Name' },
        after: { fullName: 'After Name' },
      });

      return tx
        .select({ entity: auditLog.entity, before: auditLog.before, after: auditLog.after })
        .from(auditLog)
        .where(and(eq(auditLog.entity, 'profile'), eq(auditLog.entityId, actor.id)));
    });

    expect(written).toHaveLength(1);
    // Both sides, because the point of auditing a rename is that the OLD name
    // is how every past override still reads in anyone's memory.
    expect(written[0]?.before).toEqual({ fullName: 'Before Name' });
    expect(written[0]?.after).toEqual({ fullName: 'After Name' });
  });

  it('still refuses an entity that is not in the set', async () => {
    await expect(
      rolledBack(async (tx) => {
        await writeAudit(tx, {
          actorUserId: null,
          // The typo this closed set exists to catch.
          entity: 'profiles' as 'profile',
          entityId: '44444444-4444-4444-8444-444444444444',
          before: null,
          after: null,
        });
      }),
    ).rejects.toThrow();
  });

  it('names every entity exactly once', () => {
    expect(new Set(AUDIT_ENTITIES).size).toBe(AUDIT_ENTITIES.length);
  });
});
