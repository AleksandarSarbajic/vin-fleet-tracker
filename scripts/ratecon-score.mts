/**
 * §12.122. How the rate-confirmation fill does on the real samples.
 * `npm run ratecon:score`
 *
 * Reads `.samples/rate-confirmations/` ONLY when it exists — it is
 * git-ignored and never committed — and scores each PDF against that
 * folder's own `expected.json`, which is ground truth written by hand and
 * lives there for the same reason. The PDFs go through the same code the
 * browser runs: read, recognise, fill. A scan is read by OCR as the browser
 * reads one (§12.128), here in Node (`src/test/ocr-node.ts`: nothing
 * fetched, nothing cached), and filled as a scan, every field marked.
 *
 * Prints pass or FAIL per field per file and NEVER a value: files are
 * numbered, not named (a file name can be a load number), and no field's
 * text is printed, right or wrong. This file reads, fills and prints; what
 * each line says is worked out in `ratecon-score-lines.mts`, under test.
 *
 * A bar field that is right is `pass`, marked or not. A wrong one is
 * `FAIL (marked)` when the fill's own Check is on it, so a person will look,
 * and `FAIL` when nothing marks it (phase 3az). A sample fails on either.
 *
 * Appointments score three ways: `exact` — filled and unmarked, and right;
 * `marked` — the stop says Check or Couldn't read, so a person will look;
 * `WRONG` — filled, unmarked, and not what the PDF says. Only WRONG fails:
 * that is the one a dispatcher would not see.
 *
 * A sample not read says why: no layout recognised, one recognised and
 * refused, or more than one. At the end, beside the bar: every field wrong
 * and not marked, and every appointment silently wrong, or "none".
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fillLoad } from '../src/components/edit/ratecon-fill';
import { loadFormFrom } from '../src/components/edit/load-form';
import { linesFromPdf } from '../src/lib/ratecon/read-pdf';
import { readRatecon, recognisedLayouts } from '../src/lib/ratecon/templates';
import { nodeScanReading } from '../src/test/ocr-node';
import { inspect, type CompleteEntry } from './ratecon-expected.mts';
import { expectedNotReadLine, newTally, notReadLine, scoreSample, scoredLines, summaryLines, tallyFailed, tallyScored } from './ratecon-score-lines.mts';

const DIR = '.samples/rate-confirmations';

/** The entries' shape is `ratecon-expected.mts`; an entry still blank in places is skipped. */
interface Expected {
  scoredAt: string;
  files: Record<string, unknown>;
}

async function main() {
  if (!existsSync(DIR)) {
    console.info(`No ${DIR}/ here, so nothing to score.`);
    return;
  }
  const expectedPath = join(DIR, 'expected.json');
  if (!existsSync(expectedPath)) {
    console.info(`No ${expectedPath}: write the ground truth first (see the header of this script).`);
    process.exitCode = 1;
    return;
  }
  const expected = JSON.parse(readFileSync(expectedPath, 'utf8')) as Expected;
  const require = createRequire(import.meta.url);
  const pdfjs = await import(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
  const now = new Date(expected.scoredAt);

  const files = readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
  const tally = newTally();
  for (const [i, file] of files.entries()) {
    const n = i + 1;
    const label = `sample ${n}`;
    if (!(file in expected.files)) {
      console.info(`${label}: no ground truth in expected.json — skipped`);
      continue;
    }
    const inspected = inspect(expected.files[file]);
    if (inspected.state === 'incomplete') {
      console.info(`${label}: ground truth not written yet (${inspected.blanks} blank) — skipped`);
      continue;
    }
    if (inspected.state === 'invalid') {
      console.info(`${label}: FAIL — expected.json entry is the wrong shape (npm run ratecon:check-expected)`);
      tallyFailed(tally, n, 'ground truth wrong shape', false);
      continue;
    }
    const want: CompleteEntry = inspected.entry;
    const pdf = await linesFromPdf(new Uint8Array(readFileSync(join(DIR, file))), pdfjs, nodeScanReading());
    if (!pdf.ok) {
      console.info(`${label}: FAIL — the PDF was not read (${pdf.message})`);
      tallyFailed(tally, n, 'PDF not read', false);
      continue;
    }
    const outcome = readRatecon(pdf.lines);
    if ('notRecognised' in want) {
      console.info(expectedNotReadLine(n, outcome.ok ? outcome.read.layout : null, recognisedLayouts(pdf.lines)));
      if (outcome.ok) tallyFailed(tally, n, 'read, expected not', false);
      continue;
    }
    if (!outcome.ok) {
      const aiOnly = want.priority === 1;
      console.info(notReadLine(n, recognisedLayouts(pdf.lines), aiOnly));
      if (!aiOnly) tallyFailed(tally, n, 'not read', true);
      continue;
    }
    const filled = fillLoad(loadFormFrom(null, now.toISOString(), null), outcome.read, now.toISOString(), now, pdf.fromScan ? 'scan' : 'text');
    if (!filled.ok) {
      console.info(`${label}: FAIL — ${filled.message}`);
      tallyFailed(tally, n, 'fill refused', true);
      continue;
    }
    const score = scoreSample(filled.form, want);
    tallyScored(tally, n, score);
    for (const line of scoredLines(n, { layout: outcome.read.layout, stops: filled.form.stops.length, fromScan: pdf.fromScan }, score)) console.info(line);
  }
  console.info('');
  for (const line of summaryLines(tally)) console.info(line);
  if (tally.failed > 0) process.exitCode = 1;
}

await main();
