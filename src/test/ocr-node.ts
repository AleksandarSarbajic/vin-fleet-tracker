import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import Tesseract from 'tesseract.js';
import { tesseractEngine } from '@/lib/ratecon/ocr-engine';
import type { ScanReading } from '@/lib/ratecon/read-pdf';

export { blankScan, nodePdfjs, scanOf, type PdfJs } from './scan-pdf';

/**
 * §12.128. The scan reader in Node, for tests and the local report: the
 * browser's engine (`ocr-engine.ts`, the same model and settings), its files
 * read from `node_modules` instead of our origin, and pdf.js drawing on
 * @napi-rs/canvas (a dev dependency). Nothing is fetched: the language data
 * is a local path, and nothing is cached to disk (`cacheMethod: 'none'`).
 * Scans to read are made by `scan-pdf.ts`.
 */

const require = createRequire(import.meta.url);

/** The language data, where npm put it. */
export const LOCAL_LANG_PATH = join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');

export function nodeScanReading(options: Omit<ScanReading, 'open'> = {}): ScanReading & { opened: () => number } {
  let opened = 0;
  return {
    ...options,
    opened: () => opened,
    open: () => {
      opened += 1;
      return tesseractEngine(
        Tesseract,
        { langPath: LOCAL_LANG_PATH, cacheMethod: 'none', gzip: true },
        (canvas) => (canvas as { encode(format: 'png'): Promise<Uint8Array> }).encode('png'),
        options.signal,
      );
    },
  };
}

