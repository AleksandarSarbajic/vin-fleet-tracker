/**
 * §12.122. A rate confirmation as lines of text, the one shape all three
 * template readers read — whether it came from a PDF's text layer or from
 * text pasted out of one. Pure.
 */

/** One run of text as pdf.js gives it: its page, and where it starts. */
export interface TextRun {
  page: number;
  x: number;
  y: number;
  text: string;
}

export interface Cell {
  /** Null for pasted text, which has no positions. */
  x: number | null;
  text: string;
}

export interface Line {
  /** 1-based; null for pasted text. */
  page: number | null;
  cells: Cell[];
  /** The cells joined with two spaces — what a reader's patterns run on. */
  text: string;
}

/** Runs on the same baseline, give or take this, are one line. */
const SAME_LINE = 3;

/** A PDF's runs as lines: page by page, top to bottom, left to right. */
export function linesFromRuns(runs: readonly TextRun[]): Line[] {
  const byPage = new Map<number, TextRun[]>();
  for (const run of runs) {
    if (run.text.trim() === '') continue;
    if (!byPage.has(run.page)) byPage.set(run.page, []);
    byPage.get(run.page)!.push(run);
  }
  const lines: Line[] = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const rows: { y: number; runs: TextRun[] }[] = [];
    // PDF y grows upwards: the top of the page is the largest y.
    for (const run of byPage.get(page)!.sort((a, b) => b.y - a.y || a.x - b.x)) {
      const row = rows.find((r) => Math.abs(r.y - run.y) <= SAME_LINE);
      if (row) row.runs.push(run);
      else rows.push({ y: run.y, runs: [run] });
    }
    for (const row of rows.sort((a, b) => b.y - a.y)) {
      const cells = row.runs
        .sort((a, b) => a.x - b.x)
        .map((r) => ({ x: r.x, text: r.text.replace(/\s+/g, ' ').trim() }));
      lines.push({ page, cells, text: cells.map((c) => c.text).join('  ') });
    }
  }
  return lines;
}

/** Pasted text as lines: one cell each, no page. */
export function linesFromText(text: string): Line[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter((l) => l !== '')
    .map((l) => ({ page: null, cells: [{ x: null, text: l }], text: l }));
}

/** How much text there is: a scan has next to none. */
export function textLength(lines: readonly Line[]): number {
  return lines.reduce((n, l) => n + l.text.replace(/\s/g, '').length, 0);
}
