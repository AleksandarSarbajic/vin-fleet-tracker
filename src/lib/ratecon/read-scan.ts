import type { PDFDocumentProxy } from 'pdfjs-dist';
import { linesFromRuns, type Line, type TextRun } from './lines';
import { runsFromOcr, type OcrLine } from './ocr-runs';

/**
 * §12.128. A scanned rate confirmation, read by OCR: each page rendered with
 * the pdf.js that already opened it, read by an OCR engine, and turned into
 * the same lines a text layer gives (`ocr-runs.ts`). The engine is given: in
 * the browser, tesseract.js from our own origin (`ocr-browser.ts`); in tests
 * and the local report, the same engine from `node_modules`.
 *
 * Like the text path, nothing is uploaded, stored, cached or logged, and the
 * pages are dropped as soon as they are read.
 */

/** Pages are rendered at this resolution, as a scanner would at 300 dpi — and never larger than this many pixels. */
export const SCAN_RENDER = { dpi: 300, maxPixels: 16_000_000, maxSide: 4096 } as const;

/** What reads a rendered page. */
export interface ScanEngine {
  /** The canvas pdf.js drew the page on, as PNG bytes. */
  png(canvas: unknown): Promise<Uint8Array>;
  /** The lines and words OCR found in a page image, in its pixels. */
  recognise(png: Uint8Array, dpi: number): Promise<OcrLine[]>;
}

export interface ScanProgress {
  /** 0 while the engine loads, then each page as it is read. */
  page: number;
  of: number;
}

interface CanvasAndContext {
  canvas: unknown;
  context: unknown;
}

/** pdf.js's own canvas factory: the DOM's in a browser, @napi-rs/canvas in Node. Typed `Object` by pdf.js. */
interface CanvasFactory {
  create(width: number, height: number): CanvasAndContext;
  destroy(canvasAndContext: CanvasAndContext): void;
}

/** The scale a page is drawn at: 300 dpi, held under the pixel and side limits a browser canvas has. */
export function scanScale(width: number, height: number): number {
  const wanted = SCAN_RENDER.dpi / 72;
  const byArea = Math.sqrt(SCAN_RENDER.maxPixels / (width * height));
  const bySide = SCAN_RENDER.maxSide / Math.max(width, height);
  return Math.min(wanted, byArea, bySide);
}

export class ScanCancelled extends Error {
  constructor() {
    super('The scan read was cancelled.');
    this.name = 'ScanCancelled';
  }
}

type ScanOptions = { onProgress?: (at: ScanProgress) => void; signal?: AbortSignal };

/**
 * Every page, rendered and read, as lines — page by page, top to bottom,
 * left to right, as `linesFromRuns` orders a text layer. `onProgress` is
 * told before each page; a `signal` stops between pages.
 */
export async function linesFromScan(doc: PDFDocumentProxy, engine: ScanEngine, options: ScanOptions = {}): Promise<Line[]> {
  return linesFromRuns(await runsFromScan(doc, engine, options));
}

/** Every page, rendered and read, as runs in PDF space: what pdf.js's text layer gives for a PDF that has one. */
export async function runsFromScan(doc: PDFDocumentProxy, engine: ScanEngine, options: ScanOptions = {}): Promise<TextRun[]> {
  const factory = doc.canvasFactory as CanvasFactory;
  const runs: TextRun[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    if (options.signal?.aborted) throw new ScanCancelled();
    options.onProgress?.({ page: n, of: doc.numPages });
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = scanScale(base.width, base.height);
    const viewport = page.getViewport({ scale });
    const drawn = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
    try {
      await page.render({ canvasContext: drawn.context as CanvasRenderingContext2D, viewport }).promise;
      const png = await engine.png(drawn.canvas);
      if (options.signal?.aborted) throw new ScanCancelled();
      const lines = await engine.recognise(png, Math.round(72 * scale));
      runs.push(
        ...runsFromOcr(lines, n, (x, y) => {
          const [px, py] = viewport.convertToPdfPoint(x, y) as [number, number];
          return [px, py];
        }),
      );
    } finally {
      factory.destroy(drawn);
      page.cleanup();
    }
  }
  return runs;
}
