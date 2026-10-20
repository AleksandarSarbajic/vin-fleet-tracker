/**
 * §12.128. Where the scan reader's files are served from: OUR origin, never a
 * CDN. tesseract.js fetches its worker script, its WebAssembly core and the
 * English language data from cdn.jsdelivr.net unless told otherwise, so every
 * one of those paths is set here, and `ocr-assets.test.ts` fails if any is
 * not same-origin or if tesseract.js gains a CDN default this does not set.
 *
 * The files are copied out of `node_modules` into `public/ocr/` (git-ignored)
 * by `scripts/copy-ocr-assets.mts`, before every build and dev server: from
 * the npm packages, at the versions in package-lock.json, and never committed.
 */

/** Served at `/ocr/…`: `public/ocr/` in the repo. */
export const OCR_DIR = 'ocr';

/**
 * Each file the browser may fetch, by where npm puts it and where it is
 * served. The core comes in three builds, one of which a browser loads by
 * what its WebAssembly supports (relaxed SIMD, SIMD, neither); each `.wasm.js`
 * carries its WebAssembly inside. LSTM only: the legacy engine is not used.
 */
export const OCR_ASSETS: readonly { from: string; to: string }[] = [
  { from: 'tesseract.js/dist/worker.min.js', to: 'worker.min.js' },
  { from: 'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', to: 'core/tesseract-core-relaxedsimd-lstm.wasm.js' },
  { from: 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js', to: 'core/tesseract-core-simd-lstm.wasm.js' },
  { from: 'tesseract.js-core/tesseract-core-lstm.wasm.js', to: 'core/tesseract-core-lstm.wasm.js' },
  { from: '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', to: 'lang/eng.traineddata.gz' },
];

/**
 * The worker's options for a page at `origin`: every path tesseract.js would
 * otherwise take from a CDN, as an absolute URL on our own origin (the worker
 * script resolves nothing relative). The language data may be kept in the
 * browser's IndexedDB under a key naming its version; the document never is.
 */
export function ocrWorkerOptions(origin: string) {
  const at = (path: string) => new URL(`/${OCR_DIR}/${path}`, origin).href;
  return {
    workerPath: at('worker.min.js'),
    corePath: at('core'),
    langPath: at('lang'),
    workerBlobURL: false,
    gzip: true,
    cacheMethod: 'write',
    cachePath: 'ocr-eng-4.0.0_best_int',
  } as const;
}
