import type Tesseract from 'tesseract.js';
import type { OcrLine } from './ocr-runs';
import { ScanCancelled, type ScanEngine } from './read-scan';

/**
 * §12.128. tesseract.js as the scan engine, set up the same way in the
 * browser (`ocr-browser.ts`, assets from our own origin) and in Node (tests
 * and the local report, assets from `node_modules`): the same model, the
 * same page segmentation, the same words out. Only where its files come
 * from differs.
 */

type TesseractModule = Pick<typeof Tesseract, 'createWorker' | 'OEM' | 'PSM'>;

/**
 * The English LSTM model ("4.0.0_best_int"), no legacy engine. The page is
 * segmented automatically, as a page of blocks: a rate confirmation is
 * columns and boxes, not one column of prose.
 */
export const OCR_LANGUAGE = 'eng';

export function ocrLinesFrom(blocks: readonly Tesseract.Block[] | null): OcrLine[] {
  return (blocks ?? []).flatMap((block) =>
    block.paragraphs.flatMap((paragraph) =>
      paragraph.lines.map((line) => ({
        baseline: line.baseline,
        words: line.words.map((word) => ({ text: word.text, box: word.bbox })),
      })),
    ),
  );
}

/**
 * A page being read, until the signal says stop: then it rejects at once
 * with `ScanCancelled`. Ending the worker would not do it — a terminated
 * tesseract.js worker never settles the page it was reading — so the read
 * gives up on the page, and its caller closes the engine and the document.
 */
function untilStopped<T>(job: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return job;
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new ScanCancelled());
    if (signal.aborted) {
      stop();
      return;
    }
    signal.addEventListener('abort', stop, { once: true });
    job.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

/**
 * A worker, ready to read. `paths` says where its worker script, core and
 * language data come from; `png` turns pdf.js's canvas into bytes. A
 * `signal` stops the page being read at once (`untilStopped`).
 */
export async function tesseractEngine(
  tesseract: TesseractModule,
  paths: Partial<Tesseract.WorkerOptions>,
  png: ScanEngine['png'],
  signal?: AbortSignal,
): Promise<ScanEngine & { close(): Promise<void> }> {
  const worker = await tesseract.createWorker(OCR_LANGUAGE, tesseract.OEM.LSTM_ONLY, paths);
  await worker.setParameters({ tessedit_pageseg_mode: tesseract.PSM.AUTO });
  return {
    png,
    close: async () => {
      await worker.terminate();
    },
    async recognise(image, dpi) {
      await worker.setParameters({ user_defined_dpi: String(dpi) });
      // Bytes are read as they are in both builds (`loadImage`: `new Uint8Array(data)`); the type lists only Buffer.
      const job = worker.recognize(image as unknown as Tesseract.ImageLike, {}, { blocks: true, text: false });
      const { data } = await untilStopped(job, signal);
      return ocrLinesFrom(data.blocks);
    },
  };
}
