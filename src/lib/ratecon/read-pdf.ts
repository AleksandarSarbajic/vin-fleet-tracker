import type { getDocument as GetDocument } from 'pdfjs-dist';
import { linesFromRuns, textLength, type Line, type TextRun } from './lines';
import { ScanCancelled, linesFromScan, type ScanEngine, type ScanProgress } from './read-scan';

/**
 * §12.122. A rate confirmation's text, read from the PDF IN THE BROWSER.
 *
 * The bytes are read into memory, given to pdf.js, and dropped: never
 * uploaded, stored, cached or logged. No message here ever quotes the file.
 */

export const PDF_LIMITS = { bytes: 5 * 1024 * 1024, pages: 10, minText: 40 } as const;

export const PDF_MESSAGES = {
  tooBig: 'This file is larger than 5 MB, so it was not read.',
  notPdf: 'This file is not a PDF.',
  tooManyPages: 'This PDF has more than 10 pages, so it was not read.',
  /** Where no OCR is given: the local scripts. In the browser a scan is read (§12.128). */
  scan: "This is a scan; there's no text to read.",
  scanUnread: 'This is a scan, and no text could be read from it. Type the load from the PDF.',
  scanFailed: 'This is a scan, and the scan reader did not work, so nothing was read. Type the load from the PDF.',
  scanCancelled: 'Stopped reading the scan. Nothing was filled.',
  locked: 'This PDF is password-protected, so it could not be read.',
  unreadable: 'This PDF could not be read.',
} as const;

/** `fromScan`: the lines came from OCR, not a text layer (§12.128), and everything filled from them is marked Check. */
export type PdfOutcome = { ok: true; lines: Line[]; fromScan: boolean } | { ok: false; message: string };

/**
 * §12.128. How to read a PDF with next to no text: the OCR engine, loaded
 * only when one turns out to be a scan, and told when to stop.
 */
export interface ScanReading {
  open(): Promise<ScanEngine & { close(): Promise<void> }>;
  /** `page` 0 while the engine loads. */
  onProgress?: (at: ScanProgress) => void;
  signal?: AbortSignal;
}

interface PdfJs {
  getDocument: typeof GetDocument;
}

/** The first bytes of every PDF: `%PDF-`. The name and the type a browser reports are not evidence. */
const isPdf = (bytes: Uint8Array) =>
  bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-';

/**
 * Read with whichever pdf.js build the caller holds — the browser's, or Node's for the score. A PDF with
 * next to no text is read by OCR when `scan` is given, under the same limits, and refused when it is not.
 */
export async function linesFromPdf(bytes: Uint8Array, pdfjs: PdfJs, scan?: ScanReading): Promise<PdfOutcome> {
  if (bytes.length > PDF_LIMITS.bytes) return { ok: false, message: PDF_MESSAGES.tooBig };
  if (!isPdf(bytes)) return { ok: false, message: PDF_MESSAGES.notPdf };
  let doc: Awaited<ReturnType<typeof GetDocument>['promise']>;
  try {
    doc = await pdfjs.getDocument({
      data: bytes,
      isEvalSupported: false,
      disableFontFace: true,
      enableXfa: false,
      verbosity: 0,
    }).promise;
  } catch (error) {
    // Named, never quoted: a parse error can carry the document's own text.
    return {
      ok: false,
      message: error instanceof Error && error.name === 'PasswordException' ? PDF_MESSAGES.locked : PDF_MESSAGES.unreadable,
    };
  }
  try {
    if (doc.numPages > PDF_LIMITS.pages) return { ok: false, message: PDF_MESSAGES.tooManyPages };
    const runs: TextRun[] = [];
    for (let page = 1; page <= doc.numPages; page += 1) {
      const content = await (await doc.getPage(page)).getTextContent();
      for (const item of content.items) {
        if ('str' in item) runs.push({ page, x: item.transform[4] as number, y: item.transform[5] as number, text: item.str });
      }
    }
    const lines = linesFromRuns(runs);
    if (textLength(lines) >= PDF_LIMITS.minText) return { ok: true, lines, fromScan: false };
    if (!scan) return { ok: false, message: PDF_MESSAGES.scan };
    return await readScan(doc, scan);
  } catch {
    return { ok: false, message: PDF_MESSAGES.unreadable };
  } finally {
    await doc.destroy();
  }
}

/** The scan path: the engine loaded, every page read, the engine closed. Its failures are named, never quoted. */
async function readScan(doc: Parameters<typeof linesFromScan>[0], scan: ScanReading): Promise<PdfOutcome> {
  scan.onProgress?.({ page: 0, of: doc.numPages });
  let engine: Awaited<ReturnType<ScanReading['open']>>;
  try {
    engine = await scan.open();
  } catch {
    return { ok: false, message: PDF_MESSAGES.scanFailed };
  }
  try {
    const lines = await linesFromScan(doc, engine, scan);
    if (textLength(lines) < PDF_LIMITS.minText) return { ok: false, message: PDF_MESSAGES.scanUnread };
    return { ok: true, lines, fromScan: true };
  } catch (error) {
    const cancelled = error instanceof ScanCancelled || scan.signal?.aborted === true;
    return { ok: false, message: cancelled ? PDF_MESSAGES.scanCancelled : PDF_MESSAGES.scanFailed };
  } finally {
    await engine.close();
  }
}

let worker: Worker | null = null;

/**
 * In the browser: pdf.js is loaded only when a PDF is dropped, with its worker from our own bundle; the OCR
 * engine only when that PDF is a scan, from our own origin (`ocr-browser.ts`, §12.128).
 */
export async function linesFromPdfFile(
  file: File,
  scan: Pick<ScanReading, 'onProgress' | 'signal'> = {},
): Promise<PdfOutcome> {
  if (file.size > PDF_LIMITS.bytes) return { ok: false, message: PDF_MESSAGES.tooBig };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdfjs = await import('pdfjs-dist');
  if (!worker) {
    worker = new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module' });
    pdfjs.GlobalWorkerOptions.workerPort = worker;
  }
  return linesFromPdf(bytes, pdfjs, {
    ...scan,
    open: async () => (await import('./ocr-browser')).openBrowserScanEngine(scan.signal),
  });
}
