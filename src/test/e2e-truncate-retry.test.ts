import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEADLOCK, DEADLOCK_TRIES, retryOnDeadlock, truncateTables } from '../../e2e/fixtures';
import { COMMIT_DATABASE_URL } from './url';

/**
 * 3bx found wrong 6. The e2e world reset's truncate, sent again when it deadlocks and never for
 * anything else, against a REAL deadlock: two connections, a read holding one table and asking for
 * a second, and the truncate holding the second and asking for the first.
 *
 * On `fleet_commit` (§12.119): the read must commit, which `fleet_test` forbids, and `fleet_e2e`
 * belongs to a browser run that may be going. Its own schema, created and dropped here, so no
 * table another test uses is locked or emptied.
 *
 * The truncate is made the side Postgres aborts, as in the e2e log: each waiting session looks for
 * a cycle after its own `deadlock_timeout`, so the truncate's is 50ms and the read's 30s.
 */

const SCHEMA = `e2e_deadlock_${randomUUID().slice(0, 8)}`;
const A = `${SCHEMA}.a`;
const B = `${SCHEMA}.b`;
const open = () => postgres(COMMIT_DATABASE_URL, { max: 1, onnotice: () => {} });

let admin: postgres.Sql;
beforeAll(async () => {
  admin = open();
  await admin.unsafe(`create schema ${SCHEMA}; create table ${A} (n int); create table ${B} (n int);`);
});
afterAll(async () => {
  await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
  await admin.end({ timeout: 5 });
});
beforeEach(async () => {
  await admin.unsafe(`insert into ${A} values (1); insert into ${B} values (1);`);
});

/** Until `pid` is waiting for a lock: the truncate has taken B and is queued behind the read on A. */
async function waitingForLock(pid: number): Promise<void> {
  for (const deadline = Date.now() + 10_000; Date.now() < deadline; ) {
    const [row] = await admin<{ wait: string | null }[]>`
      select wait_event_type as wait from pg_stat_activity where pid = ${pid}`;
    if (row?.wait === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`the truncate (pid ${pid}) never waited for a lock`);
}

describe('the world reset’s truncate', () => {
  it('deadlocked with a read: Postgres aborts it, it is sent once more, and the tables are empty', async () => {
    const reader = open();
    const truncator = open();
    try {
      await truncator`set deadlock_timeout = '50ms'`;
      const [backend] = await truncator<{ pid: number }[]>`select pg_backend_pid() as pid`;
      const pid = backend!.pid;
      const lines: string[] = [];

      let holdingA!: () => void;
      const heldA = new Promise<void>((resolve) => (holdingA = resolve));
      const read = reader.begin(async (tx) => {
        await tx`set local deadlock_timeout = '30s'`;
        await tx.unsafe(`select count(*) from ${A}`);
        holdingA();
        await waitingForLock(pid);
        // B is the truncate's: this closes the cycle, and the truncate is aborted.
        return tx.unsafe(`select count(*)::int as n from ${B}`);
      });
      await heldA;
      // B first, then A: the order the cycle needs.
      const truncate = truncateTables(truncator, [B, A], (line) => lines.push(line));

      const [rows] = await Promise.all([read, truncate]);
      expect(rows[0]?.n, 'the read saw B before the second try emptied it').toBe(1);
      expect(lines).toEqual([`e2e: the truncate deadlocked (${DEADLOCK}) on try 1 of ${DEADLOCK_TRIES}; sending it again`]);
      const [count] = await admin<{ a: number; b: number }[]>`
        select (select count(*)::int from ${admin(A)}) as a, (select count(*)::int from ${admin(B)}) as b`;
      expect(count).toEqual({ a: 0, b: 0 });
    } finally {
      await reader.end({ timeout: 5 });
      await truncator.end({ timeout: 5 });
    }
  });

  it('any other error is thrown at once, not sent again: a missing table, and a lock timeout', async () => {
    const holder = open();
    const truncator = open();
    try {
      const lines: string[] = [];
      let tries = 0;
      const missing = () => {
        tries += 1;
        return truncator.unsafe(`truncate table ${SCHEMA}.no_such_table`);
      };
      await expect(retryOnDeadlock('the truncate', missing, (line) => lines.push(line))).rejects.toMatchObject({
        code: '42P01',
      });
      expect(tries).toBe(1);

      // A real error that a second try could get past once the lock is gone: still thrown at once.
      await truncator`set lock_timeout = '100ms'`;
      tries = 0;
      await holder.begin(async (tx) => {
        await tx.unsafe(`lock table ${A} in access share mode`);
        const timedOut = () => {
          tries += 1;
          return truncator.unsafe(`truncate table ${A}`);
        };
        await expect(retryOnDeadlock('the truncate', timedOut, (line) => lines.push(line))).rejects.toMatchObject({
          code: '55P03',
        });
      });
      expect(tries).toBe(1);
      expect(lines).toEqual([]);
    } finally {
      await holder.end({ timeout: 5 });
      await truncator.end({ timeout: 5 });
    }
  });

  it(`a statement that deadlocks every time is sent ${DEADLOCK_TRIES} times, and the last deadlock is thrown`, async () => {
    const lines: string[] = [];
    let tries = 0;
    const deadlock = Object.assign(new Error('deadlock detected'), { code: DEADLOCK });
    const always = () => {
      tries += 1;
      return Promise.reject(deadlock);
    };
    await expect(retryOnDeadlock('the truncate', always, (line) => lines.push(line))).rejects.toBe(deadlock);
    expect(tries).toBe(DEADLOCK_TRIES);
    expect(lines).toEqual([
      `e2e: the truncate deadlocked (${DEADLOCK}) on try 1 of ${DEADLOCK_TRIES}; sending it again`,
      `e2e: the truncate deadlocked (${DEADLOCK}) on try 2 of ${DEADLOCK_TRIES}; sending it again`,
    ]);
  });
});
