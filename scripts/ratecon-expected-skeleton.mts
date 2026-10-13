/**
 * Ground-truth helper (docs/ground-truth-howto.md): adds a BLANK skeleton
 * entry to `.samples/rate-confirmations/expected.json` for every text-layer
 * sample that has none. `npm run ratecon:expected-skeleton`. Local only.
 *
 * - Priority 1: a layout no template reads — what the AI reader is for.
 * - Priority 2: read by a template but never checked against the PDF.
 * - Scans are skipped: the reader cannot see them yet (phase 4).
 *
 * EXISTING ENTRIES ARE NOT TOUCHED: the new ones are inserted as text before
 * the end of `files`, and the script proves it — the bytes before the
 * insertion and every existing entry hash the same after as before — or
 * writes nothing. Prints sample numbers and hashes only, never a value or a
 * file name. Running it again adds nothing.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { readRatecon } from '../src/lib/ratecon/templates';
import { EXPECTED_PATH, readSample, sampleFiles } from './ratecon-samples.mts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * `null` is "not written yet". It is not `""`, which is ground truth too: the
 * document gives no such value (a load number is permanently optional,
 * §12.21). The appointment is null until one of its forms is chosen.
 */
const blankStop = () => ({ type: null, street: null, city: null, state: null, zip: null, appointment: null });
const skeleton = (priority: 1 | 2) => ({ priority, loadNumber: null, stops: [blankStop(), blankStop()] });

const before = readFileSync(EXPECTED_PATH, 'utf8');
const parsed = JSON.parse(before) as { files: Record<string, unknown> };
const END = '\n  }\n}\n';
if (Object.keys(parsed).at(-1) !== 'files' || !before.endsWith(END)) {
  console.error('expected.json is not laid out as this helper expects (files last, 2-space indent). Nothing written.');
  process.exit(1);
}

const files = sampleFiles();
const added: { n: number; priority: 1 | 2; file: string }[] = [];
const skipped: string[] = [];
for (const [i, file] of files.entries()) {
  if (file in parsed.files) continue;
  const pdf = await readSample(file);
  if (!pdf.ok) {
    skipped.push(`sample ${i + 1}`);
    continue;
  }
  added.push({ n: i + 1, priority: readRatecon(pdf.lines).ok ? 2 : 1, file });
}

if (added.length === 0) {
  console.info('Every text-layer sample already has an entry. Nothing written.');
  process.exit(0);
}

const at = before.length - END.length;
const entry = (a: (typeof added)[number]) =>
  `    ${JSON.stringify(a.file)}: ${JSON.stringify(skeleton(a.priority), null, 2).replace(/\n/g, '\n    ')}`;
const after = `${before.slice(0, at)},\n${added.map(entry).join(',\n')}${END}`;

// The proof, before anything is written.
const reparsed = JSON.parse(after) as { files: Record<string, unknown> };
const existing = Object.keys(parsed.files);
const prefixSame = sha(before.slice(0, at)) === sha(after.slice(0, at));
const entriesSame = existing.every((k) => sha(JSON.stringify(parsed.files[k])) === sha(JSON.stringify(reparsed.files[k])));
const othersSame = Object.keys(parsed).every((k) => k === 'files' || JSON.stringify((parsed as Record<string, unknown>)[k]) === JSON.stringify((reparsed as Record<string, unknown>)[k]));
if (!prefixSame || !entriesSame || !othersSame) {
  console.error('The existing entries would change. Nothing written.');
  process.exit(1);
}
writeFileSync(EXPECTED_PATH, after);

const number = (k: string) => files.indexOf(k) + 1;
console.info(`Existing entries: ${existing.length} (samples ${existing.map(number).sort((a, b) => a - b).join(', ')}), untouched:`);
console.info(`  bytes before the insertion, sha256 before ${sha(before.slice(0, at)).slice(0, 16)}… after ${sha(after.slice(0, at)).slice(0, 16)}…`);
for (const k of existing.sort((a, b) => number(a) - number(b))) {
  console.info(`  sample ${number(k)}: entry sha256 ${sha(JSON.stringify(reparsed.files[k])).slice(0, 16)}… (same before and after)`);
}
for (const p of [1, 2] as const) {
  const these = added.filter((a) => a.priority === p).map((a) => a.n);
  console.info(`Added, priority ${p}: ${these.length} (samples ${these.join(', ')})`);
}
console.info(`Skipped (not read as text): ${skipped.length}${skipped.length ? ` (${skipped.join(', ')})` : ''}`);
