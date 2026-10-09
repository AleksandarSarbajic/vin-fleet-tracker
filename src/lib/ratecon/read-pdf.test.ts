import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { LABEL_ROWS, PU_SO, puSoBlocks } from '@/test/ratecon-fixtures';
import { tinyPdf } from '@/test/tiny-pdf';
import { PDF_LIMITS, PDF_MESSAGES, linesFromPdf } from './read-pdf';
import { readRatecon } from './templates';

/**
 * §12.122. The PDF path, through the real pdf.js (Node's build here, the
 * browser's in the modal — the same `linesFromPdf`). Every PDF is built in
 * memory from invented text.
 */

type PdfJs = Parameters<typeof linesFromPdf>[1];
let pdfjs: PdfJs;
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  pdfjs = (await import(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'))) as PdfJs;
});

describe('reading a PDF', () => {
  it('reads an invented rate confirmation into the layout it is', async () => {
    const out = await linesFromPdf(tinyPdf(puSoBlocks(PU_SO)), pdfjs);
    expect(out.ok).toBe(true);
    const read = readRatecon(out.ok ? out.lines : []);
    expect(read.ok && read.read.stops.map((s) => s.city?.value)).toEqual(['FARGO', 'DICKINSON']);
  });

  it('keeps the page each line came from', async () => {
    const out = await linesFromPdf(tinyPdf([...LABEL_ROWS, [{ x: 40, y: 700, text: 'A second page of terms.' }]]), pdfjs);
    expect(out.ok && out.lines.at(-1)).toMatchObject({ page: 2, text: 'A second page of terms.' });
  });
});

describe('what is refused, and how it is said', () => {
  it('a file that is not a PDF, whatever it is called', async () => {
    const out = await linesFromPdf(new TextEncoder().encode('PK\u0003\u0004 not a pdf'), pdfjs);
    expect(out).toEqual({ ok: false, message: PDF_MESSAGES.notPdf });
  });

  it('more than 5 MB', async () => {
    const big = new Uint8Array(PDF_LIMITS.bytes + 1);
    big.set(new TextEncoder().encode('%PDF-1.4'));
    expect(await linesFromPdf(big, pdfjs)).toEqual({ ok: false, message: PDF_MESSAGES.tooBig });
  });

  it('more than 10 pages', async () => {
    const pages = Array.from({ length: PDF_LIMITS.pages + 1 }, (_, i) => [{ x: 40, y: 700, text: `Page ${i + 1} of terms.` }]);
    expect(await linesFromPdf(tinyPdf(pages), pdfjs)).toEqual({ ok: false, message: PDF_MESSAGES.tooManyPages });
  });

  it('a scan: next to no text', async () => {
    expect(await linesFromPdf(tinyPdf([[{ x: 40, y: 40, text: 'p. 1' }]]), pdfjs)).toEqual({
      ok: false,
      message: "This is a scan; there's no text to read.",
    });
  });

  it('a damaged PDF, without quoting it', async () => {
    const out = await linesFromPdf(new TextEncoder().encode('%PDF-1.4\nnothing else'), pdfjs);
    expect(out).toEqual({ ok: false, message: PDF_MESSAGES.unreadable });
  });
});
