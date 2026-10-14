/**
 * Street and city in normal capitalization (2026-10-14). Many rate
 * confirmations print ALL CAPS ("DALLAS"); the dispatcher wants "Dallas".
 * Pure. Applied by `fillLoad` AFTER the read is verified — the verifier
 * matches the model's quote against the printed line case-insensitively, so
 * the case is changed only on the way into the form, never before.
 *
 * Word by word. A word with any lowercase letter was typed or printed in
 * mixed case on purpose ("McAllen") and is left exactly as is. An all-capital
 * word becomes Title case, with these exceptions: directionals, PO and
 * highway prefixes stay upper-case; an ordinal's suffix goes lower; digits
 * and "#" are untouched. Hyphens and apostrophes split a word and each part
 * is cased. Only the case of letters changes — never a character, never
 * whitespace.
 *
 * Known limit: a name printed in capitals loses its internal capital
 * ("DEKALB" -> "Dekalb", "MLK" -> "Mlk"). It cannot be recovered from the
 * capitals, and a list of names is deliberately not kept.
 */

/** Upper-case when the input is all-caps. Matched on the letters alone, so "P.O." and "W." count. */
const STAYS_UPPER = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'PO']);
/** A route prefix keeps its capitals when a number follows: "I-35", "US 90", "FM 1960". */
const ROUTE_PREFIXES = new Set(['I', 'US', 'FM', 'SH', 'CR', 'RR']);
const ROUTE_WITH_HYPHEN = /^(?:I|US|FM|SH|CR|RR)-\d[\dA-Z]*$/;
/** After an apostrophe, these end a word ("JOHN'S", "DON'T"); they do not start a name ("O'FALLON"). */
const ENDINGS = new Set(['S', 'T', 'D', 'M', 'LL', 'RE', 'VE']);
const ORDINAL = /^(\d+)(ST|ND|RD|TH)(\P{L}*)$/u;
const MC = /^MC(\p{L})(.*)$/su;

const hasLower = (s: string) => /\p{Ll}/u.test(s);
const upperFirstLetter = (s: string) => s.replace(/\p{L}/u, (c) => c.toUpperCase());
const titled = (s: string) => upperFirstLetter(s.toLowerCase());
const lettersOf = (s: string) => s.replace(/[^A-Z]/g, '');

/** One all-caps piece of a word: no whitespace, hyphen or apostrophe in it. */
function casePart(part: string, isEnding: boolean): string {
  const ordinal = ORDINAL.exec(part);
  if (ordinal) return `${ordinal[1]}${ordinal[2]!.toLowerCase()}${ordinal[3]}`;
  if (/\d/.test(part)) return part;
  const key = lettersOf(part);
  if (isEnding && ENDINGS.has(key)) return part.toLowerCase();
  if (STAYS_UPPER.has(key)) return part;
  const mc = MC.exec(part);
  if (mc) return `Mc${mc[1]!.toUpperCase()}${mc[2]!.toLowerCase()}`;
  return titled(part);
}

function caseWord(word: string, keepAsRoute: boolean): string {
  if (word === '' || hasLower(word)) return word;
  if (keepAsRoute || ROUTE_WITH_HYPHEN.test(word)) return word;
  const pieces = word.split(/(['’-])/u);
  return pieces
    .map((piece, i) => {
      if (i % 2 === 1) return piece;
      const isEnding = i >= 2 && pieces[i - 1] !== '-' && (pieces[i - 2] ?? '').length >= 2;
      return casePart(piece, isEnding);
    })
    .join('');
}

export function normalCase(text: string): string {
  const tokens = text.split(/(\s+)/u);
  return tokens
    .map((token, i) => {
      if (/^\s*$/u.test(token)) return token;
      const next = tokens[i + 2];
      const keepAsRoute = ROUTE_PREFIXES.has(lettersOf(token)) && token === lettersOf(token) && next !== undefined && /^\d/.test(next);
      return caseWord(token, keepAsRoute);
    })
    .join('');
}
