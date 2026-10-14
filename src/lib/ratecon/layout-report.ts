/**
 * The layout report (docs/llm-reader-design.md §4; Alex, 2026-10-15): which
 * layouts of rate confirmation recur among the AI reads that were saved, and
 * how often the dispatcher left what the AI filled. COUNTS ONLY: it reads the
 * outcome tables, which hold no value, and prints group numbers, counts and
 * shares.
 *
 * The SQL is ONE string, run by `npm run ratecon:layouts-report` and given in
 * HANDOFF; `layout-report.test.ts` holds it against the database and against
 * `groupLayouts` (the same rule on the real PDFs, `--samples`).
 *
 * THE RULE. A read joins the EARLIEST read it is 0.7 similar to (Jaccard of
 * the two label-hash sets), itself when none before it is. Not transitive.
 * Reads with an empty fingerprint are left out. "Earliest" is by
 * (created_at, read id), so a tie has an answer.
 *
 * `kept every filled field`: no field the read filled was changed or cleared.
 * `at least one change`: some field the read filled was changed or cleared.
 * A blank the dispatcher filled is neither.
 */

/** The anchored reads, as a common table expression both queries start from. */
const ANCHORED = `
with o as (
  select read_id, created_at, layout from ratecon_ai_outcomes where cardinality(layout) > 0
), sim as (
  select a.read_id, b.read_id as anchor, b.created_at as anchor_at,
    (select count(*) from (select unnest(a.layout) intersect select unnest(b.layout)) i)::float8
      / (select count(*) from (select unnest(a.layout) union select unnest(b.layout)) u) as j
  from o a join o b on (b.created_at, b.read_id) <= (a.created_at, a.read_id)
), anchored as (
  select distinct on (read_id) read_id, anchor from sim where j >= 0.7 order by read_id, anchor_at, anchor
)`;

/** One row a group: its anchor read, how many reads, how many kept every filled field, how many had a change. */
export const GROUPS_SQL = `${ANCHORED}
, per_read as (
  select an.anchor, an.read_id,
    coalesce(bool_and(f.changed = 0 and f.cleared = 0), true) as kept_all,
    coalesce(bool_or(f.changed + f.cleared > 0), false) as any_change
  from anchored an left join ratecon_ai_outcome_fields f on f.read_id = an.read_id
  group by an.anchor, an.read_id
)
select anchor::text as anchor, count(*)::int as reads,
  (count(*) filter (where kept_all))::int as kept_all, (count(*) filter (where any_change))::int as any_change
from per_read group by anchor order by reads desc, anchor`;

/** One row a group and field name: how many of its reads filled the field, and how many changed or cleared it. */
export const FIELDS_SQL = `${ANCHORED}
select an.anchor::text as anchor, f.field::text as field,
  (count(*) filter (where f.kept + f.changed + f.cleared > 0))::int as filled,
  (count(*) filter (where f.changed + f.cleared > 0))::int as changed
from anchored an join ratecon_ai_outcome_fields f on f.read_id = an.read_id
group by an.anchor, f.field order by an.anchor, f.field::text`;

export interface GroupRow {
  anchor: string;
  reads: number;
  kept_all: number;
  any_change: number;
}
export interface FieldRow {
  anchor: string;
  field: string;
  filled: number;
  changed: number;
}

const pct = (n: number, of: number) => `${Math.round((100 * n) / of)}%`;
const reads = (n: number) => `${n} ${n === 1 ? 'read' : 'reads'}`;

/** The report as lines to print. Group numbers, never an id. */
export function formatLayoutReport(groups: readonly GroupRow[], fields: readonly FieldRow[]): string[] {
  if (groups.length === 0) return ['No outcomes with a layout yet.'];
  const total = groups.reduce((sum, g) => sum + Number(g.reads), 0);
  const out = [`${groups.length} ${groups.length === 1 ? 'group' : 'groups'}, ${reads(total)} (a read is counted with the earliest read it is 0.7 similar to).`];
  groups.forEach((g, i) => {
    const n = Number(g.reads);
    out.push(
      `group ${i + 1}: ${reads(n)}, kept every filled field ${Number(g.kept_all)} of ${n} (${pct(Number(g.kept_all), n)}), at least one change ${Number(g.any_change)} of ${n} (${pct(Number(g.any_change), n)})`,
    );
    for (const f of fields.filter((x) => x.anchor === g.anchor)) {
      out.push(`    ${f.field} ${Number(f.changed)} of ${Number(f.filled)} changed or cleared`);
    }
  });
  return out;
}
