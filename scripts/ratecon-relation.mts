/**
 * How a wrong street or city differs from the ground truth, in CODES AND
 * COUNTS only (phase 3o). `ratecon:eval-ai` says WRONG for a cell; this says
 * what kind of wrong, so a systematic cause (a read that is too long, too
 * short, or differs in punctuation) can be told from a noisy one without a
 * value, a word, a character or the shape of one ever being printed.
 *
 * The read is the form's value, so it is already in the normal case the app
 * shows (`normalCase`), and the truth is as it was written: that is what the
 * scorer compares. Case is therefore ignored by every code after `equal`
 * (except `case-only`, which names it). Words are compared with commas,
 * periods and hyphens taken out, and a hyphen is a word break.
 *
 * ONE code per pair. The order below is the precedence:
 *
 *   equal                       the strings are the same
 *   read is empty / truth is empty
 *                               no words on that side (the second is not in
 *                               Alex's list; without it, a value where the
 *                               document gives none would read "different
 *                               words (0 of 0)")
 *   case-only                   the same but for case, punctuation identical
 *   spacing-only                the same words, a different gap between them
 *   punctuation-only            the same words once commas, periods and
 *                               hyphens are taken out. Tested AFTER
 *                               case-only and without regard to case, so
 *                               "ST," against "St" is punctuation-only
 *   extra trailing / extra leading / missing trailing / missing leading
 *                               one is a run of whole words at an end of the
 *                               other. An extra word with a comma is "extra
 *                               trailing": the words are compared without the
 *                               comma, so the word is the difference left.
 *                               Trailing is tested before leading, so a
 *                               repeated word is called trailing
 *   same words in a different order
 *   different words (K of M)    anything else. M is the longer side's word
 *                               count; K is M less the words that pair up
 */

export type Relation =
  | { kind: 'equal' | 'case-only' | 'punctuation-only' | 'spacing-only' | 'same-words-different-order' | 'read-empty' | 'truth-empty'; read: number; truth: number }
  | { kind: 'extra-leading' | 'extra-trailing' | 'missing-leading' | 'missing-trailing'; n: number; read: number; truth: number }
  | { kind: 'different-words'; k: number; m: number; read: number; truth: number };

/** Lower case, commas, periods and hyphens as spaces, the words that are left. */
const wordsOf = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[,.-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w !== '');

const gaps = (s: string) => s.trim().split(/\s+/).join(' ').toLowerCase();

const startsWith = (long: string[], short: string[]) => short.every((w, i) => long[i] === w);
const endsWith = (long: string[], short: string[]) => short.every((w, i) => long[long.length - short.length + i] === w);

/** Words that pair up between the two lists, each used once. */
function paired(a: string[], b: string[]): number {
  const left = new Map<string, number>();
  for (const w of b) left.set(w, (left.get(w) ?? 0) + 1);
  let n = 0;
  for (const w of a) {
    const have = left.get(w) ?? 0;
    if (have > 0) {
      left.set(w, have - 1);
      n += 1;
    }
  }
  return n;
}

export function relationOf(read: string, truth: string): Relation {
  const [r, t] = [wordsOf(read), wordsOf(truth)];
  const counts = { read: r.length, truth: t.length };
  if (read === truth) return { kind: 'equal', ...counts };
  if (r.length === 0 && t.length === 0) return { kind: 'equal', ...counts };
  if (r.length === 0) return { kind: 'read-empty', ...counts };
  if (t.length === 0) return { kind: 'truth-empty', ...counts };
  if (read.toLowerCase() === truth.toLowerCase()) return { kind: 'case-only', ...counts };
  if (gaps(read) === gaps(truth)) return { kind: 'spacing-only', ...counts };
  if (r.join(' ') === t.join(' ')) return { kind: 'punctuation-only', ...counts };
  if (r.length > t.length) {
    if (startsWith(r, t)) return { kind: 'extra-trailing', n: r.length - t.length, ...counts };
    if (endsWith(r, t)) return { kind: 'extra-leading', n: r.length - t.length, ...counts };
  }
  if (r.length < t.length) {
    if (startsWith(t, r)) return { kind: 'missing-trailing', n: t.length - r.length, ...counts };
    if (endsWith(t, r)) return { kind: 'missing-leading', n: t.length - r.length, ...counts };
  }
  if (r.length === t.length && [...r].sort().join(' ') === [...t].sort().join(' ')) {
    return { kind: 'same-words-different-order', ...counts };
  }
  const m = Math.max(r.length, t.length);
  return { kind: 'different-words', k: m - paired(r, t), m, ...counts };
}

/** "2 extra leading words", "1 trailing word". */
const count = (n: number, kind: string) => `${n} ${kind} ${n === 1 ? 'word' : 'words'}`;

/** The relation as one phrase: a code and counts, nothing of the values. */
export function relationSaid(r: Relation): string {
  const counts = `read ${r.read}, truth ${r.truth}`;
  switch (r.kind) {
    case 'extra-leading':
      return `read has ${count(r.n, 'extra leading')} (${counts})`;
    case 'extra-trailing':
      return `read has ${count(r.n, 'extra trailing')} (${counts})`;
    case 'missing-leading':
      return `read is missing ${count(r.n, 'leading')} (${counts})`;
    case 'missing-trailing':
      return `read is missing ${count(r.n, 'trailing')} (${counts})`;
    case 'different-words':
      return `different words (${r.k} of ${r.m} words differ; ${counts})`;
    case 'same-words-different-order':
      return `same words in a different order (${counts})`;
    case 'read-empty':
      return `read is empty (${counts})`;
    case 'truth-empty':
      return `truth is empty (${counts})`;
    default:
      return `${r.kind} (${counts})`;
  }
}
