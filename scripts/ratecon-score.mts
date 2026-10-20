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
 * Prints PASS or FAIL per field per file and NEVER a value: files are
 * numbered, not named (a file name can be a load number), and no field's
 * text is printed, right or wrong.
 *
 * Appointments score three ways: `exact` — filled and unmarked, and right;
 * `marked` — the stop says Check or Couldn't read, so a person will look;
 * `WRONG` — filled, unmarked, and not what the PDF says. Only WRONG fails:
 * that is the one a dispatcher would not see.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fillLoad } from '../src/components/edit/ratecon-fill';
import { loadFormFrom, type StopForm } from '../src/components/edit/load-form';
import { linesFromPdf } from '../src/lib/ratecon/read-pdf';
import { readRatecon } from '../src/lib/ratecon/templates';
import { nodeScanReading } from '../src/test/ocr-node';
import { appointmentScore, appointmentVerdict, inspect, type CompleteEntry, type ExpectedStop } from './ratecon-expected.mts';

const DIR = '.samples/rate-confirmations';

/** The entries' shape is `ratecon-expected.mts`; an entry still blank in places is skipped. */
interface Expected {
  scoredAt: string;
  files: Record<string, unknown>;
}

const mark = (ok: boolean) => (ok ? 'pass' : 'FAIL');

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
  let failures = 0;
  let bar = 0;
  let barOf = 0;
  for (const [n, file] of files.entries()) {
    const label = `sample ${n + 1}`;
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
      failures += 1;
      continue;
    }
    const want: CompleteEntry = inspected.entry;
    const pdf = await linesFromPdf(new Uint8Array(readFileSync(join(DIR, file))), pdfjs, nodeScanReading());
    if (!pdf.ok) {
      console.info(`${label}: FAIL — the PDF was not read (${pdf.message})`);
      failures += 1;
      continue;
    }
    const outcome = readRatecon(pdf.lines);
    if ('notRecognised' in want) {
      console.info(`${label}: layout not recognised — ${outcome.ok ? 'FAIL, it was read as a known layout' : 'pass (expected: not one of the six layouts)'}`);
      if (outcome.ok) failures += 1;
      continue;
    }
    if (!outcome.ok && want.priority === 1) {
      // Priority 1 is a layout no template reads: ground truth for the AI
      // reader's evaluation, not a template failure.
      console.info(`${label}: not a template layout — ground truth for the AI evaluation only`);
      continue;
    }
    barOf += 1;
    if (!outcome.ok) {
      console.info(`${label}: FAIL — layout not recognised`);
      failures += 1;
      continue;
    }
    const filled = fillLoad(loadFormFrom(null, now.toISOString(), null), outcome.read, now.toISOString(), now, pdf.fromScan ? 'scan' : 'text');
    if (!filled.ok) {
      console.info(`${label}: FAIL — ${filled.message}`);
      failures += 1;
      continue;
    }
    const stops = filled.form.stops;
    const results: [string, boolean][] = [
      ['load number', filled.form.loadNumber === want.loadNumber],
      ['stop count', stops.length === want.stops.length],
    ];
    const per = (field: string, test: (got: StopForm, w: ExpectedStop) => boolean) =>
      want.stops.map((w, i) => (stops[i] ? test(stops[i]!, w) : false));
    const fields: [string, boolean[]][] = [
      ['order + type', per('type', (g, w) => g.stopType === w.type)],
      ['street', per('street', (g, w) => g.addressLine === w.street)],
      ['ZIP', per('zip', (g, w) => g.zip === w.zip)],
      ['city', per('city', (g, w) => g.city === w.city)],
      ['state', per('state', (g, w) => g.state === w.state)],
    ];
    const appts = want.stops.map((w, i) => (stops[i] ? appointmentScore(stops[i]!, w.appointment) : 'WRONG'));
    // Printed with which parts differ, by name: "WRONG (date, time)".
    const apptsSaid = want.stops.map((w, i) => (stops[i] ? appointmentVerdict(stops[i]!, w.appointment) : 'WRONG (missing)'));
    const allBar = results.every(([, ok]) => ok) && fields.every(([, oks]) => oks.every(Boolean));
    if (allBar) bar += 1;
    const wrong = !allBar || appts.includes('WRONG');
    if (wrong) failures += 1;
    console.info(`${label} (${outcome.read.layout}, ${stops.length} stops${pdf.fromScan ? ', a scan read by OCR' : ''}): ${wrong ? 'FAIL' : 'pass'}`);
    for (const [name, ok] of results) console.info(`  ${name.padEnd(14)} ${mark(ok)}`);
    for (const [name, oks] of fields) console.info(`  ${name.padEnd(14)} ${oks.map((ok, i) => `stop ${i + 1} ${mark(ok)}`).join('   ')}`);
    console.info(`  ${'appointment'.padEnd(14)} ${apptsSaid.map((a, i) => `stop ${i + 1} ${a}`).join('   ')}`);
  }
  console.info(`\nThe bar (load number, stop count, order and type, street, ZIP, city, state all exact): ${bar} of ${barOf}`);
  console.info(`Appointments silently wrong: ${failures === 0 ? 'none' : 'see FAIL above'}`);
  if (failures > 0) process.exitCode = 1;
}

await main();
