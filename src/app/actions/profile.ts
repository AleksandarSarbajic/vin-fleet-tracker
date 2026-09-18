'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { profiles } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { DisplayName } from '@/lib/profile';
import { writeAudit } from '@/server/audit';

/**
 * Rename yourself (§12.45). A server action rather than a route handler:
 * `signOut` next to it already is one, and the header is server-rendered
 * props rather than anything in the query cache, so there is no optimistic
 * update for a route to serve.
 */

export interface RenameState {
  error: string | null;
  /** So the menu can say it worked rather than just closing. */
  savedName: string | null;
}

export async function updateDisplayName(
  _previous: RenameState,
  formData: FormData,
): Promise<RenameState> {
  /**
   * Always yourself. The action takes no user id at all — there is no
   * parameter for a caller to put someone else's in. Changing another
   * person's name is an admin act and would be a different action with its
   * own role check.
   */
  const user = await requireUser();

  const parsed = DisplayName.safeParse(formData.get('fullName'));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check that name.', savedName: null };
  }
  if (parsed.data === user.fullName) {
    // Not an error, and not a write: an audit row saying a name changed to
    // itself is noise in the one log that has to stay readable.
    return { error: null, savedName: user.fullName };
  }

  /**
   * Audited, and this is not ceremony. `full_name` is JOINed into override
   * attribution — fleet-query selects `p2.full_name as set_by_name` — so a
   * rename silently rewrites how every past override reads. That is history
   * changing with no record of the change, the same thing the driver merge
   * does when it repoints assignments, and that was only acceptable because
   * the audit entry names both rows.
   */
  await db.transaction(async (tx) => {
    await tx
      .update(profiles)
      .set({ fullName: parsed.data })
      .where(eq(profiles.id, user.id));

    await writeAudit(tx, {
      actorUserId: user.id,
      entity: 'profile',
      entityId: user.id,
      before: { fullName: user.fullName },
      after: { fullName: parsed.data },
    });
  });

  // The header is server-rendered, so the new name needs a fresh render
  // rather than a cache poke.
  revalidatePath('/', 'layout');
  return { error: null, savedName: parsed.data };
}
