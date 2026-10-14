import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { describeDb, rolledBack } from '@/test/db';
import type { Tx } from '@/server/audit';
import { groupLayouts } from './layout';
import { FIELDS_SQL, GROUPS_SQL, formatLayoutReport, type FieldRow, type GroupRow } from './layout-report';

/**
 * The layout report (docs/llm-reader-design.md §4): which layouts recur, and
 * how often the dispatcher left what the AI filled. COUNTS ONLY. The SQL that
 * HANDOFF gives and the script runs is one string, held here against the
 * database and against `groupLayouts`, which `ratecon:layouts-report
 * --samples` uses on the real PDFs: the same grouping rule, twice.
 */

const hash = (n: number) => n.toString(16).padStart(8, '0');
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => hash(from + i));

const ME = '00000000-0000-4000-8000-00000000b1b1';

interface Fixture {
  at: string;
  layout: string[];
  fields: { field: string; kept?: number; changed?: number; cleared?: number; blankFilled?: number; blankLeft?: number }[];
}

/** Five outcomes: r1 and r3 share a layout (0.818), r2 is just under 0.7 to r1 (8 of 12), r4 is another, r5 has no labels. */
const FIXTURES: Fixture[] = [
  { at: '2026-10-14T10:00:01Z', layout: range(0, 9), fields: [{ field: 'street', kept: 2 }, { field: 'zip', kept: 2 }] },
  { at: '2026-10-14T10:00:02Z', layout: [...range(0, 7), hash(100), hash(101)], fields: [{ field: 'street', kept: 2 }] },
  { at: '2026-10-14T10:00:03Z', layout: [...range(0, 8), hash(200)], fields: [{ field: 'street', kept: 1, changed: 1 }, { field: 'zip', cleared: 1 }, { field: 'city', blankFilled: 1 }] },
  { at: '2026-10-14T10:00:04Z', layout: range(50, 59), fields: [{ field: 'appointment', changed: 1 }] },
  { at: '2026-10-14T10:00:05Z', layout: [], fields: [{ field: 'street', kept: 1 }] },
];

const insert = async (tx: Tx, fixtures: Fixture[]) => {
  const ids: string[] = [];
  for (const f of fixtures) {
    const id = ((await tx.execute(sql`insert into ratecon_ai_reads (user_id, vendor, lines_sent, outcome) values (${ME}, 'fake', 20, 'ok') returning id`)) as unknown as { id: string }[])[0]!.id;
    ids.push(id);
    await tx.execute(sql`insert into ratecon_ai_outcomes (read_id, created_at, layout) values (${id}, ${f.at}, ${sql.raw(`ARRAY[${f.layout.map((h) => `'${h}'`).join(',')}]::text[]`)})`);
    for (const x of f.fields) {
      await tx.execute(sql`insert into ratecon_ai_outcome_fields (read_id, field, kept, changed, cleared, blank_filled, blank_left)
        values (${id}, ${x.field}::ratecon_ai_field, ${x.kept ?? 0}, ${x.changed ?? 0}, ${x.cleared ?? 0}, ${x.blankFilled ?? 0}, ${x.blankLeft ?? 0})`);
    }
  }
  return ids;
};

describeDb('the report SQL, against the database', () => {
  it('groups by the earliest read each is 0.7 similar to, with the share that kept everything and the share with a change', async () => {
    const { ids, groups } = await rolledBack(async (tx) => {
      const ids = await insert(tx, FIXTURES);
      const groups = (await tx.execute(sql.raw(GROUPS_SQL))) as unknown as GroupRow[];
      return { ids, groups };
    });
    const [r1, r2, r3, r4] = ids as [string, string, string, string, string];
    expect(groups.map((g) => ({ anchor: g.anchor, reads: Number(g.reads), keptAll: Number(g.kept_all), anyChange: Number(g.any_change) }))).toEqual([
      { anchor: r1, reads: 2, keptAll: 1, anyChange: 1 },
      { anchor: r2, reads: 1, keptAll: 1, anyChange: 0 },
      { anchor: r4, reads: 1, keptAll: 0, anyChange: 1 },
    ].sort((a, b) => b.reads - a.reads || (a.anchor < b.anchor ? -1 : 1)));
    void r3;
  });

  it('says, per group and field name, how many reads filled the field and how many changed or cleared it', async () => {
    const { ids, fields } = await rolledBack(async (tx) => {
      const ids = await insert(tx, FIXTURES);
      return { ids, fields: (await tx.execute(sql.raw(FIELDS_SQL))) as unknown as FieldRow[] };
    });
    const r1 = ids[0]!;
    expect(
      fields
        .filter((f) => f.anchor === r1)
        .map((f) => ({ field: f.field, filled: Number(f.filled), changed: Number(f.changed) })),
    ).toEqual([
      { field: 'city', filled: 0, changed: 0 },
      { field: 'street', filled: 2, changed: 1 },
      { field: 'zip', filled: 2, changed: 1 },
    ]);
  });

  it('the grouping is the one `groupLayouts` makes', async () => {
    const { ids, groups } = await rolledBack(async (tx) => {
      const ids = await insert(tx, FIXTURES);
      return { ids, groups: (await tx.execute(sql.raw(GROUPS_SQL))) as unknown as GroupRow[] };
    });
    const mine = groupLayouts(FIXTURES.map((f, i) => ({ id: ids[i]!, at: f.at, labels: f.layout })));
    expect(groups.map((g) => [g.anchor, Number(g.reads)]).sort()).toEqual(mine.groups.map((g) => [g.anchor, g.ids.length]).sort());
    expect(mine.unlabelled).toEqual([ids[4]]);
  });

  it('a read with no labels is in no group; no outcomes is no rows', async () => {
    const rows = await rolledBack(async (tx) => (await tx.execute(sql.raw(GROUPS_SQL))) as unknown as GroupRow[]);
    expect(rows).toEqual([]);
  });

  it('reads at the same moment: the smaller id is the anchor, as in `groupLayouts`', async () => {
    const same = { at: '2026-10-14T10:00:09Z', layout: range(0, 9), fields: [{ field: 'zip', kept: 1 }] };
    const { ids, groups } = await rolledBack(async (tx) => {
      const ids = await insert(tx, [same, same]);
      return { ids, groups: (await tx.execute(sql.raw(GROUPS_SQL))) as unknown as GroupRow[] };
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.anchor).toBe([...ids].sort()[0]);
    expect(Number(groups[0]!.reads)).toBe(2);
  });
});

describe('formatLayoutReport', () => {
  const groups: GroupRow[] = [
    { anchor: 'a', reads: 4, kept_all: 3, any_change: 1 },
    { anchor: 'b', reads: 1, kept_all: 0, any_change: 1 },
  ];
  const fields: FieldRow[] = [
    { anchor: 'a', field: 'street', filled: 4, changed: 1 },
    { anchor: 'a', field: 'zip', filled: 3, changed: 0 },
    { anchor: 'b', field: 'appointment', filled: 1, changed: 1 },
  ];

  it('prints group numbers, counts and shares — never an id', () => {
    const text = formatLayoutReport(groups, fields).join('\n');
    expect(text).toContain('2 groups');
    expect(text).toContain('5 reads');
    expect(text).toMatch(/group 1: 4 reads, kept every filled field 3 of 4 \(75%\), at least one change 1 of 4 \(25%\)/);
    expect(text).toMatch(/street 1 of 4 changed/);
    expect(text).toMatch(/zip 0 of 3 changed/);
    expect(text).toMatch(/group 2: 1 read,/);
    expect(text).not.toMatch(/\ba\b.*anchor|anchor/);
  });

  it('says so when there is nothing yet', () => {
    expect(formatLayoutReport([], []).join('\n')).toMatch(/no outcomes with a layout/i);
  });
});
