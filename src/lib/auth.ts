import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { profiles } from '@/db/schema';
import { createClient } from '@/lib/supabase/server';

import { rankOf, type Role } from '@/lib/roles';

export type { Role };

export interface SessionUser {
  id: string;
  email: string | null;
  fullName: string;
  role: Role;
}

/**
 * The signed-in user, or null.
 *
 * The role is read from OUR profiles table, never from a JWT claim the
 * client could shape. `getUser()` revalidates the token with Supabase rather
 * than trusting the cookie, which is why it is used instead of getSession().
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const [profile] = await db
    .select({ fullName: profiles.fullName, role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, data.user.id))
    .limit(1);

  // A user with no profile row is a broken invite, not a viewer. Treating it
  // as a valid low-privilege session would hide the problem.
  if (!profile) return null;

  return {
    id: data.user.id,
    email: data.user.email ?? null,
    fullName: profile.fullName,
    role: profile.role,
  };
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Throws unless signed in. Call at the top of every mutating route. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError('Not signed in', 401);
  return user;
}

/** Throws unless signed in AND at least `minimum`. */
export async function requireRole(minimum: Role): Promise<SessionUser> {
  const user = await requireUser();
  if (rankOf(user.role) < rankOf(minimum)) {
    throw new AuthError(`Requires ${minimum}; ${user.fullName} is ${user.role}`, 403);
  }
  return user;
}
