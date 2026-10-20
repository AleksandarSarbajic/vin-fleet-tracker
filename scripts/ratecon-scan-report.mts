/**
 * §12.128. The scan reader on the real samples. LOCAL ONLY, COUNTS ONLY.
 * `npm run ratecon:scan-report`
 *
 * Sends nothing; no network. tesseract.js runs in Node with the browser's
 * settings (`ocr-engine.ts`), its files from `node_modules`, its language
 * data a local path, and nothing cached to disk (`src/test/ocr-node.ts`).
 *
 * For each sample the text path refuses as a scan, read as the browser
 * reads it, prints by sample NUMBER (name order, as every report numbers
 * them): pages; OCR time per page on this machine; characters and lines
 * read; the template that reads it, or none; and whether redaction prepares
 * it (so Read with AI would be offered) and how many lines it would send.
 * Never a line of text, a value, a name or a file name.
 *
 * Then what a browser downloads for its first scan: the OCR files as served
 * (gzipped, as a server would send them), and the time to start the engine
 * here.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { OCR_ASSETS } from '../src/lib/ratecon/ocr-assets';
import { PDF_MESSAGES, linesFromPdf } from '../src/lib/ratecon/read-pdf';
import { prepareForReading } from '../src/lib/ratecon/redact';
import { readRatecon } from '../src/lib/ratecon/templates';
import { textLength } from '../src/lib/ratecon/lines';
import { nodePdfjs, nodeScanReading } from '../src/test/ocr-node';
import { SAMPLES_DIR, readSample, sampleFiles } from './ratecon-corpus.mts';

const require = createRequire(import.meta.url);
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

function assets() {
  console.info('\nWhat a browser downloads for its first scan (from our origin; then cached as any file is, the language data also in IndexedDB):');
  let raw = 0;
  let gz = 0;
  for (const { from, to } of OCR_ASSETS) {
    const bytes = readFileSync(require.resolve(from));
    // The language data is already gzip and is sent as it is; the scripts a server compresses.
    const sent = to.endsWith('.gz') ? bytes.length : gzipSync(bytes).length;
    console.info(`  ${to}: ${kb(bytes.length)}, ${kb(sent)} sent`);
    // One of the three core builds is fetched: count the largest.
    if (to.startsWith('core/') && !to.includes('relaxedsimd')) continue;
    raw += bytes.length;
    gz += sent;
  }
  console.info(`  A first scan fetches the worker, ONE core build and the language data: about ${kb(raw)}, ${kb(gz)} sent.`);
}

async function main() {
  const files = sampleFiles();
  if (files.length === 0) {
    console.info('No .samples/rate-confirmations/ PDFs here, so nothing to report.');
    assets();
    return;
  }
  console.info(`${files.length} sample PDFs in ${SAMPLES_DIR}, numbered in name order. Counts only.\n`);
  console.info(['sample', 'pages', 'OCR ms per page', 'chars', 'lines', 'template', 'prepared', 'lines sent'].join(' | '));

  const pdfjs = await nodePdfjs();
  let scans = 0;
  for (const [i, file] of files.entries()) {
    const n = i + 1;
    const text = await readSample(file);
    if (text.ok || text.message !== PDF_MESSAGES.scan) continue;
    scans += 1;
    const marks: number[] = [];
    const reading = nodeScanReading({ onProgress: ({ page }) => (page > 0 ? marks.push(performance.now()) : undefined) });
    const out = await linesFromPdf(new Uint8Array(readFileSync(`${SAMPLES_DIR}/${file}`)), pdfjs, reading);
    const end = performance.now();
    const perPage = marks.map((at, k) => Math.round((marks[k + 1] ?? end) - at));
    if (!out.ok) {
      const reason = Object.entries(PDF_MESSAGES).find(([, m]) => m === out.message)?.[0] ?? 'unreadable';
      console.info([n, marks.length, perPage.join(' / '), '—', '—', `refused (${reason})`, '—', '—'].join(' | '));
      continue;
    }
    const template = readRatecon(out.lines);
    const prepared = prepareForReading(out.lines);
    console.info(
      [
        n,
        new Set(out.lines.map((l) => l.page)).size === marks.length ? marks.length : `${marks.length} (text on ${new Set(out.lines.map((l) => l.page)).size})`,
        perPage.join(' / '),
        textLength(out.lines),
        out.lines.length,
        template.ok ? `read (${template.read.layout})` : 'not recognised',
        prepared.ok ? 'yes' : `no (${prepared.reason})`,
        prepared.ok ? prepared.lines.length : '—',
      ].join(' | '),
    );
  }
  console.info(`\nScans: ${scans}.`);

  const t0 = performance.now();
  const engine = await nodeScanReading().open();
  const started = performance.now() - t0;
  await engine.close();
  console.info(`\nStarting the engine here (worker, core, language data from disk): ${Math.round(started)} ms.`);
  assets();
}

await main();
