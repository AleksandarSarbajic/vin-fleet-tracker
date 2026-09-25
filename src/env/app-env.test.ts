import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * §12.75. The app starts with none of the worker's credentials present.
 *
 * It did not: it was validated against every server variable at once, so it
 * refused to boot without DIRECT_URL, SAMSARA_API_TOKEN, SAMSARA_ORG_ID and
 * WORKER_SUPABASE_SECRET_KEY — none of which any live app code read. That is
 * what made "delete the worker's secrets from Vercel" a change that would have
 * taken the site down.
 *
 * These load the REAL `@/env/server` module, the one every route imports, in
 * an environment that holds only what a Vercel project should.
 */

// `server-only` throws outside Next's server build; the guard it provides is a
// build-time one and is not what these tests are about.
vi.mock('server-only', () => ({}));

const WORKER_ONLY = [
  'DIRECT_URL',
  'SAMSARA_API_TOKEN',
  'SAMSARA_ORG_ID',
  'WORKER_SUPABASE_SECRET_KEY',
] as const;

/** What the Vercel project holds, server side: the transaction pooler string. */
const VERCEL = {
  DATABASE_URL: 'postgresql://postgres.ref:pw@aws-1-eu-west-1.pooler.supabase.com:6543/postgres',
  NODE_ENV: 'production',
};

async function loadServerEnvWith(vars: Record<string, string>) {
  vi.resetModules();
  for (const key of [...WORKER_ONLY, 'SUPABASE_SECRET_KEY', 'DATABASE_URL']) vi.stubEnv(key, undefined);
  for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value);
  return (await import('@/env/server')).serverEnv;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('the app starts without any worker credential (§12.75)', () => {
  it('loads with only the transaction pooler string, and none of the four', async () => {
    for (const key of WORKER_ONLY) expect(process.env[key]).toBeUndefined();
    const env = await loadServerEnvWith(VERCEL);
    expect(env.DATABASE_URL).toBe(VERCEL.DATABASE_URL);
    expect(env.DISPATCH_TZ).toBe('America/Chicago');
  });

  it('carries none of them even when they ARE set, so no code can start relying on one', async () => {
    const env = await loadServerEnvWith({
      ...VERCEL,
      DIRECT_URL: 'postgresql://postgres.ref:pw@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
      SAMSARA_API_TOKEN: 'samsara_x',
      SAMSARA_ORG_ID: '45975',
      WORKER_SUPABASE_SECRET_KEY: 'sb_secret_worker',
      SUPABASE_SECRET_KEY: 'sb_secret_web',
    });
    for (const key of [...WORKER_ONLY, 'SUPABASE_SECRET_KEY']) {
      expect(Object.keys(env), key).not.toContain(key);
    }
  });

  /** The control: this really is the validating module, and it still bites. */
  it('still refuses to start without the one database string it needs', async () => {
    await expect(loadServerEnvWith({ NODE_ENV: 'production' })).rejects.toThrow(/DATABASE_URL/);
  });

  it('still refuses the SESSION pooler as its database string', async () => {
    await expect(
      loadServerEnvWith({
        ...VERCEL,
        DATABASE_URL: 'postgresql://postgres.ref:pw@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
      }),
    ).rejects.toThrow(/TRANSACTION pooler/);
  });
});

/**
 * The schema is one half; code is the other. A new `serverEnv.DIRECT_URL` in
 * a route would fail to typecheck now, but a bare `process.env.SAMSARA_…`
 * would not. So app code — everything under src/ except the worker, tests,
 * test fixtures and the migration CLI — is searched for READS of them.
 */
describe('no app code reads a worker credential or a secret key', () => {
  const SRC = join(process.cwd(), 'src');
  const EXEMPT = [/^worker\//, /^test\//, /^server\/fixtures\//, /\.test\.tsx?$/, /^db\/migrate\.ts$/, /^env\/schema\.ts$/];
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx|mts)$/.test(name) ? [path] : [];
    });
  const READ = /(process\.env\.|process\.env\[['"]|serverEnv\.|env\.)(DIRECT_URL|SAMSARA_API_TOKEN|SAMSARA_ORG_ID|WORKER_SUPABASE_SECRET_KEY|SUPABASE_SECRET_KEY)\b/;

  it('finds none', () => {
    const offenders = files(SRC)
      .map((path) => relative(SRC, path))
      .filter((rel) => !EXEMPT.some((re) => re.test(rel)))
      .filter((rel) => READ.test(readFileSync(join(SRC, rel), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
