import type { ModelQuote, ModelRead } from './model-read';
import type { PreparedLine } from './redact';
import { cityLine } from './templates';
import { locate } from './verify-read';

/**
 * The dropped-stop cue (docs/llm-reader-design.md §3; evaluation run 1,
 * 2026-10-14, where a read returned one stop of two and every check passed).
 * Pure, and run in the browser after verification, on exactly the lines sent.
 *
 * A sent line that looks like a US city, state and ZIP, that no quote of
 * the read covers, and that comes AFTER the first line any stop was read
 * from, may be a stop the read left out. The strip says so and offers "Show
 * what is sent". It blocks nothing and changes no mark.
 *
 * "After the first stop" (phase 3d): a header's addresses — the broker's, the
 * carrier's — come before the stops, and as first built (3c) the cue fired on
 * 5 of 6 control files with nothing dropped; narrowed, on 1. The price: it
 * CANNOT catch a dropped FIRST stop, whose lines come before any stop the
 * read kept. An address after the stops (remit-to, a footer) still fires it.
 * With no stop quote in the text at all, there is no first stop, and every
 * uncited address line counts.
 *
 * A quote covers a line only when it is in the text (the verifier's own
 * `locate`): a citation the model made up does not hide a line.
 */

/** Cells are joined with two spaces in a sent line; a city line can be one cell of several. */
const CELL_GAP = '  ';

export function looksLikeAddressLine(text: string): boolean {
  return cityLine(text) !== null || text.split(CELL_GAP).some((cell) => cityLine(cell) !== null);
}

/** Every quote in a read, wherever it sits. */
function quotesOf(read: ModelRead): ModelQuote[] {
  const quotes: ModelQuote[] = [];
  if (read.loadNumber) quotes.push(read.loadNumber.quote);
  for (const stop of read.stops) {
    quotes.push(stop.type.quote);
    for (const field of [stop.street, stop.city, stop.state, stop.zip]) if (field) quotes.push(field.quote);
    const a = stop.appointment;
    if (a.kind === 'exact') quotes.push(a.dateQuote, a.timeQuote);
    if (a.kind === 'range') quotes.push(a.dateQuote, a.timeQuote, ...(a.endQuote ? [a.endQuote] : []));
    if (a.kind === 'unclear') quotes.push(a.quote);
  }
  return quotes;
}

/**
 * The rule, on line numbers: address-like sent lines not cited, after the
 * first line a stop was read from (`null`: none was, so every line counts).
 * Shared with `ratecon:cue-report`, so the measurement is of this rule.
 */
export function cueLines(sent: readonly { n: number; text: string }[], cited: ReadonlySet<number>, firstStopLine: number | null): number[] {
  return sent
    .filter((l) => !cited.has(l.n) && looksLikeAddressLine(l.text) && (firstStopLine === null || l.n > firstStopLine))
    .map((l) => l.n);
}

/** The lines a quote covers, when it is in the text; none when it is not. */
function covered(quote: ModelQuote, byLine: ReadonlyMap<number, PreparedLine>): number[] {
  if (locate(quote, byLine) === null) return [];
  const lines: number[] = [];
  for (let n = quote.line; n <= (quote.lineEnd ?? quote.line); n += 1) lines.push(n);
  return lines;
}

/** The numbers of the sent lines the cue names, in order (`cueLines`). */
export function uncitedAddressLines(read: ModelRead, sent: readonly PreparedLine[]): number[] {
  const byLine = new Map(sent.map((l) => [l.n, l]));
  const cited = new Set(quotesOf(read).flatMap((q) => covered(q, byLine)));
  const stopLines = quotesOf({ ...read, loadNumber: null }).flatMap((q) => covered(q, byLine));
  return cueLines(sent, cited, stopLines.length > 0 ? Math.min(...stopLines) : null);
}

/** What the strip says, or null when there is nothing to say. */
export function addressCueText(lines: readonly number[]): string | null {
  if (lines.length === 0) return null;
  const which = lines.map((n) => `L${n}`).join(', ');
  return lines.length === 1
    ? `1 line that looks like an address was not used: ${which}`
    : `${lines.length} lines that look like addresses were not used: ${which}`;
}
