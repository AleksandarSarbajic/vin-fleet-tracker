/**
 * Which layouts of rate confirmation recur (docs/llm-reader-design.md §4;
 * Alex, 2026-10-15). LOCAL ONLY. COUNTS ONLY: no value, label text, hash,
 * file name or read id is printed.
 *
 *   npm run ratecon:layouts-report              the saved AI reads, from the database
 *   npm run ratecon:layouts-report -- --samples the real PDFs in .samples/, from their sent text
 *
 * DATABASE MODE reads `ratecon_ai_outcomes` and its fields (the SQL is in
 * `src/lib/ratecon/layout-report.ts` and HANDOFF) over `DIRECT_URL`, or over
 * `LAYOUTS_REPORT_URL` when that is set; the production database holds them
 * only after migration 0029 is applied there. Per group of similar layouts:
 * the reads, the share where the dispatcher kept every filled field, the
 * share with at least one change, and the change count by field name.
 *
 * SAMPLES MODE fingerprints the text that WOULD be sent for each PDF (the
 * redacted lines), groups them by the same 0.7 rule, and prints how many
 * groups there are and which sample numbers fall in each — to see whether
 * files of one broker group together. Sample numbers are by name order and
 * shift when a file is added.
 */
import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { GROUP_SIMILARITY, groupLayouts, jaccard, layoutLabels } from '../src/lib/ratecon/layout';
import { FIELDS_SQL, GROUPS_SQL, formatLayoutReport, type FieldRow, type GroupRow } from '../src/lib/ratecon/layout-report';
import { prepareForReading } from '../src/lib/ratecon/redact';
import { readRatecon } from '../src/lib/ratecon/templates';
import { readSample, sampleFiles } from './ratecon-corpus.mts';

async function samples() {
  const files = sampleFiles();
  if (files.length === 0) {
    console.info('No .samples/rate-confirmations/ PDFs here, so nothing to report.');
    return;
  }
  const items: { id: string; at: string; labels: string[] }[] = [];
  const template = new Map<string, boolean>();
  const notRead: string[] = [];
  for (const [i, file] of files.entries()) {
    const n = i + 1;
    const pdf = await readSample(file);
    if (!pdf.ok) {
      notRead.push(`sample ${n}: not read as text`);
      continue;
    }
    const prepared = prepareForReading(pdf.lines);
    if (!prepared.ok) {
      notRead.push(`sample ${n}: cannot be prepared (${prepared.reason})`);
      continue;
    }
    const id = `sample ${n}`;
    items.push({ id, at: String(n).padStart(4, '0'), labels: layoutLabels(prepared.lines) });
    template.set(id, readRatecon(pdf.lines).ok);
  }
  const { groups, unlabelled } = groupLayouts(items);
  const labelCounts = items.map((i) => i.labels.length).sort((a, b) => a - b);
  console.info(`${files.length} sample PDFs; ${items.length} with a text layer that can be sent; ${notRead.length} not.`);
  for (const line of notRead) console.info(`  ${line}`);
  if (labelCounts.length > 0) {
    console.info(`Labels per sample (hashes kept, at most 64): least ${labelCounts[0]}, median ${labelCounts[Math.floor(labelCounts.length / 2)]}, most ${labelCounts.at(-1)}.`);
  }
  console.info(`Without any label: ${unlabelled.length}${unlabelled.length ? ` (${unlabelled.join(', ')})` : ''}.`);
  console.info(`\nThe ${GROUP_SIMILARITY} rule makes ${groups.length} groups (a sample joins the earliest sample it is that similar to):`);
  const byId = new Map(items.map((i) => [i.id, i]));
  groups.forEach((g, i) => {
    const anchor = byId.get(g.anchor)!;
    const lowest = Math.min(...g.ids.map((id) => jaccard(anchor.labels, byId.get(id)!.labels)));
    const read = g.ids.filter((id) => template.get(id)).length;
    console.info(
      `  group ${i + 1}: ${g.ids.length} ${g.ids.length === 1 ? 'sample' : 'samples'} (${g.ids.map((id) => id.replace('sample ', '')).join(', ')}); ` +
        `${read} read by a template, ${g.ids.length - read} only by the AI; lowest similarity to the first ${lowest.toFixed(2)}`,
    );
  });
  const anchors = groups.map((g) => byId.get(g.anchor)!);
  const near = anchors
    .flatMap((a, i) => anchors.slice(i + 1).map((b) => ({ a: a.id.replace('sample ', ''), b: b.id.replace('sample ', ''), j: jaccard(a.labels, b.labels) })))
    .filter((p) => p.j > 0.3)
    .sort((x, y) => y.j - x.j)
    .slice(0, 8);
  console.info(`\nGroups whose first samples are between 0.30 and ${GROUP_SIMILARITY} similar (the near misses; at most 8):`);
  for (const p of near.length ? near : [null]) console.info(p ? `  first samples ${p.a} and ${p.b}: ${p.j.toFixed(2)}` : '  none');
}

async function database() {
  loadEnv({ path: '.env.local' });
  const url = process.env.LAYOUTS_REPORT_URL ?? process.env.DIRECT_URL;
  if (!url) {
    console.error('No DIRECT_URL (or LAYOUTS_REPORT_URL) to read the outcomes from.');
    process.exitCode = 1;
    return;
  }
  const sql = postgres(url, { max: 1 });
  try {
    const groups = (await sql.unsafe(GROUPS_SQL)) as unknown as GroupRow[];
    const fields = (await sql.unsafe(FIELDS_SQL)) as unknown as FieldRow[];
    for (const line of formatLayoutReport(groups, fields)) console.info(line);
  } catch (error: unknown) {
    // Never the message: a driver's can quote a query or a row.
    const missing = typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '42703';
    console.error(missing ? 'The layout column is not there: migration 0029 has not been applied to this database.' : `The report could not be read (${error instanceof Error ? error.name : typeof error}).`);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

await (process.argv.includes('--samples') ? samples() : database());
