import { afterAll, afterEach, describe } from 'vitest';
import { sql } from 'drizzle-orm';
import { createPooledDb } from '@/db/connection';
import type { Tx } from '@/server/audit';

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

afterAll(async () => {
  await handle?.client.end({ timeout: 5 });
  handle = null;
});

/**
 * Runs `body` in a transaction that always rolls back.
 *
 * The result is wrapped rather than returned bare: `tx.rollback()` throws to
 * unwind, and a body that legitimately returns undefined is otherwise
 * indistinguishable from one that failed.
 */
export async function rolledBack<T>(body: (tx: Tx) => Promise<T>): Promise<T> {
  const { db } = connect();
  let out: { value: T } | null = null;
  try {
    await db.transaction(async (tx) => {
      out = { value: await body(tx) };
      tx.rollback();
    });
  } catch (error) {
    if (out === null) throw error;
  }
  return (out as unknown as { value: T }).value;
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
  const dirty = await tablesHoldingRows(db);
  if (dirty.length === 0) return;

  // Every table, not just the dirty ones: truncating a subset CASCADEs into
  // the rest and reports each cascade as a NOTICE, and a cascade could empty a
  // table this pass has already counted.
  const all = await publicTables(db);
  await db.execute(
    sql.raw(`truncate table ${all.map((t) => `public."${t}"`).join(', ')} restart identity`),
  );
  throw new Error(
    `This test committed rows instead of rolling back: ` +
      `${dirty.map((d) => `${d.t} (${d.n})`).join(', ')}. The tables have been ` +
      `emptied so the next test is not affected, but the leak is here. Use ` +
      `rolledBack() from src/test/db.ts. (guard 3)`,
  );
});
