/**
 * `npm run ratecon:check-expected` — is the ground truth written, and is it
 * the right shape? (docs/ground-truth-howto.md). Local only.
 *
 * Per sample by number: complete, how many fields are still blank (`null`),
 * or where the shape is wrong (a path and a code). Never a value or a file
 * name.
 */
import { existsSync, readFileSync } from 'node:fs';
import { EXPECTED_PATH, sampleFiles } from './ratecon-corpus.mts';
import { ExpectedFile, inspect } from './ratecon-expected.mts';

if (!existsSync(EXPECTED_PATH)) {
  console.info(`No ${EXPECTED_PATH}. Nothing to check.`);
  process.exit(0);
}

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(EXPECTED_PATH, 'utf8'));
} catch {
  // Not printed: a JSON parse error quotes the text around it.
  console.error('expected.json is not valid JSON.');
  process.exit(1);
}
const file = ExpectedFile.safeParse(raw);
if (!file.success) {
  console.error(`expected.json: ${file.error.issues.map((i) => `${i.path.join('.') || '(top)'}: ${i.code}`).join('; ')}`);
  process.exit(1);
}

const files = sampleFiles();
const entries = file.data.files;
let complete = 0;
let incomplete = 0;
let invalid = 0;
const missing: number[] = [];
for (const [i, name] of files.entries()) {
  const n = i + 1;
  if (!(name in entries)) {
    missing.push(n);
    continue;
  }
  const r = inspect(entries[name]);
  if (r.state === 'complete') {
    complete += 1;
    const what = 'notRecognised' in r.entry ? 'not recognised (template truth only: no stops for the AI to be scored on)' : `${r.entry.stops.length} stops`;
    console.info(`sample ${n}: complete — ${what}`);
  } else if (r.state === 'incomplete') {
    incomplete += 1;
    console.info(`sample ${n}${r.priority ? ` (priority ${r.priority})` : ''}: ${r.blanks} blank field(s) still to write`);
  } else {
    invalid += 1;
    console.info(`sample ${n}: SHAPE — ${r.problems.join('; ')}`);
  }
}
const stray = Object.keys(entries).filter((k) => !files.includes(k)).length;

console.info(`\n${files.length} samples: ${complete} complete, ${incomplete} still blank in places, ${invalid} wrong shape, ${missing.length} with no entry${missing.length ? ` (samples ${missing.join(', ')})` : ''}.`);
if (stray > 0) console.info(`${stray} entr${stray === 1 ? 'y names' : 'ies name'} no PDF in the folder.`);
if (invalid > 0) process.exitCode = 1;
