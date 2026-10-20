import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { getDocument as GetDocument } from 'pdfjs-dist';
import { tinyPdf, tinyScanPdf } from './tiny-pdf';

/**
 * §12.128. Scans of invented documents, made in Node for tests and the e2e
 * spec: a text PDF drawn by pdf.js on @napi-rs/canvas (a dev dependency),
 * saved as JPEG, and wrapped as a PDF with no text layer (`tinyScanPdf`).
 * No file is read but pdf.js's own fonts, and none is written.
 */

const require = createRequire(import.meta.url);

export interface PdfJs {
  getDocument: typeof GetDocument;
}

export async function nodePdfjs(): Promise<PdfJs> {
  return (await import(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'))) as PdfJs;
}

interface NodeCanvas {
  getContext(kind: '2d'): CanvasRenderingContext2D;
  encode(format: 'png'): Promise<Uint8Array>;
  encode(format: 'jpeg', quality: number): Promise<Uint8Array>;
  width: number;
  height: number;
}

/** pdf.js's standard fonts, so an invented text PDF draws the same on every machine. */
const STANDARD_FONTS = `${join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts')}/`;

/**
 * An invented text PDF as a scanner would give it back: each page drawn at
 * `dpi`, turned `skew` degrees clockwise as paper askew on the glass, and
 * saved as a JPEG, with no text layer left.
 */
export async function scanOf(textPdf: Uint8Array, pdfjs: PdfJs, dpi = 200, skew = 0): Promise<Uint8Array> {
  const doc = await pdfjs.getDocument({ data: textPdf.slice(), standardFontDataUrl: STANDARD_FONTS, isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const factory = doc.canvasFactory as Factory;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: dpi / 72 });
      const { canvas, context } = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: context, viewport }).promise;
      const base = page.getViewport({ scale: 1 });
      const image = skew === 0 ? canvas : turned(factory, canvas, skew);
      pages.push({ jpeg: await image.encode('jpeg', 85), width: image.width, height: image.height, media: [base.width, base.height] as [number, number] });
    }
    return tinyScanPdf(pages);
  } finally {
    await doc.destroy();
  }
}

type Factory = { create(w: number, h: number): { canvas: NodeCanvas; context: CanvasRenderingContext2D } };

/** The page turned about its middle on a white sheet of the same size. */
function turned(factory: Factory, page: NodeCanvas, degrees: number): NodeCanvas {
  const { canvas, context } = factory.create(page.width, page.height);
  // The sheet of paper the page lies on: not a colour of the app (§12.128 tests only).
  context.fillStyle = 'white';
  context.fillRect(0, 0, page.width, page.height);
  context.translate(page.width / 2, page.height / 2);
  context.rotate((degrees * Math.PI) / 180);
  context.drawImage(page as unknown as CanvasImageSource, -page.width / 2, -page.height / 2);
  return canvas;
}

/** A scan of blank pages: images, and nothing on them to read. */
export function blankScan(pdfjs: PdfJs, pages = 1): Promise<Uint8Array> {
  return scanOf(tinyPdf(Array.from({ length: pages }, () => [])), pdfjs, 100);
}
