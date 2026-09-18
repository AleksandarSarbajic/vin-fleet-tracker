import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { z } from 'zod';
import { createPooledDb, createDirectDb } from '@/db/connection';
import { FleetQueryRows, LATEST_POSITION_SQL } from '@/server/fleet-query';

/**
 * The deploy gate for everything the local test cluster cannot cover (§12.32).
 *
 * Tests run against a Postgres in ./.testdb. That buys isolation and speed and
 * costs exactly one thing: the real Supabase POOLER is never exercised. The
 * transaction pooler at :6543 multiplexes connections and therefore refuses
 * prepared statements, which is why `createPooledDb` sets `prepare: false` —
 * a setting no unit test can prove is still needed, and whose absence fails
 * only under concurrency, in production, at the worst possible time.
 *
 * So it is checked here instead, against the real thing, as a required step
 * before deploy. `npm run preflight`.
 *
 * Three questions, in order of how badly a wrong answer hurts:
 *   1. Is `prepare: false` still load-bearing? Proven by CONCURRENT prepared
 *      statements stalling, which is the one configuration where the bug
 *      shows — see concurrentBurst below.
 *   2. Does the real fleet query still return the shape the row type claims?
 *   3. Is the migration history on the deployed database current?
 */
loadEnv({ path: '.env.local' });

const Env = z.object({
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),
});

let failures = 0;
const pass = (what: string, detail = '') =>
  console.info(`  ok    ${what}${detail ? ` — ${detail}` : ''}`);
const fail = (what: string, detail: string) => {
  failures += 1;
  console.error(`  FAIL  ${what} — ${detail}`);
};

/**
 * Runs `count` statements at once over `max` connections and says whether they
 * all came back inside `ms`.
 *
 * Concurrency is the whole experiment. Measured against this pooler:
 *
 *     prepare:true    1 connection,  2 statements   OK
 *     prepare:true    5 connections, 20 statements  never returns
 *     prepare:false   5 connections, 20 statements  OK
 *
 * With one connection the prepared statement is reused on the backend that
 * prepared it, so it works — which is why the first version of this check
 * used two sequential statements and reported the opposite of the truth.
 * Under concurrency the pooler hands the second execution to a backend that
 * has never seen the name, and the result is not an error but a STALL. That
 * is the shape of the production incident this gate exists to prevent: no
 * exception, no log line, just route handlers that stop returning.
 */
async function concurrentBurst(
  url: string,
  options: { prepare: boolean; max: number },
  count: number,
  ms: number,
): Promise<boolean> {
  const client = postgres(url, { ...options, connect_timeout: 10, idle_timeout: 5 });
  let timer: NodeJS.Timeout | undefined;
  try {
    const burst = Promise.all(
      Array.from({ length: count }, (_, i) => client`select ${i}::int as n`),
    );
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), ms);
    });
    return (await Promise.race([burst.then(() => 'done' as const), timeout])) === 'done';
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
    // Deliberately not awaited: a stalled pool will not drain, and this
    // process is about to exit anyway.
    void client.end({ timeout: 1 }).catch(() => {});
  }
}

async function poolerIsTransactionMode(url: string) {
  const naive = await concurrentBurst(url, { prepare: true, max: 5 }, 20, 12_000);
  if (naive) {
    fail(
      '`prepare: false` is still load-bearing',
      'twenty concurrent statements with prepare:true SUCCEEDED. Either this ' +
        'is no longer the transaction pooler, or the pooler has gained ' +
        'prepared-statement support. Find out which before trusting this gate ' +
        'again — do not simply delete `prepare: false`.',
    );
  } else {
    pass('`prepare: false` is still load-bearing', 'prepare:true stalls under concurrency');
  }

  const configured = await concurrentBurst(url, { prepare: false, max: 5 }, 20, 12_000);
  if (configured) {
    pass('the configured pooled connection survives that same burst');
  } else {
    fail(
      'the configured pooled connection survives that same burst',
      'twenty concurrent statements did not come back — route handlers will ' +
        'stall under load',
    );
  }
}

async function main() {
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    console.error('preflight: DATABASE_URL and DIRECT_URL must both be set');
    process.exitCode = 1;
    return;
  }
  const { DATABASE_URL, DIRECT_URL } = parsed.data;

  console.info('preflight — the real pooler, which the test cluster cannot cover\n');

  if (!DATABASE_URL.includes(':6543')) {
    fail('DATABASE_URL is the transaction pooler', `port is not 6543: ${DATABASE_URL}`);
  } else {
    pass('DATABASE_URL is the transaction pooler');
  }

  await poolerIsTransactionMode(DATABASE_URL);

  // 2. The pooled path our route handlers actually use.
  const pooled = createPooledDb(DATABASE_URL);
  try {
    const rows = FleetQueryRows.safeParse(await pooled.db.execute(LATEST_POSITION_SQL));
    if (!rows.success) {
      fail(
        'the fleet query returns the shape the row type claims',
        rows.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; '),
      );
    } else {
      pass('the fleet query returns the shape the row type claims', `${rows.data.length} rows`);
    }
  } catch (error) {
    fail('the fleet query runs over the pooled connection', (error as Error).message);
  } finally {
    await pooled.client.end({ timeout: 5 });
  }

  // 3. The session pooler, which migrations and the worker use.
  const direct = createDirectDb(DIRECT_URL, 1);
  try {
    const applied = (await direct.db.execute(
      `select count(*)::text as n from drizzle.__drizzle_migrations`,
    )) as unknown as { n: string }[];
    pass('session pooler reachable for migrations', `${applied[0]?.n ?? '?'} applied`);
  } catch (error) {
    fail('session pooler reachable for migrations', (error as Error).message);
  } finally {
    await direct.client.end({ timeout: 5 });
  }

  console.info('');
  if (failures > 0) {
    console.error(`preflight FAILED — ${failures} check(s). Do not deploy.`);
    process.exitCode = 1;
  } else {
    console.info('preflight passed.');
  }
}

main().catch((error: unknown) => {
  console.error('preflight crashed:', error);
  process.exitCode = 1;
});
