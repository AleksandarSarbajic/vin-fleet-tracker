import { SAME_LINE, type TextRun } from './lines';

/**
 * §12.128. What OCR found on one rendered page, turned into the runs pdf.js
 * would have given for the same text: PDF units, origin bottom-left, y up,
 * each run starting at its first glyph, on its baseline. Pure.
 *
 * pdf.js gives a text layer in runs, and `linesFromRuns` makes lines and
 * cells of them. pdf.js itself joins two pieces of text on one baseline into
 * one run when the gap between them is under 0.6 of the font size
 * (`SPACE_IN_FLOW_MAX_FACTOR` in its text extraction), and starts a new run
 * when it is wider. OCR gives words in pixels, so words are joined back the
 * same way: a gap under about a capital letter's height is a space, a wider
 * one starts a new run. On paper that gap is all that says two pieces of
 * text are two cells.
 *
 * A scan is rarely square on the glass, and a text layer is never skewed:
 * the page's skew, from its lines' baselines, is turned back before anything
 * is measured, so the two ends of one row stay one line.
 */

/** A box in pixels, origin top-left, y down: as the OCR engine reports it. */
export interface PixelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  text: string;
  box: PixelBox;
}

/** One line as the engine segmented it: its words, and its baseline from (x0, y0) to (x1, y1). */
export interface OcrLine {
  words: OcrWord[];
  baseline: PixelBox;
}

/** A pixel on the rendered page to a point in PDF space: pdf.js's `viewport.convertToPdfPoint`. */
export type ToPdf = (x: number, y: number) => [number, number];

/** Glyphs as tall as a capital: a word with one of these reaches the cap height. */
const TALL = /[A-Z0-9bdfhkl]/;
/** A word with none reaches only the x-height: about this much of a capital in most fonts. */
const X_HEIGHT = 0.72;
/**
 * Two rows that touch can come back as one line: a facility code a few
 * points above its city line, in the invented PU / SO layout. A word whose
 * top AND bottom are both more than this many capital heights off its line's
 * baseline, the same way, stands on another row, and keeps its own. One edge
 * alone is not enough: a bigger word on the same row has a higher top, a
 * descender a lower bottom, and the engine sometimes boxes a word taller
 * than it is.
 */
const OTHER_ROW = 0.5;

/**
 * A gap wider than this many capital heights starts a new run. pdf.js's 0.6
 * of the font size, measured between advances, is about 0.7 of it between
 * inked edges (each edge gives back about 0.05 of side bearing), and a
 * capital is about 0.72 of the font size: 0.7 / 0.72.
 */
export const CELL_GAP = 0.97;

/** Turned back no further than this: below it, a page is square (0.1°: under 2 PDF units across a Letter page). */
const MIN_SKEW = (0.1 * Math.PI) / 180;

/** Where a line's baseline is under a point of it, in pixels. */
function lineBaselineAt(line: OcrLine, x: number): number {
  const { x0, y0, x1, y1 } = line.baseline;
  return x1 === x0 ? y0 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

/** The page's skew in radians, y down: the median slope of the baselines of lines of three words or more. */
export function skewOf(lines: readonly OcrLine[]): number {
  const angles = lines
    .filter((l) => l.words.length >= 3 && l.baseline.x1 > l.baseline.x0)
    .map((l) => Math.atan2(l.baseline.y1 - l.baseline.y0, l.baseline.x1 - l.baseline.x0))
    .sort((a, b) => a - b);
  if (angles.length === 0) return 0;
  const median = angles[Math.floor(angles.length / 2)]!;
  return Math.abs(median) < MIN_SKEW ? 0 : median;
}

interface Placed {
  text: string;
  /** Deskewed pixels: where the word starts and ends across the line. */
  left: number;
  right: number;
  /** In PDF units. */
  x: number;
  y: number;
}

/** How tall a capital is on the page, in pixels: the median over its words with a tall letter, from their line's baseline. */
function capHeightOf(lines: readonly OcrLine[]): number {
  const heights = lines
    .flatMap((line) =>
      line.words
        .filter((w) => TALL.test(w.text))
        .map((w) => Math.min(lineBaselineAt(line, w.box.x0), lineBaselineAt(line, w.box.x1)) - w.box.y0),
    )
    .filter((h) => h > 0)
    .sort((a, b) => a - b);
  return heights.length === 0 ? 0 : heights[Math.floor(heights.length / 2)]!;
}

/**
 * Where a word stands, in pixels. The top compared is the box's highest
 * corner, against the line's highest point under the word, and the bottom
 * its lowest against the lowest: on a skewed page one end of a long word is
 * higher than the other.
 */
function footOf(line: OcrLine, word: OcrWord, cap: number): number {
  const under = lineBaselineAt(line, word.box.x0);
  const [a, b] = [under, lineBaselineAt(line, word.box.x1)];
  const top = word.box.y0 - (Math.min(a, b) - (TALL.test(word.text) ? cap : X_HEIGHT * cap));
  const bottom = word.box.y1 - Math.max(a, b);
  const elsewhere = (top > OTHER_ROW * cap && bottom > OTHER_ROW * cap) || (top < -OTHER_ROW * cap && bottom < -OTHER_ROW * cap);
  return elsewhere ? under + top : under;
}

export function runsFromOcr(lines: readonly OcrLine[], page: number, toPdf: ToPdf): TextRun[] {
  const words = lines.flatMap((l) => l.words);
  if (words.length === 0) return [];
  // Turned back about the middle of the text, by the page's skew.
  const angle = skewOf(lines);
  const cx = (Math.min(...words.map((w) => w.box.x0)) + Math.max(...words.map((w) => w.box.x1))) / 2;
  const cy = (Math.min(...words.map((w) => w.box.y0)) + Math.max(...words.map((w) => w.box.y1))) / 2;
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  const square = (x: number, y: number): [number, number] => [
    cx + (x - cx) * cos + (y - cy) * sin,
    cy - (x - cx) * sin + (y - cy) * cos,
  ];
  const cap = capHeightOf(lines);
  const gap = CELL_GAP * cap;

  const runs: TextRun[] = [];
  for (const line of lines) {
    const placed: Placed[] = line.words
      .filter((w) => w.text.trim() !== '')
      .map((w) => {
        const foot = footOf(line, w, cap);
        const [left, base] = square(w.box.x0, foot);
        const [right] = square(w.box.x1, foot);
        const [x, y] = toPdf(left, base);
        return { text: w.text.trim(), left, right, x, y };
      })
      .sort((a, b) => a.left - b.left);
    if (placed.length === 0) continue;
    let run: Placed[] = [placed[0]!];
    const close = () => runs.push({ page, x: run[0]!.x, y: run[0]!.y, text: run.map((p) => p.text).join(' ') });
    for (const word of placed.slice(1)) {
      const last = run[run.length - 1]!;
      if (word.left - last.right > gap || Math.abs(word.y - run[0]!.y) > SAME_LINE) {
        close();
        run = [word];
      } else run.push(word);
    }
    close();
  }
  return runs;
}
