import { afterEach, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { commitDb, describeDb, rolledBack } from '@/test/db';
import type { Tx } from '@/server/audit';

vi.mock('server-only', () => ({}));
const { finishRead, reserveRead } = await import('./reads');

/**
 * The language-model reader's counts (docs/llm-reader-design.md §4): one row
 * a read, counts only, and the daily caps reserved atomically.
 */

const TZ = 'America/Chicago';
const ME = '00000000-0000-4000-8000-00000000a1a1';
const YOU = '00000000-0000-4000-8000-00000000b2b2';
const caps = (userCap: number, dailyCap: number) => ({ tz: TZ, userCap, dailyCap });
const reserve = (db: Tx | ReturnType<typeof commitDb>, userId: string, userCap = 25, dailyCap = 100) =>
  reserveRead(db, { userId, vendor: 'fake', linesSent: 20, ...caps(userCap, dailyCap) });

/** A row at a moment named in the dispatch zone's terms: `local midnight today` plus an interval. */
const rowAt = (tx: Tx, userId: string, fromLocalMidnight: string) =>
  tx.execute(sql`
    insert into ratecon_ai_reads (user_id, vendor, lines_sent, outcome, created_at)
    values (${userId}, 'fake', 1, 'ok',
      (date_trunc('day', now() at time zone ${TZ}) + ${fromLocalMidnight}::interval) at time zone ${TZ})`);
const count = async (tx: Tx | ReturnType<typeof commitDb>, where = sql`true`) =>
  ((await tx.execute<{ n: number }>(sql`select count(*)::int as n from ratecon_ai_reads where ${where}`)) as unknown as { n: number }[])[0]!.n;

describeDb('ratecon_ai_reads: counts only', () => {
  it('holds no text: every column is a uuid, a time, a number or an enum', async () => {
    const columns = await rolledBack(
      async (tx) =>
        (await tx.execute<{ name: string; type: string }>(sql`
          select column_name as name, data_type as type from information_schema.columns
          where table_schema = 'public' and table_name = 'ratecon_ai_reads' order by column_name`)) as unknown as {
          name: string;
          type: string;
        }[],
    );
    expect(columns).toEqual([
      { name: 'created_at', type: 'timestamp with time zone' },
      { name: 'id', type: 'uuid' },
      { name: 'input_tokens', type: 'integer' },
      { name: 'lines_sent', type: 'integer' },
      { name: 'outcome', type: 'USER-DEFINED' },
      { name: 'output_tokens', type: 'integer' },
      { name: 'user_id', type: 'uuid' },
      { name: 'vendor', type: 'USER-DEFINED' },
    ]);
  });

  it('is deny-by-default: RLS on, a deny-all policy, and nothing granted to anon or authenticated', async () => {
    const out = await rolledBack(
      async (tx) =>
        ((await tx.execute<{ rls: boolean; policies: number; anon: boolean; authed: boolean }>(sql`
          select c.relrowsecurity as rls,
            (select count(*)::int from pg_policies p where p.tablename = 'ratecon_ai_reads' and p.qual = 'false') as policies,
            has_table_privilege('anon', 'public.ratecon_ai_reads', 'select,insert,update,delete') as anon,
            has_table_privilege('authenticated', 'public.ratecon_ai_reads', 'select,insert,update,delete') as authed
          from pg_class c where c.relname = 'ratecon_ai_reads'`)) as unknown as {
          rls: boolean;
          policies: number;
          anon: boolean;
          authed: boolean;
        }[])[0],
    );
    expect(out).toEqual({ rls: true, policies: 1, anon: false, authed: false });
  });
});

describeDb('the daily caps, reserved before the vendor is called', () => {
  it('reserves a pending row, and the outcome and usage land on it after', async () => {
    const row = await rolledBack(async (tx) => {
      const r = await reserve(tx, ME);
      if (!('id' in r)) throw new Error('capped');
      await finishRead(tx, r.id, { outcome: 'ok', inputTokens: 3200, outputTokens: 540 });
      return ((await tx.execute(sql`select user_id, outcome, vendor, lines_sent, input_tokens, output_tokens from ratecon_ai_reads where id = ${r.id}`)) as unknown as Record<string, unknown>[])[0];
    });
    expect(row).toEqual({ user_id: ME, outcome: 'ok', vendor: 'fake', lines_sent: 20, input_tokens: 3200, output_tokens: 540 });
  });

  it('a pending reservation counts against the cap: a read that never finishes is not free', async () => {
    const out = await rolledBack(async (tx) => {
      await reserve(tx, ME, 1);
      return reserve(tx, ME, 1);
    });
    expect(out).toEqual({ capped: 'user' });
  });

  it("refuses a user at their cap, and not the next user", async () => {
    const out = await rolledBack(async (tx) => {
      await rowAt(tx, ME, '1 hour');
      await rowAt(tx, ME, '2 hours');
      return [await reserve(tx, ME, 2), 'id' in (await reserve(tx, YOU, 2))];
    });
    expect(out).toEqual([{ capped: 'user' }, true]);
  });

  it('refuses everyone at the daily cap', async () => {
    const out = await rolledBack(async (tx) => {
      await rowAt(tx, ME, '1 hour');
      await rowAt(tx, YOU, '2 hours');
      return reserve(tx, '00000000-0000-4000-8000-00000000c3c3', 25, 2);
    });
    expect(out).toEqual({ capped: 'daily' });
  });

  it("counts the dispatch zone's day: a read a minute before local midnight was yesterday's", async () => {
    const out = await rolledBack(async (tx) => {
      await rowAt(tx, ME, '-1 minute');
      const yesterday = await reserve(tx, ME, 1);
      await rowAt(tx, YOU, '0 minutes');
      return [yesterday, await reserve(tx, YOU, 1)];
    });
    expect('id' in out[0]!).toBe(true);
    expect(out[1]).toEqual({ capped: 'user' });
  });

  it('keeps counts 90 days: a reservation deletes rows older than that', async () => {
    const left = await rolledBack(async (tx) => {
      await rowAt(tx, ME, '-91 days');
      await rowAt(tx, ME, '-89 days');
      await reserve(tx, YOU);
      return count(tx, sql`user_id = ${ME}`);
    });
    expect(left).toBe(1);
  });
});

/**
 * Two reservations at cap−1, each in its own committed transaction. Started
 * together they barely overlap — the first finishes while the second's
 * connection opens — so a race would pass by luck. They are made to collide:
 * a third transaction holds the table in SHARE mode, both reservations block
 * at their first write, and both are let go at once. Without the advisory
 * lock both count one and both insert; with it they take turns. Committed
 * rows, so `fleet_commit`, cleaned up after.
 */
describeDb('the cap under concurrency (fleet_commit)', () => {
  const db = () => commitDb();
  afterEach(async () => {
    await db().execute(sql`delete from ratecon_ai_reads where user_id in (${ME}, ${YOU})`);
  });

  /**
   * Backends waiting on THIS table or on the reservation's own advisory key
   * (0x72636169, below 2^31, so classid 0) — not on any lock: other suites
   * in fleet_commit hold row locks of their own, and the route's tests may
   * be reserving too, so at least two, not exactly two.
   */
  const waitingOnLocks = async () =>
    ((await db().execute<{ n: number }>(sql`
      select count(distinct pid)::int as n from pg_locks
      where not granted and database = (select oid from pg_database where datname = current_database())
        and ((locktype = 'relation' and relation = 'ratecon_ai_reads'::regclass)
          or (locktype = 'advisory' and classid = 0 and objid = ${0x7263_6169} and objsubid = 1))`)) as unknown as {
      n: number;
    }[])[0]!.n;

  it('two reservations at cap−1, let go together: exactly one goes through', async () => {
    await db().execute(sql`insert into ratecon_ai_reads (user_id, vendor, lines_sent, outcome) values (${ME}, 'fake', 1, 'ok')`);
    let racing: Promise<Awaited<ReturnType<typeof reserve>>[]> | null = null;
    await db().transaction(async (holder) => {
      await holder.execute(sql`lock table ratecon_ai_reads in share mode`);
      racing = Promise.all([reserve(db(), ME, 2), reserve(db(), ME, 2)]);
      for (let i = 0; i < 200 && (await waitingOnLocks()) < 2; i += 1) await new Promise((r) => setTimeout(r, 10));
      expect(await waitingOnLocks()).toBeGreaterThanOrEqual(2);
    });
    const results = await racing!;
    expect(results.filter((r) => 'id' in r)).toHaveLength(1);
    expect(results.filter((r) => 'capped' in r)).toEqual([{ capped: 'user' }]);
    expect(await count(db(), sql`user_id = ${ME}`)).toBe(2);
  });
});
