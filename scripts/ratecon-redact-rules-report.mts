/**
 * What the two 2026-10-14.3 redaction rules newly mask, on the real samples,
 * LOCAL ONLY. `npm run ratecon:redact-rules-report [sample numbers...]`
 *
 *   A: a bare 10- or 11-digit phone (assigned area code, no identifier label)
 *   B: a name in the row below a header row that names a person
 *   C: a name before " at <COMPANY>" ("Dana Example at ACME FREIGHT INC")
 *
 * Sends nothing; no network. Prints COUNTS by sample number and never a line
 * of text, a value or a file name. Per sample: lines sent; lines each rule
 * masked and how many masks; whether the re-scan is clean; and whether a
 * LOAD-NUMBER-LIKE cell (6 to 12 digits with an identifier label just before
 * it) is still in the sent text, yes or no; and whether an ALL-CAPS cell with
 * no company word still sits under a person header (it should not). A rule that masks 20 or more
 * lines on one sample is called out: that is a stop, not a number to tune.
 * Rule C is expected to fire on none of the existing samples: if it does, the
 * report says so and stops for review. Also, per sample with a complete ground
 * truth, how many of its load number, streets, cities and ZIPs that are in
 * the sample's own text are still in the text that would be sent (yes/no and
 * k of n; the ground truth is read here, locally, and never printed).
 * Default samples: the 12 only the AI reads (2, 4, 7, 8, 9, 10, 11, 12, 16,
 * 17, 21, 29).
 */
import { identifierLabelBefore, maskPersonCell, prepareForReading, redactedForReview } from '../src/lib/ratecon/redact';
import { readFileSync } from 'node:fs';
import { EXPECTED_PATH, readSample, sampleByNumber, sampleFiles } from './ratecon-corpus.mts';
import { ExpectedFile, inspect } from './ratecon-expected.mts';

// Numbers are by name order, and a new file shifts the ones after it: on 2026-10-15 a file became 22, so the
// twelve are 2, 4, 7, 8, 9, 10, 11, 12, 16, 17, 21 and 29 (29 was 28; HANDOFF entries before 3w use the old numbers).
const AI_ONLY = [2, 4, 7, 8, 9, 10, 11, 12, 16, 17, 21, 29];
const STOP_AT = 20;
const expected = (() => {
  try {
    const parsed = ExpectedFile.safeParse(JSON.parse(readFileSync(EXPECTED_PATH, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
})();
const LOAD_NUMBER_LIKE = /(?<![\w-])\d{6,12}(?![\w-])/g;

/** Rule B's gap, as a check apart from the mask: under a person header, in its reach, an ALL-CAPS cell it would still mask. */
function allCapsLeftUnderHeader(lines: readonly { text: string; page: number | null; header: boolean; below: number }[]): boolean {
  const onlyPlaceholders = (t: string) => t.replace(/\[(?:EMAIL|PHONE|AMOUNT|REMOVED|ID|URL)\]/g, '').replace(/[\s,;/|-]+/g, '') === '';
  return lines.some((header, i) => {
    if (!header.header) return false;
    for (let j = i + 1; j <= i + 2 && j < lines.length; j += 1) {
      const line = lines[j]!;
      if (line.page !== header.page || line.header) return false;
      if (line.text.split('  ').some((cell) => /[A-Z]/.test(cell) && cell === cell.toUpperCase() && maskPersonCell(cell) !== null)) return true;
      // The next line reaches the one after it only when it was blank or placeholders and nothing was masked in it.
      if (!(onlyPlaceholders(line.text) && line.below === 0)) return false;
    }
    return false;
  });
}

/** A value as it could stand in a text: lower case, one space between words, no trailing punctuation. */
const flat = (v: string): string => v.toLowerCase().replace(/\s+/g, ' ').replace(/[\s.,;:]+$/, '');

/** How many of a sample's ground-truth values are in the raw text, and how many of those are still in the sent text. */
function truthKept(raw: string, sent: string, entry: unknown): { load: string; fields: string } | null {
  const inspected = inspect(entry);
  if (inspected.state !== 'complete' || 'notRecognised' in inspected.entry) return null;
  const rawFlat = flat(raw);
  const sentFlat = flat(sent);
  const tally = (values: readonly string[]) => {
    const inRaw = values.filter((v) => v !== '' && rawFlat.includes(flat(v)));
    return { inRaw: inRaw.length, kept: inRaw.filter((v) => sentFlat.includes(flat(v))).length };
  };
  const load = tally([inspected.entry.loadNumber]);
  const parts = (['street', 'city', 'zip'] as const).map((k) => tally(inspected.entry.stops.map((st) => st[k])));
  const loadSaid = load.inRaw === 0 ? 'not in text' : load.kept === load.inRaw ? 'yes' : 'NO';
  return { load: loadSaid, fields: parts.map((t, i) => `${['streets', 'cities', 'ZIPs'][i]} ${t.kept}/${t.inRaw}`).join(', ') };
}

const loadNumberLike = (text: string): boolean =>
  [...text.matchAll(LOAD_NUMBER_LIKE)].some((m) => identifierLabelBefore(text.slice(0, m.index)));

const selectPagesText = (lines: Parameters<typeof redactedForReview>[0]): string => lines.map((l) => l.text).join('\n');

async function main() {
  const files = sampleFiles();
  if (files.length === 0) {
    console.info('No .samples/rate-confirmations/ PDFs here, so nothing to report.');
    return;
  }
  const asked = process.argv.slice(2).map(Number);
  const numbers = asked.length > 0 ? asked : AI_ONLY;
  console.info(`${numbers.length} samples, numbered in name order. Counts and line numbers only.\n`);
  console.info(
    ['sample', 'lines sent', 'A lines', 'A masks', 'B lines', 'B masks', 'phone masks (all)', 'labelled masks (all)', 're-scan clean', 'load-number-like left', 'all-caps non-company cell under a person header', 'C lines', 'C masks', 'ground truth in sent text']
      .join(' | '),
  );
  const stops: string[] = [];
  const aAt: string[] = [];
  const bAt: string[] = [];
  const cAt: string[] = [];
  const truth: string[] = [];
  for (const n of numbers) {
    const file = sampleByNumber(files, n);
    if (file === null) {
      console.info(`${n} | no such sample`);
      continue;
    }
    const pdf = await readSample(file);
    if (!pdf.ok) {
      console.info(`${n} | not read as text`);
      continue;
    }
    const review = redactedForReview(pdf.lines);
    const prepared = prepareForReading(pdf.lines);
    const aLines = review.lines.filter((l) => l.bare > 0);
    const bLines = review.lines.filter((l) => l.below > 0);
    const aMasks = aLines.reduce((sum, l) => sum + l.bare, 0);
    const bMasks = bLines.reduce((sum, l) => sum + l.below, 0);
    const clean = review.lines.every((l) => l.residue.length === 0) && prepared.ok;
    const left = review.lines.some((l) => loadNumberLike(l.text));
    const capsLeft = allCapsLeftUnderHeader(review.lines);
    const cLines = review.lines.filter((l) => l.company > 0);
    const cMasks = cLines.reduce((sum, l) => sum + l.company, 0);
    const kept = expected && prepared.ok ? truthKept(selectPagesText(pdf.lines), prepared.text, expected.files[file]) : null;
    if (kept) truth.push(`sample ${n}: load number ${kept.load}; ${kept.fields}`);
    if (aLines.length > 0) aAt.push(`sample ${n}: ${aLines.map((l) => `L${l.n} (${l.bare})`).join('; ')}`);
    if (cLines.length > 0) cAt.push(`sample ${n}: ${cLines.map((l) => `L${l.n} (${l.company})`).join('; ')}`);
    if (bLines.length > 0) bAt.push(`sample ${n}: ${bLines.map((l) => `L${l.n} (${l.below})`).join('; ')}`);
    if (aLines.length >= STOP_AT) stops.push(`sample ${n}: rule A masked ${aLines.length} lines`);
    if (bLines.length >= STOP_AT) stops.push(`sample ${n}: rule B masked ${bLines.length} lines`);
    console.info(
      [n, review.lines.length, aLines.length, aMasks, bLines.length, bMasks, review.masks.phone, review.masks.labelled, clean ? 'yes' : 'NO', left ? 'yes' : 'no', capsLeft ? 'YES' : 'no', cLines.length, cMasks, kept ? `${kept.load === 'NO' ? 'LOAD NUMBER LOST' : 'load ok'}; ${kept.fields}` : 'no complete ground truth'].join(' | '),
    );
  }
  console.info(`\nRule A, by line number (masks in brackets; never the text):`);
  for (const line of aAt.length ? aAt : ['none']) console.info(`  ${line}`);
  console.info(`\nRule B, by line number (masks in brackets; never the text):`);
  for (const line of bAt.length ? bAt : ['none']) console.info(`  ${line}`);
  console.info(`\nRule C, by line number (masks in brackets; never the text):`);
  for (const line of cAt.length ? cAt : ['none']) console.info(`  ${line}`);
  console.info(`\nGround truth in the text that would be sent (values in the sample's own text, kept / in it; never the values):`);
  for (const line of truth.length ? truth : ['none']) console.info(`  ${line}`);
  if (cAt.length > 0) {
    console.info(`\nSTOP FOR REVIEW — rule C fired on an existing sample; it was expected to fire on none.`);
    process.exitCode = 1;
  }
  if (stops.length > 0) {
    console.info(`\nSTOP — ${STOP_AT} or more lines masked by one rule on one sample; do not tune:`);
    for (const line of stops) console.info(`  ${line}`);
    process.exitCode = 1;
  }
}

await main();
