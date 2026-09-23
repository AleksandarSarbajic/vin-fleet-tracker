import postgres from 'postgres';
import type { Logger } from '@/samsara/client';

/**
 * One worker, enforced by the database rather than by intention (§12.52).
 *
 * `worker/index.ts` has said "exactly one of these should run" since phase 2.
 * That sentence is not a mechanism. Twice now a second instance has existed:
 * once for real — a pre-swap worker that outlived a migration and went on
 * double-writing the routing budget against the same month row — and once
 * nearly, while the §12.61 shadow run was being set up.
 *
 * A second instance is not merely wasteful. Two workers share the ingest
 * cursor, so each advances past pages the other has not read; they both spend
 * from `routing_budget`, so the ceiling that §12.61 sized against HERE's free
 * tier is reached at twice the rate it was calculated for; and they both write
 * `feed_health`, so the stall counters §12.42 exists to make trustworthy start
 * measuring two processes at once.
 *
 * So the second instance must refuse to START, which is the only moment at
 * which refusing is cheap.
 */

/**
 * The lock's identity, as two readable halves rather than one opaque bigint.
 *
 * `pg_try_advisory_lock` has a one-argument bigint form and a two-argument
 * (int, int) form. The two-argument form is used deliberately: `pg_locks`
 * stores the halves in `classid` and `objid` exactly as passed, so the
 * heartbeat below can look the lock up without reproducing Postgres's
 * bit-splitting of the bigint form and being wrong about it silently.
 *
 * 0x564C = "VL", 0x4654 = "FT" — Vin Logistics Fleet Tracker. The value does
 * not matter; being greppable and never colliding with somebody else's
 * advisory lock on the same database does.
 */
export const LOCK_CLASS = 0x564c; // 22092
export const LOCK_OBJECT = 0x4654; // 18004

/** How often the holder re-checks that it is still the holder. */
const HEARTBEAT_MS = 20_000;

export class SingletonLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SingletonLockError';
  }
}

export interface SingletonOptions {
  /** The SESSION pooler. Advisory locks are scoped to a session. */
  url: string;
  logger: Logger;
  heartbeatMs?: number;
  /**
   * Called if the lock is lost while the process is still running.
   *
   * Defaults to killing the process, which is the point: see `verify` below.
   */
  onLost?: (reason: string) => void;
}

export interface Singleton {
  /** Releases the lock and closes the dedicated connection. */
  release(): Promise<void>;
  /** Re-checks that this backend still holds the lock. Exposed for tests. */
  verify(): Promise<boolean>;
}

/**
 * A connection that exists only to hold the lock, and is configured to do
 * nothing else.
 *
 * This is the whole guard, and it is the part that is easy to get wrong.
 * Advisory locks live on a SESSION. `createDirectDb` — the obvious client to
 * reach for — sets `max_lifetime: 60 * 10` and `idle_timeout: 60`, because
 * §12.39 wanted worker connections replaced before a pooler could drop them.
 * Those settings are right for the worker's queries and fatal here: postgres.js
 * would recycle this connection roughly ten minutes in, Postgres would release
 * the lock with it, and nothing would say so. The process would run the rest of
 * its life believing it held a lock it had dropped — a guard that reports
 * success while protecting nothing, which is worse than no guard, because the
 * next person deploying trusts it.
 *
 * Hence: one connection, never recycled, never idled out.
 */
export function createLockClient(url: string): postgres.Sql {
  return postgres(url, {
    max: 1,
    connect_timeout: 10,
    /** Never recycle. The session IS the lock. */
    max_lifetime: 0,
    /** Never close for being idle. Holding the lock is all it ever does. */
    idle_timeout: 0,
    /**
     * A lock query that hangs is a startup that hangs. Generous next to the
     * two statements this connection ever runs, far below a poll interval.
     */
    connection: { statement_timeout: 10_000 },
    /** One connection doing one thing; a pool warning here is noise. */
    onnotice: () => {},
  });
}

/**
 * Does THIS backend hold the lock right now?
 *
 * Not "did a query succeed" — that is the trap. postgres.js reconnects
 * transparently when a connection drops, so `select 1` comes back happily on a
 * brand-new backend that holds nothing at all. The connection surviving and the
 * lock surviving are different facts, and only the second one matters.
 *
 * `pid = pg_backend_pid()` is what makes this the second fact.
 */
export async function holdsLock(client: postgres.Sql): Promise<boolean> {
  const rows = await client<{ n: number }[]>`
    select count(*)::int as n
      from pg_locks
     where locktype = 'advisory'
       and classid  = ${LOCK_CLASS}
       and objid    = ${LOCK_OBJECT}
       and objsubid = 2
       and granted
       and pid = pg_backend_pid()
  `;
  return (rows[0]?.n ?? 0) > 0;
}

/**
 * Takes the lock, or throws.
 *
 * `pg_try_advisory_lock` rather than `pg_advisory_lock`: the blocking form
 * would leave a second instance sitting silently in `pg_locks` waiting for the
 * first to die, and then start it — at some unpredictable later moment, with
 * nobody watching. A second instance should fail loudly at the moment somebody
 * is looking at the terminal.
 */
export async function acquireSingleton(options: SingletonOptions): Promise<Singleton> {
  const { url, logger } = options;
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const onLost =
    options.onLost ??
    ((reason: string) => {
      /**
       * Fail CLOSED. A worker that has lost the lock cannot know whether
       * something else has taken it, and the whole reason the lock exists is
       * that two of these running at once corrupts the cursor and the budget.
       * Carrying on unguarded is the failure mode being prevented, so the only
       * safe move is to stop and let the restart policy try again cleanly.
       */
      logger.error('singleton lock lost — exiting rather than running unguarded', {
        reason,
        remedy: 'the restart policy will retry; if another worker holds it, this is correct',
      });
      process.exit(1);
    });

  const client = createLockClient(url);

  let taken: boolean;
  try {
    const rows = await client<{ locked: boolean }[]>`
      select pg_try_advisory_lock(${LOCK_CLASS}, ${LOCK_OBJECT}) as locked
    `;
    taken = rows[0]?.locked === true;
  } catch (error: unknown) {
    await client.end({ timeout: 5 }).catch(() => {});
    throw new SingletonLockError(
      `Could not reach the database to take the worker lock: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!taken) {
    /**
     * Who holds it, if the database will say. A refusal that names the other
     * process is the difference between "this worked" and a deploy being
     * rolled back by somebody who assumed the new worker was broken.
     */
    let holder = '';
    try {
      const rows = await client<{ pid: number; started: string | null; addr: string | null }[]>`
        select l.pid,
               to_char(a.backend_start at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') as started,
               host(a.client_addr)::text as addr
          from pg_locks l
          left join pg_stat_activity a on a.pid = l.pid
         where l.locktype = 'advisory'
           and l.classid  = ${LOCK_CLASS}
           and l.objid    = ${LOCK_OBJECT}
           and l.objsubid = 2
           and l.granted
         limit 1
      `;
      const row = rows[0];
      if (row) {
        holder =
          ` Held by backend pid ${row.pid}` +
          (row.addr ? ` from ${row.addr}` : '') +
          (row.started ? `, connected since ${row.started} UTC` : '') +
          '.';
      }
    } catch {
      // Diagnostics only. Never let the nicety turn a clean refusal into a crash.
    }

    await client.end({ timeout: 5 }).catch(() => {});
    throw new SingletonLockError(
      'Another worker already holds the singleton lock.' +
        holder +
        ' Refusing to start: two workers share the ingest cursor, the routing ' +
        'budget and feed_health, and none of the three survives being written ' +
        'by both.',
    );
  }

  logger.info('singleton lock acquired', {
    classid: LOCK_CLASS,
    objid: LOCK_OBJECT,
    heartbeatMs,
  });

  let released = false;
  const beat = setInterval(() => {
    void (async () => {
      if (released) return;
      try {
        if (!(await holdsLock(client))) {
          onLost('the advisory lock is no longer held by this backend');
        }
      } catch (error: unknown) {
        onLost(
          `the lock connection failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    })();
  }, heartbeatMs);
  /** The heartbeat must never be the reason the process stays alive. */
  beat.unref?.();

  return {
    verify: () => holdsLock(client),
    async release() {
      if (released) return;
      released = true;
      clearInterval(beat);
      // Ending the connection releases the lock; the unlock is belt and braces
      // and makes the intent visible in the database's own log.
      await client`select pg_advisory_unlock(${LOCK_CLASS}, ${LOCK_OBJECT})`.catch(() => {});
      await client.end({ timeout: 5 }).catch(() => {});
      logger.info('singleton lock released');
    },
  };
}
