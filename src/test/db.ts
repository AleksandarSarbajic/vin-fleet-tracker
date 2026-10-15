import { AsyncLocalStorage } from 'node:async_hooks';
import { afterAll, afterEach, describe } from 'vitest';
import { sql } from 'drizzle-orm';
import { createPooledDb } from '@/db/connection';
import type { Tx } from '@/server/audit';
import { COMMIT_DATABASE_URL } from './url';

/**
 * The one way a test reaches a database (§12.32).
 *
 * Eight suites had their own copy of connect-and-roll-back. They are here
 * instead, so that GUARD 3 — the check that a test left nothing behind — is
 * registered by the act of importing, and cannot be forgotten by the next
 * suite somebody writes.
 *
 * `process.env.DATABASE_URL` is the LOCAL test cluster by the time this runs;
 * vitest.setup.ts overwrote it and deleted the production credentials.
 */

const url = process.env.DATABASE_URL;

/** `describeDb('…', fn)` skips cleanly when no test cluster is configured. */
export const describeDb = url ? describe : describe.skip;

let handle: ReturnType<typeof createPooledDb> | null = null;
const connect = () => (handle ??= createPooledDb(url!));

/** The pooled handle, for the rare test that needs to commit deliberately. */
export const testDb = () => connect().db;

let commitHandle: ReturnType<typeof createPooledDb> | null = null;

/**
 * §12.119. A handle on `fleet_commit` — for a test that must COMMIT, because
 * what it tests happens between two transactions (a row lock). Never the
 * shared `fleet_test`: guard 3 below empties every table there the moment it
 * sees a committed row, and a suite running beside this one would see these.
 * Clean up what you commit; globalSetup empties it each run regardless.
 */
export const commitDb = () => (commitHandle ??= createPooledDb(COMMIT_DATABASE_URL)).db;

afterAll(async () => {
  await handle?.client.end({ timeout: 5 });
  handle = null;
  await commitHandle?.client.end({ timeout: 5 });
  commitHandle = null;
});

// ---------------------------------------------------------------------------
// The test lock (HANDOFF 3ae): no test takes a table lock beside another test.
//
// Test files run in parallel on one database, each in its own rolled-back
// transaction, and their fixtures collide on unique keys, so one waits on
// another's transaction. A test that then changes a table's definition — a
// trigger, a constraint, `alter table` — asks for a TABLE lock, which waits
// on every open transaction that has written to that table. The two waits
// close a cycle and Postgres kills one side: `create trigger … on stops`
// against another file's `insert into trucks`, 1 run in 3 (HANDOFF 3ae).
//
// So every test transaction holds one advisory lock: SHARED in `rolledBack`,
// ALONE in `rolledBackAlone`, which a test with DDL uses. Alone, it starts
// only when no other test transaction is open and none starts until it ends:
// there is no row lock left to deadlock against. Taken first, before any
// other lock, so it cannot be half of a cycle itself.
//
// And it is enforced, not asked for, so the test fails on every run, naming
// the fix, instead of deadlocking one run in three:
//
//   - DDL inside `rolledBack` is refused as it is issued, by an event trigger
//     in the test database, before it takes its lock. Checking afterwards is
//     not enough: a statement that fails aborts the transaction and Postgres
//     releases its locks at once, so a fault-injection test that ends in its
//     expected error would show none.
//   - Any other table lock (`lock table`, `truncate`) still held when the
//     transaction ends fails the test too.
// ---------------------------------------------------------------------------

/** "vtlk". Not the reader's reservation lock or the worker's singleton. */
const TEST_LOCK = 0x7674_6c6b;
/** "vtgi": installing the DDL guard, one worker at a time. */
const GUARD_INSTALL_LOCK = 0x7674_6769;

type Hold = 'shared' | 'alone';

/**
 * Takes the test lock, first thing in the transaction, names its backend, and
 * tells the DDL guard which kind of transaction this is.
 */
async function hold(tx: Tx, mode: Hold): Promise<number> {
  const rows = (await tx.execute<{ pid: number }>(
    mode === 'alone'
      ? sql`select pg_backend_pid() as pid, set_config('vitest.test_lock', 'alone', true),
              pg_advisory_xact_lock(${TEST_LOCK}::bigint)::text`
      : sql`select pg_backend_pid() as pid, set_config('vitest.test_lock', 'shared', true),
              pg_advisory_xact_lock_shared(${TEST_LOCK}::bigint)::text`,
  )) as unknown as { pid: number }[];
  return rows[0]!.pid;
}

/**
 * The DDL guard: an event trigger in the TEST database only (never a
 * migration), refusing DDL in a transaction `hold` marked shared. Anything
 * else — a migration, `rolledBackAlone`, a test that is not in a transaction
 * — sets no mark and passes. Installed once per test file; the first file to
 * reach a fresh cluster creates it, under a lock so two cannot race.
 */
let guardInstalled: Promise<void> | null = null;
function installDdlGuard(): Promise<void> {
  return (guardInstalled ??= connect().db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${GUARD_INSTALL_LOCK}::bigint)::text`);
    await tx.execute(
      sql.raw(`
      create schema if not exists vitest;
      create or replace function vitest.refuse_ddl_beside_tests() returns event_trigger
      language plpgsql as $$
      begin
        if current_setting('vitest.test_lock', true) = 'shared' then
          raise exception '% inside rolledBack(): it takes a table lock that a test running beside it can deadlock against (HANDOFF 3ae). Use rolledBackAlone() from src/test/db.ts.', tg_tag;
        end if;
      end $$;
      do $$ begin
        if not exists (select 1 from pg_event_trigger where evtname = 'vitest_refuse_ddl_beside_tests') then
          create event trigger vitest_refuse_ddl_beside_tests on ddl_command_start
            execute function vitest.refuse_ddl_beside_tests();
        end if;
      end $$;
    `),
    );
  }));
}

/**
 * Table locks held by backend `pid` that a test running beside it can
 * deadlock against. DML never takes these; DDL, `lock table` and `truncate`
 * do. A temporary table is the backend's own, and is left out.
 *
 * Asked from another connection, because a transaction its own failure has
 * aborted can run no query. Such a transaction has already released its
 * locks, as has a savepoint that rolled back, so this sees neither: DDL is
 * the guard's to catch, as it is issued.
 */
async function tableLocksHeld(pid: number): Promise<string[]> {
  const rows = (await connect().db.execute<{ lock: string }>(sql`
    select c.relname || ' (' || l.mode || ')' as lock
    from pg_locks l join pg_class c on c.oid = l.relation
    where l.pid = ${pid} and l.locktype = 'relation' and l.granted
      and l.mode in ('ShareUpdateExclusiveLock', 'ShareLock', 'ShareRowExclusiveLock',
                     'ExclusiveLock', 'AccessExclusiveLock')
      and c.relpersistence <> 't'
    order by 1`)) as unknown as { lock: string }[];
  return rows.map((r) => r.lock);
}

/**
 * Set while a test transaction's body runs. A second one opened inside it
 * would run on another connection and wait for the test lock behind a test
 * that waits for the first — a hang no database can see — so it is refused.
 */
const inside = new AsyncLocalStorage<true>();

async function inTestTransaction<T>(mode: Hold, body: (tx: Tx) => Promise<T>): Promise<T> {
  if (inside.getStore()) {
    throw new Error(
      'rolledBack() or rolledBackAlone() inside another one. Each takes the test lock ' +
        'on its own connection, so the inner one can wait forever on the outer (HANDOFF 3ae). ' +
        'Use the outer transaction.',
    );
  }
  await installDdlGuard();
  const { db } = connect();
  let out: { value: T } | null = null;
  let failure: { error: unknown } | null = null;
  let tableLocks: string[] = [];
  try {
    await inside.run(true, () =>
      db.transaction(async (tx) => {
        const pid = await hold(tx, mode);
        try {
          out = { value: await body(tx) };
        } catch (error) {
          failure = { error };
        }
        if (mode === 'shared') tableLocks = await tableLocksHeld(pid);
        tx.rollback();
      }),
    );
  } catch (error) {
    // `tx.rollback()` throws to unwind; anything else is the harness failing.
    if (out === null && failure === null) throw error;
  }
  if (tableLocks.length > 0) {
    throw new Error(
      `This test took a table lock inside rolledBack(): ${tableLocks.join(', ')}. A test ` +
        `running beside it that has written to that table can deadlock against it ` +
        `(HANDOFF 3ae). Use rolledBackAlone() from src/test/db.ts.`,
    );
  }
  if (failure !== null) throw (failure as { error: unknown }).error;
  return (out as unknown as { value: T }).value;
}

/**
 * Runs `body` in a transaction that always rolls back, beside every other
 * test (the test lock, shared).
 *
 * The result is wrapped rather than returned bare: `tx.rollback()` throws to
 * unwind, and a body that legitimately returns undefined is otherwise
 * indistinguishable from one that failed.
 */
export async function rolledBack<T>(body: (tx: Tx) => Promise<T>): Promise<T> {
  return inTestTransaction('shared', body);
}

/**
 * Runs `body` in a transaction that always rolls back, with NO other test
 * transaction open (the test lock, alone). For a test that changes a table's
 * definition inside it — creates a trigger, adds a constraint, disables a
 * trigger — which `rolledBack` refuses (HANDOFF 3ae).
 *
 * It waits for the tests already running and holds the rest back while it
 * runs, so keep what it does short.
 */
export async function rolledBackAlone<T>(body: (tx: Tx) => Promise<T>): Promise<T> {
  return inTestTransaction('alone', body);
}

// ---------------------------------------------------------------------------
// GUARD 3: nothing survives a test.
//
// Rollback protects writes only while the test actually rolls back. A test
// that commits used to poison every file that ran after it — the assignment
// fixtures failed that way, and the cause looked like a bug in the suite that
// failed rather than in the one that leaked. This names the leaker.
//
// The tables are emptied after reporting, so one leak produces one failure
// rather than a cascade that buries it.
// ---------------------------------------------------------------------------

let tableNames: string[] | null = null;

async function publicTables(db: ReturnType<typeof testDb>): Promise<string[]> {
  if (tableNames) return tableNames;
  const rows = (await db.execute<{ name: string }>(
    sql`select tablename as name from pg_tables where schemaname = 'public' order by 1`,
  )) as unknown as { name: string }[];
  tableNames = rows.map((r) => r.name).filter((n) => /^[a-z_][a-z0-9_]*$/.test(n));
  return tableNames;
}

/**
 * Which tables hold rows. Exported so the guard itself can be tested — called
 * with a transaction it reports that transaction's own uncommitted rows, which
 * is how guards.test.ts proves the detector works without leaking anything.
 */
export async function tablesHoldingRows(
  db: ReturnType<typeof testDb> | Tx,
): Promise<{ t: string; n: string }[]> {
  const tables = await publicTables(db as ReturnType<typeof testDb>);
  // One round trip, not one per table: this runs after every test in the suite.
  const counts = (await db.execute<{ t: string; n: string }>(
    sql.raw(
      tables
        .map((t) => `select '${t}' as t, count(*)::text as n from public."${t}"`)
        .join(' union all '),
    ),
  )) as unknown as { t: string; n: string }[];
  return counts.filter((c) => c.n !== '0');
}

afterEach(async () => {
  if (handle === null) return;
  const { db } = connect();
  const dirty = await db.transaction(async (tx) => {
    await hold(tx, 'shared');
    return tablesHoldingRows(tx);
  });
  if (dirty.length === 0) return;

  // Every table, not just the dirty ones: truncating a subset CASCADEs into
  // the rest and reports each cascade as a NOTICE, and a cascade could empty a
  // table this pass has already counted.
  const all = await publicTables(db);
  // Alone (HANDOFF 3ae): a truncate under tests still running deadlocked them
  // (§12.119), and would empty their tables under them.
  await db.transaction(async (tx) => {
    await hold(tx, 'alone');
    await tx.execute(
      sql.raw(`truncate table ${all.map((t) => `public."${t}"`).join(', ')} restart identity`),
    );
  });
  throw new Error(
    `This test committed rows instead of rolling back: ` +
      `${dirty.map((d) => `${d.t} (${d.n})`).join(', ')}. The tables have been ` +
      `emptied so the next test is not affected, but the leak is here. Use ` +
      `rolledBack() from src/test/db.ts. (guard 3)`,
  );
});
