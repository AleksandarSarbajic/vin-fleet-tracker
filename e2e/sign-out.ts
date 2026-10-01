/**
 * Signs the e2e account out everywhere — and never anyone else.
 *
 * Every e2e run signs in against the PRODUCTION Supabase project (the app under
 * test talks to it for auth), and nothing ever signed out, so by 2026-10-01
 * the e2e account held 100 live sessions. Supabase's global logout ends every
 * session of the user whose access token it is given; this module is the only
 * thing that calls it, and it refuses unless that token's subject is exactly
 * `E2E_USER_ID`.
 *
 * The check happens BEFORE any request that could change anything:
 *
 *   - a stored session (the cookie `auth.setup.ts` saved) is decoded locally
 *     and its `sub` compared before it is refreshed or used;
 *   - only when there is no stored session, or the stored one is STALE (a
 *     previous run already signed it out, so the logout answers 401/403),
 *     does it sign in with the e2e credentials — a request that has to happen
 *     before the user id is known — and then the same comparison gates the
 *     logout. Any other failure is reported, not retried.
 *
 * No token, password or email is ever returned or logged; a refusal names
 * the first eight characters of the two ids, nothing more.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SignOutEnv {
  supabaseUrl: string | undefined;
  apiKey: string | undefined;
  /** E2E_USER_ID: the only account this may ever sign out. */
  expectedUserId: string | undefined;
  email: string | undefined;
  password: string | undefined;
}

export interface StoredSession {
  accessToken: string;
  refreshToken: string | null;
}

export type SignOutResult =
  | { done: true; userId: string; via: 'stored session' | 'fresh sign-in' }
  | { done: false; reason: string };

/** The one place the environment is read: E2E_USER_ID is the target, always. */
export function envFromProcess(env: Record<string, string | undefined>): SignOutEnv {
  return {
    supabaseUrl: env['NEXT_PUBLIC_SUPABASE_URL'],
    apiKey: env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'],
    expectedUserId: env['E2E_USER_ID'],
    email: env['E2E_EMAIL'],
    password: env['E2E_PASSWORD'],
  };
}

/** A JWT's subject and expiry, read locally. Not verified — Supabase does that. */
export function jwtClaims(token: string): { sub: string | null; exp: number | null } {
  const payload = token.split('.')[1];
  if (!payload) return { sub: null, exp: null };
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub?: unknown;
      exp?: unknown;
    };
    return {
      sub: typeof claims.sub === 'string' ? claims.sub : null,
      exp: typeof claims.exp === 'number' ? claims.exp : null,
    };
  } catch {
    // Not a JWT: it names no user, which `refusal` turns into a refusal.
    return { sub: null, exp: null };
  }
}

/** Why this token must not be used, or null when it is the e2e account's. */
export function refusal(
  expectedUserId: string | undefined,
  tokenSub: string | null,
): string | null {
  if (!expectedUserId || !UUID.test(expectedUserId)) {
    return 'E2E_USER_ID is not set to a user id. Refusing to sign anyone out.';
  }
  if (tokenSub === null) return 'The session names no user. Refusing to sign anyone out.';
  if (tokenSub.toLowerCase() !== expectedUserId.toLowerCase()) {
    return (
      `The session belongs to ${tokenSub.slice(0, 8)}…, not the e2e account ` +
      `${expectedUserId.slice(0, 8)}…. Refusing to sign it out.`
    );
  }
  return null;
}

/**
 * The session `auth.setup.ts` saved: Supabase's `sb-<ref>-auth-token` cookie,
 * `base64-` + JSON, split into `.0`, `.1`… chunks when long.
 */
export function storedSession(state: unknown): StoredSession | null {
  const cookies = (state as { cookies?: { name: string; value: string }[] } | null)
    ?.cookies;
  if (!Array.isArray(cookies)) return null;
  const parts = cookies
    .filter((c) => /^sb-[a-z0-9]+-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  if (parts.length === 0) return null;
  const raw = parts.map((c) => c.value).join('');
  try {
    const json = raw.startsWith('base64-')
      ? Buffer.from(raw.slice('base64-'.length), 'base64url').toString('utf8')
      : decodeURIComponent(raw);
    const session = JSON.parse(json) as {
      access_token?: unknown;
      refresh_token?: unknown;
    };
    if (typeof session.access_token !== 'string') return null;
    return {
      accessToken: session.access_token,
      refreshToken:
        typeof session.refresh_token === 'string' ? session.refresh_token : null,
    };
  } catch {
    // An unreadable cookie is no session; the caller falls back to signing in.
    return null;
  }
}

async function tokenRequest(
  env: SignOutEnv,
  fetchImpl: typeof fetch,
  grant: 'refresh_token' | 'password',
  body: Record<string, string>,
): Promise<string | null> {
  const response = await fetchImpl(
    `${env.supabaseUrl}/auth/v1/token?grant_type=${grant}`,
    {
      method: 'POST',
      headers: { apikey: env.apiKey!, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) return null;
  const data = (await response.json()) as { access_token?: unknown };
  return typeof data.access_token === 'string' ? data.access_token : null;
}

export async function signOutE2eAccount(
  env: SignOutEnv,
  options: { stored: StoredSession | null; fetchImpl?: typeof fetch; now?: Date },
): Promise<SignOutResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);

  // Nothing is sent anywhere unless the target is a real user id.
  const unset = refusal(env.expectedUserId, env.expectedUserId ?? null);
  if (unset) return { done: false, reason: unset };
  if (!env.supabaseUrl || !env.apiKey) {
    return { done: false, reason: 'The Supabase URL or publishable key is not set.' };
  }

  /**
   * The gate every logout passes through, whichever way the token was
   * obtained: its subject must be exactly E2E_USER_ID, or nothing is sent.
   */
  const logoutWith = async (
    token: string,
    via: 'stored session' | 'fresh sign-in',
  ): Promise<SignOutResult & { status?: number }> => {
    const sub = jwtClaims(token).sub;
    const refused = refusal(env.expectedUserId, sub);
    if (refused) return { done: false, reason: refused };
    const response = await fetchImpl(`${env.supabaseUrl}/auth/v1/logout?scope=global`, {
      method: 'POST',
      headers: { apikey: env.apiKey!, authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      return {
        done: false,
        reason: `Supabase refused the global sign-out (${response.status}).`,
        status: response.status,
      };
    }
    return { done: true, userId: sub!, via };
  };

  if (options.stored) {
    // Checked BEFORE it is refreshed or used.
    const before = refusal(env.expectedUserId, jwtClaims(options.stored.accessToken).sub);
    if (before) return { done: false, reason: before };
    const { exp } = jwtClaims(options.stored.accessToken);
    const token =
      exp !== null && exp > nowSeconds + 30
        ? options.stored.accessToken
        : options.stored.refreshToken
          ? await tokenRequest(env, fetchImpl, 'refresh_token', {
              refresh_token: options.stored.refreshToken,
            })
          : null;
    if (token !== null) {
      const result = await logoutWith(token, 'stored session');
      /**
       * A STALE stored session: a previous run's teardown already signed it
       * out, so its token is dead (401/403) — the file on disk outlived it.
       * Fall through to a fresh sign-in, which passes the same gate. Any
       * other outcome, a refusal included, is final.
       */
      if (result.done || (result.status !== 401 && result.status !== 403)) {
        return strip(result);
      }
    }
  }

  if (!env.email || !env.password) {
    return { done: false, reason: 'No usable stored session and no e2e credentials.' };
  }
  const fresh = await tokenRequest(env, fetchImpl, 'password', {
    email: env.email,
    password: env.password,
  });
  if (fresh === null) return { done: false, reason: 'The e2e sign-in was refused.' };
  return strip(await logoutWith(fresh, 'fresh sign-in'));
}

/** The status is internal to the fallback; the result says only what happened. */
function strip(result: SignOutResult & { status?: number }): SignOutResult {
  if (result.done) return result;
  return { done: false, reason: result.reason };
}
