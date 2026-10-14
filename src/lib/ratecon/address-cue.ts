import type { ModelQuote, ModelRead } from './model-read';
import type { PreparedLine } from './redact';
import { cityLine } from './templates';
import { locate } from './verify-read';

/**
 * The dropped-stop cue (docs/llm-reader-design.md §3; evaluation run 1,
 * 2026-10-14, where a read returned one stop of two and every check passed).
 * Pure, and run in the browser after verification, on exactly the lines sent.
 *
 * A sent line that looks like a US city, state and ZIP, and that no quote of
 * the read covers, may be a stop the read left out. The strip says so and
 * offers "Show what is sent". It blocks nothing and changes no mark.
 *
 * It cannot tell a stop from any other address: a broker's or carrier's own
 * address in a header fires it too. A quote covers a line only when it is in
 * the text (the verifier's own `locate`): a citation the model made up does
 * not hide a line.
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

/** The numbers of the sent lines that look like addresses and that no quote in the text covers, in order. */
export function uncitedAddressLines(read: ModelRead, sent: readonly PreparedLine[]): number[] {
  const byLine = new Map(sent.map((l) => [l.n, l]));
  const cited = new Set<number>();
  for (const quote of quotesOf(read)) {
    if (locate(quote, byLine) === null) continue;
    for (let n = quote.line; n <= (quote.lineEnd ?? quote.line); n += 1) cited.add(n);
  }
  return sent.filter((l) => !cited.has(l.n) && looksLikeAddressLine(l.text)).map((l) => l.n);
}

/** What the strip says, or null when there is nothing to say. */
export function addressCueText(lines: readonly number[]): string | null {
  if (lines.length === 0) return null;
  const which = lines.map((n) => `L${n}`).join(', ');
  return lines.length === 1
    ? `1 line that looks like an address was not used: ${which}`
    : `${lines.length} lines that look like addresses were not used: ${which}`;
}
