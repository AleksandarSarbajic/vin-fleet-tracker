/**
 * §12.128. Run first by `npm run build` and `npm run dev`: the scan reader's files into
 * `public/ocr/`, from `node_modules` (`scripts/ocr-assets.mts`).
 */
import { copyOcrAssets } from './ocr-assets.mjs';

const written = copyOcrAssets();
console.info(`OCR assets: ${written.length} files copied into public/ocr/.`);
