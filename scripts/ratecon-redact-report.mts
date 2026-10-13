/**
 * Step 0 of the real-sample evaluation (docs/llm-reader-design.md §8.2):
 * redaction and page selection on every text-layer sample, LOCAL ONLY.
 * `npm run ratecon:redact-report`
 *
 * Sends nothing; no network. Prints COUNTS per file by number and never a
 * line of text, a value or a file name:
 *   - whether a template reads it (the reader only runs after a miss);
 *   - lines and pages in, lines and pages that would be sent;
 *   - masks per category;
 *   - residual detector hits (the redaction fails closed on any);
 *   - whether it is too large to send.
 * Scans and refused PDFs are listed by reason, from the reader's own codes.
 */
import { PDF_MESSAGES } from '../src/lib/ratecon/read-pdf';
import { prepareForReading, type MaskKind } from '../src/lib/ratecon/redact';
import { readRatecon } from '../src/lib/ratecon/templates';
import { readSample, sampleFiles } from './ratecon-corpus.mts';

const KINDS: readonly MaskKind[] = ['email', 'phone', 'amount', 'labelled', 'id', 'url'];

/** The reader's fixed refusal, by its key — never its sentence, which could change. */
const refusal = (message: string) =>
  (Object.entries(PDF_MESSAGES).find(([, m]) => m === message)?.[0] ?? 'unreadable') as string;

const pages = (lines: readonly { page: number | null }[]) => new Set(lines.map((l) => l.page)).size;

async function main() {
  const files = sampleFiles();
  if (files.length === 0) {
    console.info('No .samples/rate-confirmations/ PDFs here, so nothing to report.');
    return;
  }
  console.info(`${files.length} sample PDFs, numbered in name order. Counts only.\n`);
  console.info(
    ['sample', 'template', 'lines in', 'pages in', 'lines sent', 'pages sent', ...KINDS, 'residue', 'too large']
      .join(' | '),
  );

  let textLayer = 0;
  let residual = 0;
  let tooLarge = 0;
  const notText: string[] = [];
  for (const [i, file] of files.entries()) {
    const n = i + 1;
    const pdf = await readSample(file);
    if (!pdf.ok) {
      notText.push(`sample ${n}: ${refusal(pdf.message)}`);
      continue;
    }
    textLayer += 1;
    const template = readRatecon(pdf.lines);
    const read = template.ok ? `read (${template.read.layout})` : 'not recognised';
    const prepared = prepareForReading(pdf.lines);
    const row: (string | number)[] = [n, read, pdf.lines.length, pages(pdf.lines)];
    if (prepared.ok) {
      row.push(prepared.lines.length, pages(prepared.lines), ...KINDS.map((k) => prepared.masks[k]), 0, 'no');
    } else if (prepared.reason === 'residue') {
      residual += prepared.kinds.length;
      row.push('—', '—', ...KINDS.map(() => '—'), `${prepared.kinds.length} (${prepared.kinds.join(', ')})`, 'no');
    } else {
      if (prepared.reason === 'too-large') tooLarge += 1;
      row.push('—', '—', ...KINDS.map(() => '—'), 0, prepared.reason === 'too-large' ? 'YES' : prepared.reason);
    }
    console.info(row.join(' | '));
  }

  console.info(`\nText-layer samples: ${textLayer}. Not read as text: ${notText.length}.`);
  for (const line of notText) console.info(`  ${line}`);
  console.info(`Residual detector hits: ${residual}${residual === 0 ? '' : ' — MUST be 0; nothing with a hit can be sent'}.`);
  console.info(`Too large to send: ${tooLarge}.`);
  if (residual > 0) process.exitCode = 1;
}

await main();
