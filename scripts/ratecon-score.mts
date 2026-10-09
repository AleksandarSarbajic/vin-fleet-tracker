/**
 * §12.122. How the rate-confirmation fill does on the real samples.
 * `npm run ratecon:score`
 *
 * Reads `.samples/rate-confirmations/` ONLY when it exists — it is
 * git-ignored and never committed — and scores each PDF against that
 * folder's own `expected.json`, which is ground truth written by hand and
 * lives there for the same reason. The PDFs go through the same code the
 * browser runs: read, recognise, fill.
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

const DIR = '.samples/rate-confirmations';

interface ExpectedStop {
  type: 'PU' | 'DEL';
  street: string;
  city: string;
  state: string;
  zip: string;
  appointment:
    | { couldntRead: true; date: string }
    | { type: 'APPT'; date: string; time: string; windowMinutes: number; marked?: boolean }
    | { type: 'FCFS'; date: string; time: string; endTime: string; marked?: boolean };
}
interface Expected {
  scoredAt: string;
  files: Record<string, { notRecognised: true } | { loadNumber: string; stops: ExpectedStop[] }>;
}

const mark = (ok: boolean) => (ok ? 'pass' : 'FAIL');

function appointmentScore(
  stop: StopForm,
  want: ExpectedStop['appointment'],
): 'exact' | 'marked, filled as the PDF says' | 'marked, filled differently' | 'WRONG' {
  const marked = Boolean(stop.fill?.checks.appointment);
  const a = stop.appointment;
  const right =
    'couldntRead' in want
      ? a.enabled && a.date === want.date && a.time === ''
      : a.enabled &&
        a.type === want.type &&
        a.date === want.date &&
        a.time === want.time &&
        (want.type === 'FCFS' ? a.endTime === want.endTime : a.windowMinutes === want.windowMinutes);
  if (marked) return right ? 'marked, filled as the PDF says' : 'marked, filled differently';
  return right ? 'exact' : 'WRONG';
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
  let failures = 0;
  let bar = 0;
  let barOf = 0;
  for (const [n, file] of files.entries()) {
    const label = `sample ${n + 1}`;
    const want = expected.files[file];
    if (!want) {
      console.info(`${label}: no ground truth in expected.json — skipped`);
      continue;
    }
    const pdf = await linesFromPdf(new Uint8Array(readFileSync(join(DIR, file))), pdfjs);
    if (!pdf.ok) {
      console.info(`${label}: FAIL — the PDF was not read (${pdf.message})`);
      failures += 1;
      continue;
    }
    const outcome = readRatecon(pdf.lines);
    if ('notRecognised' in want) {
      console.info(`${label}: layout not recognised — ${outcome.ok ? 'FAIL, it was read as a known layout' : 'pass (expected: not one of the three layouts)'}`);
      if (outcome.ok) failures += 1;
      continue;
    }
    barOf += 1;
    if (!outcome.ok) {
      console.info(`${label}: FAIL — layout not recognised`);
      failures += 1;
      continue;
    }
    const filled = fillLoad(loadFormFrom(null, now.toISOString(), null), outcome.read, now.toISOString(), now);
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
    const allBar = results.every(([, ok]) => ok) && fields.every(([, oks]) => oks.every(Boolean));
    if (allBar) bar += 1;
    const wrong = !allBar || appts.includes('WRONG');
    if (wrong) failures += 1;
    console.info(`${label} (${outcome.read.layout}, ${stops.length} stops): ${wrong ? 'FAIL' : 'pass'}`);
    for (const [name, ok] of results) console.info(`  ${name.padEnd(14)} ${mark(ok)}`);
    for (const [name, oks] of fields) console.info(`  ${name.padEnd(14)} ${oks.map((ok, i) => `stop ${i + 1} ${mark(ok)}`).join('   ')}`);
    console.info(`  ${'appointment'.padEnd(14)} ${appts.map((a, i) => `stop ${i + 1} ${a}`).join('   ')}`);
  }
  console.info(`\nThe bar (load number, stop count, order and type, street, ZIP, city, state all exact): ${bar} of ${barOf}`);
  console.info(`Appointments silently wrong: ${failures === 0 ? 'none' : 'see FAIL above'}`);
  if (failures > 0) process.exitCode = 1;
}

await main();
