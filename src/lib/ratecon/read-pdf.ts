import type { getDocument as GetDocument } from 'pdfjs-dist';
import { linesFromRuns, textLength, type Line, type TextRun } from './lines';

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
  scan: "This is a scan; there's no text to read.",
  locked: 'This PDF is password-protected, so it could not be read.',
  unreadable: 'This PDF could not be read.',
} as const;

export type PdfOutcome = { ok: true; lines: Line[] } | { ok: false; message: string };

interface PdfJs {
  getDocument: typeof GetDocument;
}

/** The first bytes of every PDF: `%PDF-`. The name and the type a browser reports are not evidence. */
const isPdf = (bytes: Uint8Array) =>
  bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-';

/** Read with whichever pdf.js build the caller holds — the browser's, or Node's for the score. */
export async function linesFromPdf(bytes: Uint8Array, pdfjs: PdfJs): Promise<PdfOutcome> {
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
    if (textLength(lines) < PDF_LIMITS.minText) return { ok: false, message: PDF_MESSAGES.scan };
    return { ok: true, lines };
  } catch {
    return { ok: false, message: PDF_MESSAGES.unreadable };
  } finally {
    await doc.destroy();
  }
}

let worker: Worker | null = null;

/** In the browser: pdf.js is loaded only when a PDF is dropped, with its worker from our own bundle. */
export async function linesFromPdfFile(file: File): Promise<PdfOutcome> {
  if (file.size > PDF_LIMITS.bytes) return { ok: false, message: PDF_MESSAGES.tooBig };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdfjs = await import('pdfjs-dist');
  if (!worker) {
    worker = new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module' });
    pdfjs.GlobalWorkerOptions.workerPort = worker;
  }
  return linesFromPdf(bytes, pdfjs);
}
