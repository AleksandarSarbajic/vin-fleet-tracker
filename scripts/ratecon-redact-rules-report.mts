/**
 * What the two 2026-10-14.3 redaction rules newly mask, on the real samples,
 * LOCAL ONLY. `npm run ratecon:redact-rules-report [sample numbers...]`
 *
 *   A: a bare 10- or 11-digit phone (assigned area code, no identifier label)
 *   B: a name in the row below a header row that names a person
 *
 * Sends nothing; no network. Prints COUNTS by sample number and never a line
 * of text, a value or a file name. Per sample: lines sent; lines each rule
 * masked and how many masks; whether the re-scan is clean; and whether a
 * LOAD-NUMBER-LIKE cell (6 to 12 digits with an identifier label just before
 * it) is still in the sent text, yes or no. A rule that masks 20 or more
 * lines on one sample is called out: that is a stop, not a number to tune.
 * Default samples: the 12 only the AI reads (2, 4, 7, 8, 9, 10, 11, 12, 16,
 * 17, 21, 28).
 */
import { identifierLabelBefore, prepareForReading, redactedForReview } from '../src/lib/ratecon/redact';
import { readSample, sampleByNumber, sampleFiles } from './ratecon-corpus.mts';

const AI_ONLY = [2, 4, 7, 8, 9, 10, 11, 12, 16, 17, 21, 28];
const STOP_AT = 20;
const LOAD_NUMBER_LIKE = /(?<![\w-])\d{6,12}(?![\w-])/g;

const loadNumberLike = (text: string): boolean =>
  [...text.matchAll(LOAD_NUMBER_LIKE)].some((m) => identifierLabelBefore(text.slice(0, m.index)));

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
    ['sample', 'lines sent', 'A lines', 'A masks', 'B lines', 'B masks', 'phone masks (all)', 'labelled masks (all)', 're-scan clean', 'load-number-like left']
      .join(' | '),
  );
  const stops: string[] = [];
  const aAt: string[] = [];
  const bAt: string[] = [];
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
    if (aLines.length > 0) aAt.push(`sample ${n}: ${aLines.map((l) => `L${l.n} (${l.bare})`).join('; ')}`);
    if (bLines.length > 0) bAt.push(`sample ${n}: ${bLines.map((l) => `L${l.n} (${l.below})`).join('; ')}`);
    if (aLines.length >= STOP_AT) stops.push(`sample ${n}: rule A masked ${aLines.length} lines`);
    if (bLines.length >= STOP_AT) stops.push(`sample ${n}: rule B masked ${bLines.length} lines`);
    console.info(
      [n, review.lines.length, aLines.length, aMasks, bLines.length, bMasks, review.masks.phone, review.masks.labelled, clean ? 'yes' : 'NO', left ? 'yes' : 'no'].join(' | '),
    );
  }
  console.info(`\nRule A, by line number (masks in brackets; never the text):`);
  for (const line of aAt.length ? aAt : ['none']) console.info(`  ${line}`);
  console.info(`\nRule B, by line number (masks in brackets; never the text):`);
  for (const line of bAt.length ? bAt : ['none']) console.info(`  ${line}`);
  if (stops.length > 0) {
    console.info(`\nSTOP — ${STOP_AT} or more lines masked by one rule on one sample; do not tune:`);
    for (const line of stops) console.info(`  ${line}`);
    process.exitCode = 1;
  }
}

await main();
