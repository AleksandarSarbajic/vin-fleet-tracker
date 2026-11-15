import { execFileSync } from 'node:child_process';
import { config as loadEnv } from 'dotenv';
import { connect, TEST_DATABASE_URL } from './fixtures';
import { refuseUnlessLoopback } from './loopback';
import { RESULTS_ROOT, RUNS_KEPT, pruneRuns } from './results';
import { markRunStart, startPowerSampling } from './run-clock';

/**
 * Runs once, AFTER the web servers have started: in Playwright 1.63 the plugin setup, the
 * servers among it, comes before global setup (3bv's found wrong 2). Until phase 3bw this said
 * "before the web server is started", which was never so.
 *
 * Two jobs: make sure the disposable cluster exists and is migrated, and
 * refuse loudly if the suite has been pointed at anything that is not
 * loopback. The second matters more than it looks — this suite truncates every
 * table it can reach, and §12.32 is the record of what that costs when the
 * refusal runs after the damage instead of before it. So since 3bw the refusal
 * runs first in `playwright.config.ts`, as the config loads, before any server
 * starts (`e2e/loopback.ts`, §12.162); it is asked again here, before the first
 * write, for a runner that loads this without that config.
 */
export default async function globalSetup(): Promise<void> {
  loadEnv({ path: '.env.local' });
  // Read at the end against the end of the run: did the machine sleep? (run-clock.ts)
  try {
    markRunStart();
  } catch (error) {
    console.warn(`e2e: no sleep check this run (${error instanceof Error ? error.message : 'unknown error'}).`);
  }
  // And sampled once a minute until the end: did macOS run it in DarkWake? (run-clock.ts, phase 3bv)
  try {
    startPowerSampling();
  } catch (error) {
    console.warn(`e2e: no DarkWake check this run (${error instanceof Error ? error.message : 'unknown error'}).`);
  }

  const host = refuseUnlessLoopback(TEST_DATABASE_URL);

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
  // The migrator reads TEST_DATABASE_URL; point it at this suite's database.
  execFileSync('npx', ['tsx', 'scripts/test-db-migrate.mts'], {
    stdio: 'inherit',
    env: { ...process.env, TEST_DATABASE_URL },
  });

  const sql = connect();
  try {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from pg_tables where schemaname = 'public'`;
    if ((row?.n ?? 0) === 0) {
      throw new Error('The test cluster has no tables after migrating.');
    }
    console.info(`e2e: ${row!.n} tables in the disposable cluster at ${host}`);
    // §12.84. Said up front, so a failure's trace is findable after the fact.
    console.info(`e2e: results for this run → ${RESULTS_ROOT}/${process.env['E2E_RUN_ID'] ?? '?'}`);
    const pruned = pruneRuns(RESULTS_ROOT, RUNS_KEPT);
    if (pruned.length > 0) console.info(`e2e: pruned ${pruned.length} old run folder(s), kept ${RUNS_KEPT}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
