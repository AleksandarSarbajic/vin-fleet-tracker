import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Browser } from '@playwright/test';

/**
 * §12.103 — reading back what the browser printed. `page.pdf()` gives bytes;
 * this turns them into what a person would see on paper: the text of each
 * page (Mozilla's pdf.js, in Node) and an image of each page (pdf.js again,
 * drawn in Chromium, where a canvas exists). Test-only — pdf.js is a dev
 * dependency and never reaches a bundle.
 */

const require = createRequire(import.meta.url);

export interface PdfPage {
  /** The page's text runs, joined with spaces — what a reader would see. */
  text: string;
  /** Width and height in points; landscape when width > height. */
  width: number;
  height: number;
}

export async function readPdf(bytes: Buffer): Promise<PdfPage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
  try {
    const pages: PdfPage[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      const [, , width, height] = page.view;
      pages.push({ text, width: width!, height: height! });
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

const PDFJS_DIR = require.resolve('pdfjs-dist/legacy/build/pdf.min.mjs').replace(/pdf\.min\.mjs$/, '');

/** Draws every page of the PDF and saves one PNG per page as `<base>-p<n>.png`. */
export async function pdfToImages(browser: Browser, bytes: Buffer, base: string, scale = 1.5): Promise<string[]> {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();
  try {
    await page.route('http://pdf.local/**', (route) => {
      const name = new URL(route.request().url()).pathname.slice(1);
      if (name === 'doc.pdf') return route.fulfill({ body: bytes, contentType: 'application/pdf' });
      if (name === 'index.html') {
        return route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><body style="margin:0;background:#888">
<script type="module">
import * as pdfjs from './pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = './pdf.worker.min.mjs';
const doc = await pdfjs.getDocument('./doc.pdf').promise;
for (let i = 1; i <= doc.numPages; i++) {
  const p = await doc.getPage(i);
  const vp = p.getViewport({ scale: ${scale} });
  const c = document.createElement('canvas');
  c.width = vp.width; c.height = vp.height; c.dataset.page = String(i);
  c.style.display = 'block'; c.style.marginBottom = '8px';
  document.body.append(c);
  await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
}
document.body.dataset.done = String(doc.numPages);
</script></body>`,
        });
      }
      return route.fulfill({ body: readFileSync(PDFJS_DIR + name), contentType: 'text/javascript' });
    });
    await page.goto('http://pdf.local/index.html');
    await page.locator('body[data-done]').waitFor({ timeout: 20_000 });
    const count = Number(await page.locator('body').getAttribute('data-done'));
    const paths: string[] = [];
    for (let i = 1; i <= count; i++) {
      const path = `${base}-p${i}.png`;
      await page.locator(`canvas[data-page="${i}"]`).screenshot({ path });
      paths.push(path);
    }
    return paths;
  } finally {
    await context.close();
  }
}
