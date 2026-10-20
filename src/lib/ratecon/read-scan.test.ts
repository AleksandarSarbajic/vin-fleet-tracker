import { beforeAll, describe, expect, it } from 'vitest';
import { blankScan, nodePdfjs, nodeScanReading, scanOf, type PdfJs } from '@/test/ocr-node';
import { LABEL_ROWS, STOPS_SECTION } from '@/test/ratecon-fixtures';
import { tinyPdf, type TinyRun } from '@/test/tiny-pdf';
import { linesFromRuns, type Line, type TextRun } from './lines';
import { PDF_LIMITS, PDF_MESSAGES, linesFromPdf, type ScanReading } from './read-pdf';
import { runsFromScan, type ScanProgress } from './read-scan';
import { readRatecon, type RateconRead } from './templates';

/**
 * §12.128. Scans read by OCR, through the real pdf.js (Node's build),
 * drawing on @napi-rs/canvas, and the real tesseract.js with the browser's
 * settings — its files from node_modules, nothing fetched. Every PDF is
 * built in memory from invented text, and every scan is that PDF drawn,
 * saved as JPEG and wrapped with no text layer (`scanOf`).
 */

/** OCR is seconds a page; under a full parallel run, more. */
const OCR = 90_000;
/**
 * The twin's tolerance: a run's start and baseline from OCR are within this
 * many PDF units (1/72 inch) of pdf.js's — 0.7 mm. The templates place cells
 * to ±4 (`templates.ts`), and lines are runs within 3 of each other (`lines.ts`).
 */
const TOLERANCE = 2;
/** Text compared without its whitespace: pdf.js joins two runs that touch with no space, OCR sees the gap as one. */
const normal = (text: string) => text.replace(/\s+/g, '');

let pdfjs: PdfJs;
beforeAll(async () => {
  pdfjs = await nodePdfjs();
});

/** The text layer's runs, as `linesFromPdf` collects them. */
async function textRuns(pdf: Uint8Array): Promise<TextRun[]> {
  const doc = await pdfjs.getDocument({ data: pdf.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const runs: TextRun[] = [];
    for (let page = 1; page <= doc.numPages; page += 1) {
      for (const item of (await (await doc.getPage(page)).getTextContent()).items) {
        if ('str' in item && item.str.trim() !== '') runs.push({ page, x: item.transform[4] as number, y: item.transform[5] as number, text: item.str });
      }
    }
    return runs;
  } finally {
    await doc.destroy();
  }
}

/** The scan's runs, read by OCR. */
async function scanRuns(scan: Uint8Array): Promise<TextRun[]> {
  const doc = await pdfjs.getDocument({ data: scan, isEvalSupported: false, verbosity: 0 }).promise;
  const engine = await nodeScanReading().open();
  try {
    return await runsFromScan(doc, engine);
  } finally {
    await engine.close();
    await doc.destroy();
  }
}

const shape = (lines: Line[]) => lines.map((l) => ({ page: l.page, cells: l.cells.map((c) => normal(c.text)) }));
/** What a read says, without where it said it: the values the form is filled with. */
const values = (read: RateconRead) => ({
  layout: read.layout,
  loadNumber: read.loadNumber?.value ?? null,
  stops: read.stops.map((s) => ({
    type: s.type.value,
    street: s.street?.value,
    city: s.city?.value,
    state: s.state?.value,
    zip: s.zip?.value,
    time: s.time.kind === 'exact' || s.time.kind === 'range' ? { ...s.time, source: null } : s.time.kind,
  })),
});

/** The twin: the same invented document as a text PDF and as its scan. */
async function twin(pages: TinyRun[][], skew = 0) {
  const pdf = tinyPdf(pages);
  const text = await textRuns(pdf);
  const ocr = await scanRuns(await scanOf(pdf, pdfjs, 300, skew));
  return { text, ocr, textLines: linesFromRuns(text), ocrLines: linesFromRuns(ocr) };
}

/** Each text-layer run, its OCR twin: the same page and text, the nearest. The largest distance found, in x and y. */
function paired(text: TextRun[], ocr: TextRun[]) {
  const left = [...ocr];
  let dx = 0;
  let dy = 0;
  for (const run of text) {
    const same = left.filter((o) => o.page === run.page && normal(o.text) === normal(run.text));
    expect(same.length, `an OCR run for "${run.text}"`).toBeGreaterThan(0);
    const nearest = same.reduce((a, b) => (Math.hypot(a.x - run.x, a.y - run.y) <= Math.hypot(b.x - run.x, b.y - run.y) ? a : b));
    left.splice(left.indexOf(nearest), 1);
    dx = Math.max(dx, Math.abs(nearest.x - run.x));
    dy = Math.max(dy, Math.abs(nearest.y - run.y));
  }
  return { dx, dy, unpaired: left.length };
}

describe('the twin: a text PDF and its scan give the same lines and cells', () => {
  it(
    'a Stops section over two pages, whose reader splits each line at the "Date:" label’s x',
    async () => {
      const { text, ocr, textLines, ocrLines } = await twin(STOPS_SECTION);
      expect(shape(ocrLines)).toEqual(shape(textLines));
      const { dx, dy, unpaired } = paired(text, ocr);
      expect(unpaired).toBe(0);
      expect(dx).toBeLessThanOrEqual(TOLERANCE);
      expect(dy).toBeLessThanOrEqual(TOLERANCE);
      const [a, b] = [readRatecon(textLines), readRatecon(ocrLines)];
      expect(b.ok && values(b.read)).toEqual(a.ok && values(a.read));
      expect(b.ok && b.read.layout).toBe('stops-section');
    },
    OCR,
  );

  it(
    'label rows, where a label and its value sit a word space apart and are one run in both',
    async () => {
      const { text, ocr, textLines, ocrLines } = await twin(LABEL_ROWS);
      expect(shape(ocrLines)).toEqual(shape(textLines));
      const { dx, dy, unpaired } = paired(text, ocr);
      expect(unpaired).toBe(0);
      expect(dx).toBeLessThanOrEqual(TOLERANCE);
      expect(dy).toBeLessThanOrEqual(TOLERANCE);
      const [a, b] = [readRatecon(textLines), readRatecon(ocrLines)];
      expect(b.ok && values(b.read)).toEqual(a.ok && values(a.read));
    },
    OCR,
  );

  it(
    'scanned 1° askew: turned back, the same lines and the same read — not always the same cells, nor positions, which moved with the paper',
    async () => {
      const { textLines, ocrLines } = await twin(LABEL_ROWS, 1);
      const text = (lines: Line[]) => lines.map((l) => ({ page: l.page, text: normal(l.text) }));
      expect(text(ocrLines)).toEqual(text(textLines));
      const [a, b] = [readRatecon(textLines), readRatecon(ocrLines)];
      expect(b.ok && values(b.read)).toEqual(a.ok && values(a.read));
    },
    OCR,
  );
});

/** The Node reader, counting how often its engine is opened and closed. */
function counted(options: Omit<ScanReading, 'open'> = {}) {
  const base = nodeScanReading(options);
  let closed = 0;
  return {
    ...base,
    closed: () => closed,
    open: async () => {
      const engine = await base.open();
      return {
        ...engine,
        close: async () => {
          closed += 1;
          await engine.close();
        },
      };
    },
  };
}

describe('a scan, through linesFromPdf', () => {
  it(
    'is read, says so, and tells its progress: the engine starting, then each page',
    async () => {
      const seen: ScanProgress[] = [];
      const reading = counted({ onProgress: (at) => seen.push(at) });
      const out = await linesFromPdf(await scanOf(tinyPdf(LABEL_ROWS), pdfjs, 300), pdfjs, reading);
      expect(out.ok && out.fromScan).toBe(true);
      expect(seen).toEqual([{ page: 0, of: 1 }, { page: 1, of: 1 }]);
      expect([reading.opened(), reading.closed()]).toEqual([1, 1]);
      expect(readRatecon(out.ok ? out.lines : []).ok).toBe(true);
    },
    OCR,
  );

  it('a PDF with a text layer is read as before: no OCR is started, and nothing says scan', async () => {
    const reading = counted();
    const pdf = tinyPdf(LABEL_ROWS);
    const withOcr = await linesFromPdf(pdf.slice(), pdfjs, reading);
    const without = await linesFromPdf(pdf.slice(), pdfjs);
    expect(withOcr).toEqual(without);
    expect(withOcr.ok && withOcr.fromScan).toBe(false);
    expect(reading.opened()).toBe(0);
  });

  it(
    'a scan OCR cannot read is refused, plainly, and its engine closed',
    async () => {
      const reading = counted();
      expect(await linesFromPdf(await blankScan(pdfjs, 2), pdfjs, reading)).toEqual({ ok: false, message: PDF_MESSAGES.scanUnread });
      expect(PDF_MESSAGES.scanUnread).toBe('This is a scan, and no text could be read from it. Type the load from the PDF.');
      expect([reading.opened(), reading.closed()]).toEqual([1, 1]);
    },
    OCR,
  );

  it('without OCR (the local scripts) a scan is refused as before', async () => {
    expect(await linesFromPdf(await blankScan(pdfjs), pdfjs)).toEqual({ ok: false, message: "This is a scan; there's no text to read." });
  });

  it('an engine that will not start: refused, and said so', async () => {
    const reading: ScanReading = { open: () => Promise.reject(new Error('worker script 404')) };
    expect(await linesFromPdf(await blankScan(pdfjs), pdfjs, reading)).toEqual({ ok: false, message: PDF_MESSAGES.scanFailed });
  });

  it(
    'stopped before its first page: nothing read, the engine closed',
    async () => {
      const abort = new AbortController();
      abort.abort();
      const reading = counted({ signal: abort.signal });
      expect(await linesFromPdf(await blankScan(pdfjs), pdfjs, reading)).toEqual({ ok: false, message: PDF_MESSAGES.scanCancelled });
      expect(reading.closed()).toBe(1);
    },
    OCR,
  );

  it(
    'stopped in the middle of a page: it returns at once rather than waiting on a worker that is gone, and the engine is closed',
    async () => {
      const abort = new AbortController();
      const reading = counted({
        signal: abort.signal,
        onProgress: ({ page }) => {
          if (page === 1) setTimeout(() => abort.abort(), 300);
        },
      });
      expect(await linesFromPdf(await scanOf(tinyPdf(LABEL_ROWS), pdfjs, 300), pdfjs, reading)).toEqual({
        ok: false,
        message: PDF_MESSAGES.scanCancelled,
      });
      expect(reading.closed()).toBe(1);
    },
    OCR,
  );
});

describe('the limits are the same for a scan, and checked before any OCR', () => {
  it('more than 10 pages', async () => {
    const reading = counted();
    expect(await linesFromPdf(await blankScan(pdfjs, PDF_LIMITS.pages + 1), pdfjs, reading)).toEqual({ ok: false, message: PDF_MESSAGES.tooManyPages });
    expect(reading.opened()).toBe(0);
  });

  it('more than 5 MB, not a PDF, damaged', async () => {
    const reading = counted();
    const big = new Uint8Array(PDF_LIMITS.bytes + 1);
    big.set(new TextEncoder().encode('%PDF-1.4'));
    expect(await linesFromPdf(big, pdfjs, reading)).toEqual({ ok: false, message: PDF_MESSAGES.tooBig });
    expect(await linesFromPdf(new TextEncoder().encode('PK\u0003\u0004'), pdfjs, reading)).toEqual({ ok: false, message: PDF_MESSAGES.notPdf });
    expect(await linesFromPdf(new TextEncoder().encode('%PDF-1.4\nnothing else'), pdfjs, reading)).toEqual({ ok: false, message: PDF_MESSAGES.unreadable });
    expect(reading.opened()).toBe(0);
  });
});
