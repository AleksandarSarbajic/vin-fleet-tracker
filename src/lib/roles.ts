export type Role = 'admin' | 'dispatcher' | 'viewer';

/** Ranked least to most privileged. */
const RANK: Record<Role, number> = { viewer: 0, dispatcher: 1, admin: 2 };

/**
 * UI affordance only — never the authorisation check itself. Spec §12.14:
 * a viewer sees controls DISABLED with a tooltip, never hidden, because
 * hidden controls make people think the app is broken. The real check is
 * `requireRole` on the server, on every mutating route.
 */
export function can(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}

export function rankOf(role: Role): number {
  return RANK[role];
}
