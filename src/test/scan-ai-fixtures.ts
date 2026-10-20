import type { ModelRead } from '@/lib/ratecon/model-read';
import { MODEL_REPLY, UNKNOWN_LAYOUT } from './model-read-fixtures';
import type { TinyRun } from './tiny-pdf';

/**
 * §12.128. A scan that goes to Read with AI, for `read-scan.test.ts` (in
 * Node) and `e2e/ratecon-scan.spec.ts` (in a browser): the invented unknown
 * layout as PDF pages, and its scripted reply pointed at the lines a read of
 * it would send. Invented throughout (`model-read-fixtures.ts`).
 */

/** The unknown layout as pages of a PDF: each line's cells where `pdfLine` put them, a line every 14 points. */
export function unknownLayoutPages(): TinyRun[][] {
  const pages = new Map<number, TinyRun[]>();
  for (const line of UNKNOWN_LAYOUT) {
    const runs = pages.get(line.page!) ?? [];
    const y = 740 - 14 * new Set(runs.map((r) => r.y)).size;
    for (const cell of line.cells) runs.push({ x: cell.x!, y, text: cell.text });
    pages.set(line.page!, runs);
  }
  return [...pages.keys()].sort().map((n) => pages.get(n)!);
}

/**
 * `MODEL_REPLY`, every quote pointed at the line of `sent` (numbered as "Show
 * what is sent" numbers it: "L12 …") that holds its text — the nearest to
 * where it was, if more than one does — so the reply verifies against exactly
 * what OCR gave. A quote no line holds throws, naming it: an OCR miss on the
 * page, not the reader's.
 */
export function replyPointedAt(sent: string): ModelRead {
  const lines = sent.split('\n').flatMap((l) => {
    const m = /^L(\d+) (.*)$/.exec(l);
    return m ? [{ n: Number(m[1]), text: m[2]! }] : [];
  });
  const point = (quote: { line: number; text: string }) => {
    const at = lines.filter((l) => l.text.includes(quote.text));
    if (at.length === 0) throw new Error(`The scan's OCR sent no line with “${quote.text}”.`);
    const nearest = at.reduce((a, b) => (Math.abs(a.n - quote.line) <= Math.abs(b.n - quote.line) ? a : b));
    return { line: nearest.n, text: quote.text };
  };
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      const o = value as Record<string, unknown>;
      if (typeof o.line === 'number' && typeof o.text === 'string') return point(o as { line: number; text: string });
      return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, walk(v)]));
    }
    return value;
  };
  return walk(MODEL_REPLY) as ModelRead;
}
