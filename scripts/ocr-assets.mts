/**
 * §12.128. The scan reader's files, copied out of `node_modules` into the
 * folder the app serves them from (`public/ocr/`, git-ignored): the npm
 * packages at the versions in package-lock.json, never committed. Run by
 * `scripts/copy-ocr-assets.mts`, which `npm run build` and `npm run dev` run first.
 */
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { OCR_ASSETS, OCR_DIR } from '../src/lib/ratecon/ocr-assets';

const require = createRequire(import.meta.url);

/** Where the app serves `/ocr/…` from. */
export const PUBLIC_OCR = join('public', OCR_DIR);

/**
 * Empties `dest` and copies every file in `OCR_ASSETS` into it; returns what
 * it wrote. A file npm did not install throws, so a build without it fails
 * instead of shipping a scan reader that cannot start.
 */
export function copyOcrAssets(dest: string = PUBLIC_OCR): string[] {
  rmSync(dest, { recursive: true, force: true });
  return OCR_ASSETS.map(({ from, to }) => {
    const target = join(dest, to);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(require.resolve(from), target);
    return target;
  });
}
