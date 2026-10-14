import { expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { describeDb, rolledBack } from '@/test/db';
import type { Tx } from '@/server/audit';

/**
 * What the dispatcher did with an AI read (docs/llm-reader-design.md §4):
 * the two tables hold COUNTS ONLY, are deny-by-default, are linked to the
 * read's counts row, and refuse a count a read cannot produce.
 */

const ME = '00000000-0000-4000-8000-00000000a1a1';

const columnsOf = (table: string) =>
  rolledBack(
    async (tx) =>
      (await tx.execute<{ name: string; type: string }>(sql`
        select column_name as name, data_type as type from information_schema.columns
        where table_schema = 'public' and table_name = ${table} order by column_name`)) as unknown as { name: string; type: string }[],
  );

const read = async (tx: Tx) =>
  ((await tx.execute(sql`insert into ratecon_ai_reads (user_id, vendor, lines_sent, outcome) values (${ME}, 'fake', 20, 'ok') returning id`)) as unknown as { id: string }[])[0]!.id;

describeDb('ratecon_ai_outcomes and ratecon_ai_outcome_fields: counts only', () => {
  it('the parent holds no text: a read id and a time', async () => {
    expect(await columnsOf('ratecon_ai_outcomes')).toEqual([
      { name: 'created_at', type: 'timestamp with time zone' },
      { name: 'read_id', type: 'uuid' },
    ]);
  });

  it('the fields table holds no text: a read id, a field NAME from a fixed list, and five small numbers', async () => {
    expect(await columnsOf('ratecon_ai_outcome_fields')).toEqual([
      { name: 'blank_filled', type: 'smallint' },
      { name: 'blank_left', type: 'smallint' },
      { name: 'changed', type: 'smallint' },
      { name: 'cleared', type: 'smallint' },
      { name: 'field', type: 'USER-DEFINED' },
      { name: 'kept', type: 'smallint' },
      { name: 'read_id', type: 'uuid' },
    ]);
  });

  it('the field names are a closed list', async () => {
    const names = await rolledBack(
      async (tx) =>
        ((await tx.execute<{ label: string }>(sql`
          select e.enumlabel as label from pg_enum e join pg_type t on t.oid = e.enumtypid
          where t.typname = 'ratecon_ai_field' order by e.enumsortorder`)) as unknown as { label: string }[]).map((r) => r.label),
    );
    expect(names).toEqual(['load_number', 'stop_type', 'street', 'city', 'state', 'zip', 'appointment']);
  });

  it.each(['ratecon_ai_outcomes', 'ratecon_ai_outcome_fields'])('%s is deny-by-default: RLS on, a deny-all policy, nothing granted to anon or authenticated', async (table) => {
    const out = await rolledBack(
      async (tx) =>
        ((await tx.execute<{ rls: boolean; policies: number; anon: boolean; authed: boolean }>(sql`
          select c.relrowsecurity as rls,
            (select count(*)::int from pg_policies p where p.tablename = ${table} and p.qual = 'false') as policies,
            has_table_privilege('anon', ${`public.${table}`}, 'select,insert,update,delete') as anon,
            has_table_privilege('authenticated', ${`public.${table}`}, 'select,insert,update,delete') as authed
          from pg_class c where c.relname = ${table}`)) as unknown as { rls: boolean; policies: number; anon: boolean; authed: boolean }[])[0],
    );
    expect(out).toEqual({ rls: true, policies: 1, anon: false, authed: false });
  });

  it('one outcome a read: a second parent row for the same read is refused', async () => {
    await expect(
      rolledBack(async (tx) => {
        const id = await read(tx);
        await tx.execute(sql`insert into ratecon_ai_outcomes (read_id) values (${id})`);
        await tx.execute(sql`insert into ratecon_ai_outcomes (read_id) values (${id})`);
      }),
    ).rejects.toThrow();
  });

  it('an outcome needs a read: no parent row for an id that is not one', async () => {
    await expect(rolledBack((tx) => tx.execute(sql`insert into ratecon_ai_outcomes (read_id) values (${'00000000-0000-4000-8000-0000000000ff'})`))).rejects.toThrow();
  });

  it('the counts follow the read: deleting the read (the 90-day clean-up) takes its outcome with it', async () => {
    const left = await rolledBack(async (tx) => {
      const id = await read(tx);
      await tx.execute(sql`insert into ratecon_ai_outcomes (read_id) values (${id})`);
      await tx.execute(sql`insert into ratecon_ai_outcome_fields (read_id, field, kept) values (${id}, 'street', 2)`);
      await tx.execute(sql`delete from ratecon_ai_reads where id = ${id}`);
      return ((await tx.execute(sql`select (select count(*)::int from ratecon_ai_outcomes) as o, (select count(*)::int from ratecon_ai_outcome_fields) as f`)) as unknown as { o: number; f: number }[])[0];
    });
    expect(left).toEqual({ o: 0, f: 0 });
  });

  it('one row a field a read', async () => {
    await expect(
      rolledBack(async (tx) => {
        const id = await read(tx);
        await tx.execute(sql`insert into ratecon_ai_outcomes (read_id) values (${id})`);
        await tx.execute(sql`insert into ratecon_ai_outcome_fields (read_id, field, kept) values (${id}, 'street', 1)`);
        await tx.execute(sql`insert into ratecon_ai_outcome_fields (read_id, field, kept) values (${id}, 'street', 1)`);
      }),
    ).rejects.toThrow();
  });

  it.each([
    ['a negative count', 'kept', -1],
    ['more than a load can hold', 'changed', 11],
  ] as const)('%s is refused by the table', async (_, column, value) => {
    await expect(
      rolledBack(async (tx) => {
        const id = await read(tx);
        await tx.execute(sql`insert into ratecon_ai_outcomes (read_id) values (${id})`);
        await tx.execute(sql.raw(`insert into ratecon_ai_outcome_fields (read_id, field, ${column}) values ('${id}', 'street', ${value})`));
      }),
    ).rejects.toThrow();
  });

  it('the counts for a field cannot add up to more than the stops a load holds, or more than one load number', async () => {
    await expect(
      rolledBack(async (tx) => {
        const id = await read(tx);
        await tx.execute(sql`insert into ratecon_ai_outcomes (read_id) values (${id})`);
        await tx.execute(sql`insert into ratecon_ai_outcome_fields (read_id, field, kept, changed, blank_left) values (${id}, 'zip', 6, 3, 2)`);
      }),
    ).rejects.toThrow();
    await expect(
      rolledBack(async (tx) => {
        const id = await read(tx);
        await tx.execute(sql`insert into ratecon_ai_outcomes (read_id) values (${id})`);
        await tx.execute(sql`insert into ratecon_ai_outcome_fields (read_id, field, kept, changed) values (${id}, 'load_number', 1, 1)`);
      }),
    ).rejects.toThrow();
  });

  it('a field name outside the list is refused', async () => {
    await expect(
      rolledBack(async (tx) => {
        const id = await read(tx);
        await tx.execute(sql`insert into ratecon_ai_outcomes (read_id) values (${id})`);
        await tx.execute(sql.raw(`insert into ratecon_ai_outcome_fields (read_id, field, kept) values ('${id}', 'dock', 1)`));
      }),
    ).rejects.toThrow();
  });

  it('a valid outcome stores', async () => {
    const rows = await rolledBack(async (tx) => {
      const id = await read(tx);
      await tx.execute(sql`insert into ratecon_ai_outcomes (read_id) values (${id})`);
      await tx.execute(sql`insert into ratecon_ai_outcome_fields (read_id, field, kept, changed, cleared, blank_filled, blank_left) values (${id}, 'street', 3, 1, 0, 0, 0), (${id}, 'load_number', 1, 0, 0, 0, 0)`);
      return (await tx.execute(sql`select field::text as field, kept, changed from ratecon_ai_outcome_fields where read_id = ${id} order by field`)) as unknown as Record<string, unknown>[];
    });
    expect(rows).toEqual([
      { field: 'load_number', kept: 1, changed: 0 },
      { field: 'street', kept: 3, changed: 1 },
    ]);
  });
});
