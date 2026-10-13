/**
 * The real rate-confirmation samples, for the local scripts that study them
 * (docs/llm-reader-design.md §8.2). Prints NOTHING itself.
 *
 * `.samples/rate-confirmations/` is git-ignored and never committed. Files
 * are known to every report by NUMBER — name order across all the PDFs, as
 * HANDOFF numbers them — never by name: a file name can be a load number.
 * Numbers shift when a file is added, renamed or removed.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { linesFromPdf, type PdfOutcome } from '../src/lib/ratecon/read-pdf';

export const SAMPLES_DIR = '.samples/rate-confirmations';
export const EXPECTED_PATH = join(SAMPLES_DIR, 'expected.json');

/** Every sample PDF's file name, in name order: index + 1 is its number. Empty with no folder. */
export function sampleFiles(): string[] {
  if (!existsSync(SAMPLES_DIR)) return [];
  return readdirSync(SAMPLES_DIR)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .sort();
}

/** The file name for a sample number, or null when there is no such sample. */
export function sampleByNumber(files: readonly string[], n: number): string | null {
  return Number.isInteger(n) && n >= 1 && n <= files.length ? files[n - 1]! : null;
}

type PdfJs = Parameters<typeof linesFromPdf>[1];
let pdfjs: PdfJs | null = null;

/** A sample's lines, through the same reader the browser runs. */
export async function readSample(file: string): Promise<PdfOutcome> {
  if (pdfjs === null) {
    const require = createRequire(import.meta.url);
    pdfjs = (await import(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'))) as PdfJs;
  }
  return linesFromPdf(new Uint8Array(readFileSync(join(SAMPLES_DIR, file))), pdfjs);
}
