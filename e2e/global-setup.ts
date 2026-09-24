import { execFileSync } from 'node:child_process';
import { config as loadEnv } from 'dotenv';
import { connect, TEST_DATABASE_URL } from './fixtures';

/**
 * Runs once, before the web server is started.
 *
 * Two jobs: make sure the disposable cluster exists and is migrated, and
 * refuse loudly if the suite has been pointed at anything that is not
 * loopback. The second matters more than it looks — this suite truncates every
 * table it can reach, and §12.32 is the record of what that costs when the
 * refusal runs after the damage instead of before it.
 */
export default async function globalSetup(): Promise<void> {
  loadEnv({ path: '.env.local' });

  const host = new URL(TEST_DATABASE_URL.replace(/^postgres(ql)?:/, 'http:')).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(
      `The e2e suite truncates every table it can reach and this database is ` +
        `not on this machine (${host}). Refusing to run.`,
    );
  }

  for (const name of ['E2E_EMAIL', 'E2E_PASSWORD', 'E2E_USER_ID']) {
    if (!process.env[name]) {
      throw new Error(
        `${name} is not set. The browser suite signs in as a dedicated ` +
          `Supabase account; create one with \`npm run e2e:user\` and put the ` +
          `values in .env.local.`,
      );
    }
  }

  execFileSync('scripts/test-db.sh', ['up'], { stdio: 'inherit' });
  execFileSync('npx', ['tsx', 'scripts/test-db-migrate.mts'], { stdio: 'inherit' });

  const sql = connect();
  try {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from pg_tables where schemaname = 'public'`;
    if ((row?.n ?? 0) === 0) {
      throw new Error('The test cluster has no tables after migrating.');
    }
    console.info(`e2e: ${row!.n} tables in the disposable cluster at ${host}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
