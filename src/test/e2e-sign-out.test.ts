import { describe, expect, it, vi } from 'vitest';
import { runTeardown } from '../../e2e/global-teardown';
import {
  envFromProcess,
  jwtClaims,
  refusal,
  signOutE2eAccount,
  storedSession,
  type SignOutEnv,
} from '../../e2e/sign-out';

/**
 * The e2e teardown signs an account out of PRODUCTION auth everywhere. It must
 * only ever be the e2e account: these hold the gate, with a fake network that
 * records every request, so "refused" means nothing was sent at all.
 */

const E2E = '22dfa1de-0000-4000-8000-000000000001';
const SOMEONE_ELSE = '8c961db1-0000-4000-8000-000000000002';
const URL_ = 'https://project.supabase.co';
const NOW = new Date('2026-10-01T16:00:00Z');
const inAnHour = Math.floor(NOW.getTime() / 1000) + 3600;
const anHourAgo = Math.floor(NOW.getTime() / 1000) - 3600;

const jwt = (sub: string, exp = inAnHour, session = 's1') =>
  [
    Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub, exp, session_id: session })).toString('base64url'),
    'signature',
  ].join('.');

const env = (over: Partial<SignOutEnv> = {}): SignOutEnv => ({
  supabaseUrl: URL_,
  apiKey: 'sb_publishable_test',
  expectedUserId: E2E,
  email: 'e2e@example.test',
  password: 'not-a-real-password',
  ...over,
});

/**
 * A Supabase that answers tokens with `issue` and logs out with 204 — or
 * with `logoutStatus(token)`, for a token whose session is already gone.
 */
const network = (
  issue: (grant: string) => string | null = () => null,
  logoutStatus: (token: string) => number = () => 204,
) => {
  const calls: { url: string; auth: string | null }[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, auth: headers['authorization'] ?? null });
    if (url.includes('/logout')) {
      const token = (headers['authorization'] ?? '').replace(/^Bearer /, '');
      return new Response(null, { status: logoutStatus(token) });
    }
    const grant = new URL(url).searchParams.get('grant_type') ?? '';
    const token = issue(grant);
    return token
      ? Response.json({ access_token: token, refresh_token: 'r2' })
      : new Response('{}', { status: 400 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
};
const logouts = <T extends { url: string }>(calls: T[]) =>
  calls.filter((c) => c.url.includes('/logout'));

/** The cookie `auth.setup.ts` saves, in Supabase's own `base64-` form. */
const state = (access: string, refresh = 'r1', chunks = 1) => {
  const value = `base64-${Buffer.from(
    JSON.stringify({ access_token: access, refresh_token: refresh }),
  ).toString('base64url')}`;
  const size = Math.ceil(value.length / chunks);
  return {
    cookies: Array.from({ length: chunks }, (_, i) => ({
      name: chunks === 1 ? 'sb-ref-auth-token' : `sb-ref-auth-token.${i}`,
      value: value.slice(i * size, (i + 1) * size),
    })),
  };
};

describe('the gate', () => {
  it('reads the subject of a token locally', () => {
    expect(jwtClaims(jwt(E2E))).toEqual({ sub: E2E, exp: inAnHour });
    expect(jwtClaims('not a token')).toEqual({ sub: null, exp: null });
  });

  it('passes only the e2e account', () => {
    expect(refusal(E2E, E2E)).toBeNull();
    expect(refusal(E2E, SOMEONE_ELSE)).toMatch(/not the e2e account/);
    expect(refusal(E2E, null)).toMatch(/names no user/);
    expect(refusal(undefined, E2E)).toMatch(/E2E_USER_ID is not set/);
    expect(refusal('not-an-id', 'not-an-id')).toMatch(/E2E_USER_ID is not set/);
  });

  it('reads the stored session, whole or in chunks', () => {
    expect(storedSession(state(jwt(E2E)))?.accessToken).toBe(jwt(E2E));
    expect(storedSession(state(jwt(E2E), 'r1', 3))?.accessToken).toBe(jwt(E2E));
    expect(storedSession(null)).toBeNull();
  });
});

describe('it signs out the e2e account, and only it', () => {
  it('signs the e2e account out globally with its own token', async () => {
    const { fetchImpl, calls } = network();
    const result = await signOutE2eAccount(env(), {
      stored: { accessToken: jwt(E2E), refreshToken: 'r1' },
      fetchImpl,
      now: NOW,
    });
    expect(result).toEqual({ done: true, userId: E2E, via: 'stored session' });
    expect(calls).toEqual([
      { url: `${URL_}/auth/v1/logout?scope=global`, auth: `Bearer ${jwt(E2E)}` },
    ]);
  });

  it('refuses another user’s stored session WITHOUT sending anything', async () => {
    const { fetchImpl, calls } = network();
    const result = await signOutE2eAccount(env(), {
      stored: { accessToken: jwt(SOMEONE_ELSE), refreshToken: 'r1' },
      fetchImpl,
      now: NOW,
    });
    expect(result.done).toBe(false);
    expect(calls).toEqual([]);
  });

  it('refuses with E2E_USER_ID unset, sending nothing', async () => {
    const { fetchImpl, calls } = network();
    const result = await signOutE2eAccount(env({ expectedUserId: undefined }), {
      stored: { accessToken: jwt(E2E), refreshToken: 'r1' },
      fetchImpl,
      now: NOW,
    });
    expect(result.done).toBe(false);
    expect(calls).toEqual([]);
  });

  it('an expired session is refreshed, and the NEW token is checked too', async () => {
    const { fetchImpl, calls } = network(() => jwt(SOMEONE_ELSE));
    const result = await signOutE2eAccount(env(), {
      stored: { accessToken: jwt(E2E, anHourAgo), refreshToken: 'r1' },
      fetchImpl,
      now: NOW,
    });
    expect(result.done).toBe(false);
    expect(logouts(calls)).toEqual([]);
  });

  it('a fresh sign-in that comes back as someone else is never signed out', async () => {
    const { fetchImpl, calls } = network((grant) =>
      grant === 'password' ? jwt(SOMEONE_ELSE) : null,
    );
    const result = await signOutE2eAccount(env(), { stored: null, fetchImpl, now: NOW });
    expect(result).toMatchObject({ done: false });
    expect(logouts(calls)).toEqual([]);
  });

  it('never returns a token or the password', async () => {
    const { fetchImpl } = network();
    const result = await signOutE2eAccount(env(), {
      stored: { accessToken: jwt(E2E), refreshToken: 'r1' },
      fetchImpl,
      now: NOW,
    });
    const said = JSON.stringify(result);
    expect(said).not.toContain(jwt(E2E));
    expect(said).not.toContain('not-a-real-password');
  });
});

describe('the teardown targets E2E_USER_ID, wired end to end', () => {
  /**
   * The teardown reads the REAL clock, so its tokens must be unexpired on it.
   * A token stamped against the fixed NOW above expired at 17:00 UTC on
   * 2026-10-01 and this block started failing on the hour.
   */
  const live = (sub: string) => jwt(sub, Math.floor(Date.now() / 1000) + 3600);
  const processEnv = {
    NEXT_PUBLIC_SUPABASE_URL: URL_,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    E2E_USER_ID: E2E,
    E2E_EMAIL: 'e2e@example.test',
    E2E_PASSWORD: 'not-a-real-password',
  };

  it('reads its target from E2E_USER_ID and nothing else', () => {
    expect(envFromProcess(processEnv).expectedUserId).toBe(E2E);
  });

  it('signs out the stored e2e session', async () => {
    const { fetchImpl, calls } = network();
    const result = await runTeardown(processEnv, () => state(live(E2E)), fetchImpl);
    expect(result.done).toBe(true);
    expect(logouts(calls)).toHaveLength(1);
  });

  it('refuses when the stored session is another account’s, sending nothing', async () => {
    const { fetchImpl, calls } = network();
    const result = await runTeardown(
      processEnv,
      () => state(live(SOMEONE_ELSE)),
      fetchImpl,
    );
    expect(result.done).toBe(false);
    expect(calls).toEqual([]);
  });
});

/**
 * The stale session: the file on disk names the e2e account, but a previous
 * teardown already signed that session out, so Supabase answers 401/403.
 */
describe('a stale stored session falls back to a fresh e2e sign-in', () => {
  const STALE = jwt(E2E, inAnHour, 'old');
  const FRESH = jwt(E2E, inAnHour, 'new');
  const gone = (token: string) => (token === STALE ? 403 : 204);
  const signIns = (calls: { url: string }[]) =>
    calls.filter((c) => c.url.includes('grant_type=password'));

  it.each([401, 403])(
    'on %i: signs in fresh, checks it, and signs out everywhere',
    async (status) => {
      const { fetchImpl, calls } = network(
        (grant) => (grant === 'password' ? FRESH : null),
        (token) => (token === STALE ? status : 204),
      );
      const result = await signOutE2eAccount(env(), {
        stored: { accessToken: STALE, refreshToken: 'r1' },
        fetchImpl,
        now: NOW,
      });
      expect(result).toEqual({ done: true, userId: E2E, via: 'fresh sign-in' });
      expect(signIns(calls)).toHaveLength(1);
      expect(logouts(calls).map((c) => c.auth)).toEqual([
        `Bearer ${STALE}`,
        `Bearer ${FRESH}`,
      ]);
    },
  );

  it('a fresh sign-in that comes back as another account is refused, and never signed out', async () => {
    const { fetchImpl, calls } = network(
      (grant) => (grant === 'password' ? jwt(SOMEONE_ELSE) : null),
      gone,
    );
    const result = await signOutE2eAccount(env(), {
      stored: { accessToken: STALE, refreshToken: 'r1' },
      fetchImpl,
      now: NOW,
    });
    expect(result.done).toBe(false);
    // Only the stale e2e token ever reached the logout.
    expect(logouts(calls).map((c) => c.auth)).toEqual([`Bearer ${STALE}`]);
  });

  it('another account’s stored session is still refused with NO request sent', async () => {
    const { fetchImpl, calls } = network(() => FRESH, gone);
    const result = await signOutE2eAccount(env(), {
      stored: { accessToken: jwt(SOMEONE_ELSE), refreshToken: 'r1' },
      fetchImpl,
      now: NOW,
    });
    expect(result.done).toBe(false);
    expect(calls).toEqual([]);
  });

  it('any other failure (500) is reported, not retried', async () => {
    const { fetchImpl, calls } = network(
      () => FRESH,
      () => 500,
    );
    const result = await signOutE2eAccount(env(), {
      stored: { accessToken: jwt(E2E), refreshToken: 'r1' },
      fetchImpl,
      now: NOW,
    });
    expect(result).toEqual({
      done: false,
      reason: 'Supabase refused the global sign-out (500).',
    });
    expect(signIns(calls)).toEqual([]);
  });

  it('through the teardown itself, from a stale state file', async () => {
    // The teardown runs on the real clock, so this token must be unexpired on it.
    const STALE_NOW = jwt(E2E, Math.floor(Date.now() / 1000) + 3600, 'old');

    const { fetchImpl, calls } = network(
      (grant) => (grant === 'password' ? FRESH : null),
      (token) => (token === STALE_NOW ? 403 : 204),
    );
    const result = await runTeardown(
      {
        NEXT_PUBLIC_SUPABASE_URL: URL_,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
        E2E_USER_ID: E2E,
        E2E_EMAIL: 'e2e@example.test',
        E2E_PASSWORD: 'not-a-real-password',
      },
      () => state(STALE_NOW),
      fetchImpl,
    );
    expect(result).toMatchObject({ done: true, via: 'fresh sign-in' });
    expect(logouts(calls)).toHaveLength(2);
  });
});
