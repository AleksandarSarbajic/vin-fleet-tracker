import { ocrWorkerOptions } from './ocr-assets';
import { tesseractEngine } from './ocr-engine';
import type { ScanEngine } from './read-scan';

/**
 * §12.128. The scan engine in the browser. This module — and with it
 * tesseract.js, its worker, its WebAssembly core and the language data — is
 * loaded only when a dropped PDF turns out to be a scan (`read-pdf.ts`
 * imports it then), never on the console's first load. Every file comes from
 * our own origin (`ocr-assets.ts`). The page image goes to the worker in
 * memory and nowhere else.
 */

/** A canvas pdf.js drew on, as PNG bytes. */
function png(canvas: unknown): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob((blob) => {
      if (!blob) {
        reject(new Error('The rendered page could not be encoded.'));
        return;
      }
      blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
    }, 'image/png');
  });
}

export async function openBrowserScanEngine(signal?: AbortSignal): Promise<ScanEngine & { close(): Promise<void> }> {
  // CommonJS: its exports are the default export, under webpack and Node alike.
  const { default: tesseract } = await import('tesseract.js');
  return tesseractEngine(tesseract, ocrWorkerOptions(window.location.origin), png, signal);
}
