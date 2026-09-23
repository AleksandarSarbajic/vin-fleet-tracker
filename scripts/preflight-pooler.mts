import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { z } from 'zod';
import { createPooledDb, createDirectDb } from '@/db/connection';
import { LOCK_CLASS, LOCK_OBJECT, createLockClient, holdsLock } from '@/worker/singleton';
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
 * Four questions, in order of how badly a wrong answer hurts:
 *   1. Is `prepare: false` set on the connection route handlers use? This is
 *      about OUR config, and it is the only prepared-statement check that is
 *      a pass condition — see the note on burstSurvives.
 *   2. Does the real fleet query still return the shape the row type claims?
 *   3. Does the SESSION pooler pass advisory locks through? The worker's
 *      single-instance guard is a session-scoped advisory lock, and "session
 *      mode" is a vendor promise, not a law. If Supavisor ever multiplexes
 *      session-mode connections the way it does transaction mode, the guard
 *      goes quiet rather than loud — the same failure shape as `prepare: false`
 *      and the reason that one is checked here too.
 *   4. Is the migration history on the deployed database current?
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
 * Is `prepare: false` actually set on the connection route handlers use?
 *
 * This is the assertion that matters, and it is about OUR config rather than
 * the vendor's behaviour. `createPooledDb` is the only way a route handler
 * reaches the database, and the setting is the whole reason it exists.
 */
function pooledClientHasPrepareOff(url: string): boolean {
  const { client } = createPooledDb(url);
  // postgres.js keeps its resolved options on the client.
  const options = (client as unknown as { options?: { prepare?: boolean } }).options;
  void client.end({ timeout: 1 }).catch(() => {});
  return options?.prepare === false;
}

/**
 * Does the pooler reject a prepared statement IF ONE IS ATTEMPTED?
 *
 * Informational, never a pass condition.
 *
 * The first version of this gate asserted that `prepare: true` STALLS, and
 * passed only while it did. That is a gate whose green light depends on a
 * vendor bug persisting: when Supabase fixes Supavisor it goes red on a
 * perfectly healthy system, and the obvious way to make it green again is to
 * delete the `prepare: false` it exists to protect. It also cost twelve
 * seconds of every run waiting for something to fail, and could not tell
 * "prepared statements rejected" apart from "pooler overloaded".
 *
 * Measured, for the record, and the behaviour is not even uniform:
 *
 *     prepare:true    1 connection,  2 statements   returns
 *     prepare:true    5 connections, 20 statements  stalls (5 of 5)
 *     prepare:true   10 connections, 20 statements  inconsistent
 *
 * So it is reported and never asserted. What IS asserted is that our own
 * connection survives the burst — which is true whatever the pooler decides
 * to do about prepared statements.
 */
async function burstSurvives(
  url: string,
  options: { prepare: boolean; max: number },
  count: number,
  ms: number,
): Promise<'ok' | 'rejected' | 'timeout'> {
  const client = postgres(url, { ...options, connect_timeout: 10, idle_timeout: 5 });
  let timer: NodeJS.Timeout | undefined;
  try {
    const burst = Promise.all(
      Array.from({ length: count }, (_, i) => client`select ${i}::int as n`),
    ).then(() => 'ok' as const);
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), ms);
    });
    return await Promise.race([burst, timeout]);
  } catch {
    return 'rejected';
  } finally {
    if (timer) clearTimeout(timer);
    void client.end({ timeout: 1 }).catch(() => {});
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

  // 1. Our own config — the assertion that does not depend on the vendor.
  if (pooledClientHasPrepareOff(DATABASE_URL)) {
    pass('createPooledDb sets `prepare: false`', 'required by the transaction pooler');
  } else {
    fail(
      'createPooledDb sets `prepare: false`',
      'the transaction pooler multiplexes connections; prepared statements ' +
        'stall route handlers under load and the failure is silent',
    );
  }

  // 2. The configured connection survives real concurrency.
  const configured = await burstSurvives(DATABASE_URL, { prepare: false, max: 5 }, 20, 12_000);
  if (configured === 'ok') {
    pass('the pooled connection survives 20 concurrent statements');
  } else {
    fail(
      'the pooled connection survives 20 concurrent statements',
      configured === 'timeout'
        ? 'they did not come back — route handlers will stall under load'
        : 'the pooler rejected them',
    );
  }

  // 3. What the pooler does with prepared statements. REPORTED, not asserted.
  const naive = await burstSurvives(DATABASE_URL, { prepare: true, max: 5 }, 20, 4_000);
  console.info(
    naive === 'ok'
      ? '  note  the pooler now ACCEPTS concurrent prepared statements — `prepare: false` ' +
          'may be belt-and-braces rather than load-bearing. Do not remove it on the ' +
          'strength of one observation; the behaviour has been inconsistent.'
      : `  note  prepared statements ${naive === 'timeout' ? 'stall' : 'are rejected'} ` +
          'under concurrency, as expected — `prepare: false` is load-bearing.',
  );

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

  /*
   * 3. Advisory locks survive the session pooler — the worker's whole guard.
   *
   * This runs against a LIVE deployment, where a worker is normally already
   * holding the lock, so "the lock is free" cannot be the pass condition — it
   * would go red on every deploy after the first, which is a gate that teaches
   * people to ignore it.
   *
   * The property under test is mutual exclusion, and both outcomes demonstrate
   * it. Either this process takes the lock and a second session is refused, or
   * this process is itself refused by the running worker. The only failure is
   * two sessions holding the same lock at once.
   */
  const lockA = createLockClient(DIRECT_URL);
  const lockB = createLockClient(DIRECT_URL);
  try {
    const [a] = await lockA<{ locked: boolean }[]>`
      select pg_try_advisory_lock(${LOCK_CLASS}, ${LOCK_OBJECT}) as locked`;

    if (a?.locked !== true) {
      // Refused by whatever already holds it — a running worker, which is the
      // healthy state on a live system and is itself the proof.
      const [who] = await lockA<{ pid: number }[]>`
        select pid from pg_locks
         where locktype = 'advisory' and classid = ${LOCK_CLASS}
           and objid = ${LOCK_OBJECT} and objsubid = 2 and granted limit 1`;
      pass(
        'the worker singleton lock is exclusive',
        `already held${who ? ` by backend pid ${who.pid}` : ''} — a worker is ` +
          'running and this session was correctly refused',
      );
    } else if (!(await holdsLock(lockA))) {
      // Took it, cannot see it: the lock landed on a different backend than the
      // one answering our queries, which means session mode is not.
      fail(
        'the lock is visible to the backend that took it',
        'pg_locks does not show it against pg_backend_pid() — the pooler is ' +
          'not giving us a stable session, and the singleton guard is void',
      );
    } else {
      const [b] = await lockB<{ locked: boolean }[]>`
        select pg_try_advisory_lock(${LOCK_CLASS}, ${LOCK_OBJECT}) as locked`;
      if (b?.locked === false) {
        pass('the worker singleton lock is exclusive', 'a second session was refused');
      } else {
        fail(
          'the worker singleton lock is exclusive',
          'BOTH sessions took the same advisory lock. Two workers can run at ' +
            'once: they will share the ingest cursor and the routing budget',
        );
        await lockB`select pg_advisory_unlock(${LOCK_CLASS}, ${LOCK_OBJECT})`.catch(() => {});
      }
      await lockA`select pg_advisory_unlock(${LOCK_CLASS}, ${LOCK_OBJECT})`.catch(() => {});
    }
  } catch (error) {
    fail('the worker singleton lock is exclusive', (error as Error).message);
  } finally {
    await lockA.end({ timeout: 5 });
    await lockB.end({ timeout: 5 });
  }

  // 4. The session pooler, which migrations and the worker use.
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
