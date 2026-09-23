import { afterEach, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { describeDb } from '@/test/db';
import type { Logger } from '@/samsara/client';
import {
  LOCK_CLASS,
  LOCK_OBJECT,
  SingletonLockError,
  acquireSingleton,
  createLockClient,
  holdsLock,
  type Singleton,
} from './singleton';

/**
 * The second worker must not start.
 *
 * `worker/index.ts` asked for this in a comment for four phases. A comment did
 * not stop a pre-swap worker from outliving a migration and double-writing the
 * routing budget, and it would not have stopped the second near-miss during the
 * §12.61 shadow-run setup either.
 *
 * The local test cluster is a plain Postgres, which is exactly right here:
 * advisory locks are a session-level Postgres feature and the session pooler
 * passes them through unchanged. What is under test is our own use of them.
 */

const url = process.env.DATABASE_URL!;

const quietLogger = (): Logger => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

const open: Singleton[] = [];
const held = async (options?: Partial<Parameters<typeof acquireSingleton>[0]>) => {
  const lock = await acquireSingleton({
    url,
    logger: quietLogger(),
    // Long enough that no test trips it by accident; the one test that wants
    // the heartbeat sets its own.
    heartbeatMs: 60_000,
    onLost: () => {},
    ...options,
  });
  open.push(lock);
  return lock;
};

afterEach(async () => {
  while (open.length > 0) await open.pop()!.release();
});

describeDb('the worker refuses to be two workers', () => {
  it('takes the lock when nothing holds it', async () => {
    const lock = await held();
    expect(await lock.verify()).toBe(true);
  });

  it('refuses the second instance instead of racing it', async () => {
    await held();
    await expect(held()).rejects.toBeInstanceOf(SingletonLockError);
  });

  it('names what is already holding it, so a refusal is not mistaken for a broken deploy', async () => {
    await held();
    let message = '';
    try {
      await held();
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }
    // The pid is the thing that turns "it will not start" into something
    // actionable on a host running more than one service.
    expect(message).toMatch(/backend pid \d+/);
    expect(message).toMatch(/ingest cursor/);
  });

  it('lets the next instance start once the first releases', async () => {
    const first = await held();
    await first.release();
    open.length = 0;
    const second = await held();
    expect(await second.verify()).toBe(true);
  });

  it('releases on the way out even if the process never called unlock', async () => {
    const lock = await held();
    await lock.release();
    open.length = 0;

    const observer = postgres(url, { max: 1 });
    try {
      const rows = await observer<{ n: number }[]>`
        select count(*)::int as n from pg_locks
         where locktype = 'advisory' and classid = ${LOCK_CLASS}
           and objid = ${LOCK_OBJECT} and objsubid = 2 and granted
      `;
      expect(rows[0]?.n).toBe(0);
    } finally {
      await observer.end({ timeout: 5 });
    }
  });

  /**
   * THE REGRESSION THAT MATTERS.
   *
   * `createDirectDb` sets `max_lifetime: 60 * 10` and `idle_timeout: 60` for
   * §12.39's reasons, which are good reasons for the worker's query connection
   * and fatal for this one. Taking the lock on a recycled connection produces a
   * guard that is silently released ten minutes into a deploy — green, trusted,
   * and holding nothing.
   *
   * Asserted against OUR configuration rather than by waiting ten minutes for
   * the vendor to prove it, which is the same choice `preflight` makes about
   * `prepare: false` and for the same reason.
   */
  it('holds the lock on a connection that is never recycled', async () => {
    const client = createLockClient(url);
    try {
      const options = (
        client as unknown as {
          options?: { max?: number; max_lifetime?: number; idle_timeout?: number };
        }
      ).options;
      expect(options?.max).toBe(1);
      // Both zero, both load-bearing: either one non-zero drops the lock.
      expect(options?.max_lifetime).toBe(0);
      expect(options?.idle_timeout).toBe(0);
    } finally {
      await client.end({ timeout: 5 });
    }
  });

  /**
   * And the reason the heartbeat cannot just be `select 1`.
   *
   * postgres.js reconnects transparently. A dropped connection therefore loses
   * the lock and then answers healthily from a brand-new backend that holds
   * nothing, so a liveness check on the CONNECTION reports fine while the guard
   * is gone. `holdsLock` asks about the backend, which is the question.
   *
   * WHICH WAY IT FAILS IS TIMING. Sometimes postgres.js has already reconnected
   * and the query returns zero rows; sometimes the socket is still closing and
   * the query throws CONNECTION_CLOSED. This test originally asserted only the
   * first, passed alone, and failed in the full suite — the two differ by
   * whether an unrelated 3-second test ran first.
   *
   * So the contract asserted here is the one the guard actually needs, which
   * covers both: **it must never answer `true` once the backend is gone.**
   * `acquireSingleton` treats a throw and a false identically — both call
   * `onLost` — so both are the guard working.
   */
  it('never claims the lock after the backend holding it is killed', async () => {
    const client = createLockClient(url);
    try {
      await client`select pg_try_advisory_lock(${LOCK_CLASS}, ${LOCK_OBJECT})`;
      expect(await holdsLock(client)).toBe(true);

      const [me] = await client<{ pid: number }[]>`select pg_backend_pid()::int as pid`;
      const killer = postgres(url, { max: 1 });
      try {
        await killer`select pg_terminate_backend(${me!.pid})`;
      } finally {
        await killer.end({ timeout: 5 });
      }

      // Either answer is correct; `true` is the only wrong one. Polled, because
      // the reconnect may not have settled on the first attempt.
      let claimed: boolean | 'threw' = true;
      for (let attempt = 0; attempt < 20 && claimed === true; attempt += 1) {
        claimed = await holdsLock(client).catch(() => 'threw' as const);
        if (claimed === true) await new Promise((r) => setTimeout(r, 50));
      }
      expect(claimed).not.toBe(true);
    } finally {
      await client.end({ timeout: 5 });
    }
  });

  it('fails closed: losing the lock calls onLost rather than carrying on', async () => {
    const onLost = vi.fn();
    const lock = await held({ heartbeatMs: 50, onLost });

    const killer = postgres(url, { max: 1 });
    try {
      const [row] = await killer<{ pid: number }[]>`
        select l.pid from pg_locks l
         where l.locktype = 'advisory' and l.classid = ${LOCK_CLASS}
           and l.objid = ${LOCK_OBJECT} and l.objsubid = 2 and l.granted limit 1
      `;
      await killer`select pg_terminate_backend(${row!.pid})`;
    } finally {
      await killer.end({ timeout: 5 });
    }

    await vi.waitFor(() => expect(onLost).toHaveBeenCalled(), { timeout: 5_000 });
    expect(String(onLost.mock.calls[0]?.[0])).toMatch(/no longer held|connection failed/);
    void lock;
  });
});
