import { z } from 'zod';

/**
 * The account's own two rules (§12.45). Pure, and shared by the server action
 * and the form — the same reason `StopEdit` is shared, and the same failure
 * mode if it were not.
 */

/**
 * The circle in the header. Initials only: no profile picture, and no upload
 * path, because a Storage bucket and its RLS policies are not worth writing to
 * tell five accounts apart.
 *
 * First and last, not first-two-words — "Mary Anne Fitzgerald" is MF, not MA.
 * A single word gives its first two letters, which is what a mononym or a
 * service account ends up with.
 */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (first === undefined) return '??';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1] ?? '';
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}

/**
 * The only profile field anyone can change about themselves.
 *
 * `role` is admin-only and set elsewhere; `email` is the auth identity and
 * changing it is an auth flow, not a profile edit.
 *
 * Trimmed and non-empty, and nothing more. A name is not a format — the same
 * argument as the load number (§12.21). The cap matches `city`, and exists so
 * a paste accident cannot write a megabyte into a column the header renders.
 */
export const DisplayName = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(120, 'A name cannot be longer than 120 characters.');

export const ProfileUpdate = z.object({ fullName: DisplayName }).strict();
export type ProfileUpdate = z.infer<typeof ProfileUpdate>;
