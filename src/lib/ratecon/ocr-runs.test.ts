import { describe, expect, it } from 'vitest';
import { linesFromRuns } from './lines';
import { CELL_GAP, runsFromOcr, skewOf, type OcrLine, type OcrWord, type PixelBox } from './ocr-runs';

/**
 * §12.128. OCR's words in pixels, as the runs a text layer would have given:
 * the conversion alone, on invented boxes. A page drawn at scale 2, so a
 * pixel is half a PDF unit and y turns over: what `viewport.convertToPdfPoint`
 * does for an unrotated Letter page.
 */

const toPdf = (x: number, y: number): [number, number] => [x / 2, 792 - y / 2];
/** Capitals 20 px tall standing on `base` (400 unless said). */
const CAP = 20;
const word = (text: string, x0: number, x1: number, base = 400, box: Partial<PixelBox> = {}): OcrWord => ({
  text,
  box: { x0, x1, y0: base - CAP, y1: base, ...box },
});
const line = (words: OcrWord[], base: number, slope = 0): OcrLine => ({
  words,
  baseline: { x0: words[0]!.box.x0, y0: base, x1: words.at(-1)!.box.x1, y1: base + slope * (words.at(-1)!.box.x1 - words[0]!.box.x0) },
});

describe('words back into runs', () => {
  it('a word space apart is one run; a gap wider than a capital is two — as pdf.js splits a text layer', () => {
    const runs = runsFromOcr([line([word('4001', 100, 170), word('Main', 180, 250), word('St', 258, 290), word('Fargo,', 400, 500)], 400)], 1, toPdf);
    expect(runs).toEqual([
      { page: 1, x: 50, y: 592, text: '4001 Main St' },
      { page: 1, x: 200, y: 592, text: 'Fargo,' },
    ]);
  });

  it('the gap is measured against the page’s capital height: just under it joins, just over it splits', () => {
    const at = (gap: number) => runsFromOcr([line([word('ND', 100, 140), word('58601', 140 + gap, 240 + gap)], 400)], 1, toPdf).length;
    expect(at(Math.floor(CELL_GAP * CAP))).toBe(1);
    expect(at(Math.ceil(CELL_GAP * CAP) + 1)).toBe(2);
  });

  it('each run stands on its line’s baseline, not on its box: a descender, a colon label boxed low', () => {
    const runs = runsFromOcr(
      [line([word('Name:', 100, 180, 400, { y1: 412 }), word('Shipping', 300, 420, 400, { y1: 407 }), word('Dock', 600, 680)], 400)],
      1,
      toPdf,
    );
    expect(runs.map((r) => r.y)).toEqual([592, 592, 592]);
  });

  it('a word the engine put on its line from the row below keeps its own row', () => {
    const runs = runsFromOcr([line([word('PRAIRIE7', 100, 260, 400), word('FARGO', 500, 610, 425)], 400)], 1, toPdf);
    expect(runs).toEqual([
      { page: 1, x: 50, y: 592, text: 'PRAIRIE7' },
      { page: 1, x: 250, y: 579.5, text: 'FARGO' },
    ]);
    expect(linesFromRuns(runs).map((l) => l.text)).toEqual(['PRAIRIE7', 'FARGO']);
  });

  it('…but a box drawn too tall, or a bigger word on the same row, stays on the line', () => {
    const tall = runsFromOcr([line([word('RATE', 100, 180), word('TO', 190, 230), word('CHARGE', 240, 380, 400, { y0: 360, y1: 412 })], 400)], 1, toPdf);
    expect(tall).toEqual([{ page: 1, x: 50, y: 592, text: 'RATE TO CHARGE' }]);
    const big = runsFromOcr([line([word('LOAD', 100, 220, 400, { y0: 365 }), word('Order', 260, 340), word('ID', 350, 380)], 400)], 1, toPdf);
    expect(big.map((r) => r.y)).toEqual([592, 592]);
  });

  it('nothing from a line of empty words, or no lines', () => {
    expect(runsFromOcr([line([word(' ', 100, 110), word('', 120, 130)], 400)], 1, toPdf)).toEqual([]);
    expect(runsFromOcr([], 1, toPdf)).toEqual([]);
  });
});

describe('a skewed scan', () => {
  /** A page turned 1.5°, its rows read as separate lines for each column, as the engine may. */
  const SLOPE = Math.tan((1.5 * Math.PI) / 180);
  const row = (base: number): OcrLine[] => {
    const left = [word('Pickup', 100, 200, base), word('Date', 210, 280, base + 110 * SLOPE), word('Time', 290, 360, base + 190 * SLOPE)];
    // The right column, 900 px along: 23.6 px — 11.8 PDF units — lower on the page than the row's start.
    const right = [word('10/12/2026', 1000, 1180, base + 900 * SLOPE), word('0800', 1190, 1260, base + 1090 * SLOPE), word('APPT', 1270, 1350, base + 1170 * SLOPE)];
    return [line(left, base, SLOPE), line(right, base + 900 * SLOPE, SLOPE)];
  };

  it('its skew is the median slope of its lines of three words or more', () => {
    expect((skewOf([...row(400), ...row(600)]) * 180) / Math.PI).toBeCloseTo(1.5, 5);
    expect(skewOf([line([word('a', 0, 10), word('b', 20, 30)], 400, SLOPE)])).toBe(0);
  });

  it('under 0.1° it is square, and nothing is turned', () => {
    const slight = Math.tan((0.05 * Math.PI) / 180);
    expect(skewOf([line([word('A1', 0, 40), word('B2', 50, 90), word('C3', 100, 140)], 400, slight)])).toBe(0);
  });

  it('turned back, the two ends of each row are one line again, in order', () => {
    const lines = linesFromRuns(runsFromOcr([...row(400), ...row(600)], 1, toPdf));
    expect(lines.map((l) => l.cells.map((c) => c.text))).toEqual([
      ['Pickup Date Time', '10/12/2026 0800 APPT'],
      ['Pickup Date Time', '10/12/2026 0800 APPT'],
    ]);
  });

  it('left skewed, the ends would be two lines apiece: the turn is what keeps them together', () => {
    const square = (l: OcrLine): OcrLine => ({ ...l, baseline: { ...l.baseline, y1: l.baseline.y0 } });
    const lines = linesFromRuns(runsFromOcr([...row(400), ...row(600)].map(square), 1, toPdf));
    expect(lines).toHaveLength(4);
  });
});
