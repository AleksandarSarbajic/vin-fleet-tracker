/**
 * `npm run ratecon:review-redacted <number>` — ALEX reads one sample's
 * redacted, numbered lines in a local page, to sign off the redaction or say
 * what it missed (docs/llm-reader-design.md §8.2). Sends nothing anywhere.
 *
 * Prints ONLY the page's URL (127.0.0.1, a random port and path) and serves
 * until Ctrl-C or 30 minutes. Lines the re-scan still flags are shown and
 * highlighted — they are what stops a file from being sent.
 *
 * The page is for a person, locally: no agent, script or tool opens, fetches,
 * prints or screenshots it. See ratecon-review-server.mts for what it serves.
 */
import { redactedForReview } from '../src/lib/ratecon/redact';
import { readRatecon } from '../src/lib/ratecon/templates';
import { reviewPage, startReviewServer } from './ratecon-review-server.mts';
import { readSample, sampleByNumber, sampleFiles } from './ratecon-corpus.mts';

const THIRTY_MINUTES = 30 * 60 * 1000;

function refuse(why: string): never {
  console.error(`ratecon:review-redacted: ${why} Nothing is served.`);
  process.exit(2);
}

const arg = process.argv[2];
const n = arg !== undefined && /^\d+$/.test(arg) ? Number(arg) : NaN;
const files = sampleFiles();
const file = sampleByNumber(files, n);
if (file === null) refuse(`no sample ${arg ?? '(none given)'}; there are ${files.length}, numbered 1 to ${files.length}.`);

const pdf = await readSample(file);
if (!pdf.ok) refuse(`sample ${n} is not read as text (a scan, or refused by the reader).`);

const template = readRatecon(pdf.lines);
const review = redactedForReview(pdf.lines);
const html = reviewPage({
  sample: n,
  template: template.ok ? `read (${template.read.layout})` : 'not recognised',
  lines: review.lines,
  masks: review.masks,
});

const served = await startReviewServer(html, {
  timeoutMs: THIRTY_MINUTES,
  onTimeout: () => process.exit(0),
});
console.info(served.url);
process.on('SIGINT', () => {
  served.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
});
