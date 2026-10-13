import type { Line } from './lines';
import { cityLine } from './templates';

/**
 * The language-model reader's redaction (docs/llm-reader-design.md §2). Pure,
 * and run IN THE BROWSER: what it returns is the only text that may leave.
 *
 * Masks what it can recognise — emails, phones, money, labelled contacts,
 * MC/DOT numbers, web addresses — with a typed placeholder, so the shape of
 * the line survives. It is NOT a guarantee: a name with no label, or a
 * broker's own name in a header, goes through. Facility names, addresses,
 * dates, times and reference numbers stay on purpose; the read needs them.
 *
 * Fails closed: after masking, the lines exactly as they would be sent are
 * scanned again, and any hit means nothing is sent.
 */

export type MaskKind = 'email' | 'phone' | 'amount' | 'labelled' | 'id' | 'url';
export type MaskCounts = Record<MaskKind, number>;

const KINDS: readonly MaskKind[] = ['email', 'phone', 'amount', 'labelled', 'id', 'url'];

export const PLACEHOLDER: Readonly<Record<MaskKind, string>> = {
  email: '[EMAIL]',
  phone: '[PHONE]',
  amount: '[AMOUNT]',
  labelled: '[REMOVED]',
  id: '[ID]',
  url: '[URL]',
};

/** Sent with every read; the server refuses a version it does not run (phase 2). */
export const REDACTION_VERSION = 'redact-2026-10-13.1';

/** What may be sent at all, after redaction. A line is counted without its `L<n> ` prefix. */
export const SEND_LIMITS = { lines: 400, lineChars: 500, totalChars: 24_000 } as const;

/** A line as the vendor receives it: its number and its redacted text, nothing else. */
export interface SentLine {
  n: number;
  text: string;
}

/** A sent line as the browser keeps it: with its page, which is not sent. */
export interface PreparedLine extends SentLine {
  page: number | null;
}

export type Prepared =
  | {
      ok: true;
      version: string;
      lines: PreparedLine[];
      /** Exactly what is sent, `L<n> <text>` a line: the value "Show what is sent" shows. */
      text: string;
      masks: MaskCounts;
    }
  | { ok: false; reason: 'nothing-to-send' | 'too-large' }
  | { ok: false; reason: 'residue'; kinds: MaskKind[] };

const EMAILS = [
  /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi,
  /\b[\w.+-]+(?:\s*[([]at[)\]]\s*|\s+at\s+)[\w-]+(?:(?:\s*[([]dot[)\]]\s*|\s+dot\s+)[\w-]+)+/gi,
];
const URLS = [
  /\b(?:https?:\/\/|www\.)\S+/gi,
  /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|us|biz|co|info)\b/gi,
];
const IDS = [/\b(?:(?:US)?DOT|MC)\s*#?\s*:?\s*\d{4,8}\b/gi];
const PHONES = [
  /(?:\+?1[\s.-]{0,3})?(?:\(\d{3}\)[\s.-]{0,3}|\b\d{3}[\s.-]{1,3})\d{3}[\s.-]{1,3}\d{4}\b(?:\s*(?:x|ext\.?|extension)\s*\d{1,6}\b)?/gi,
  /\b\d(?:[ .]\d){9}\b/g,
  /\+1\d{10}\b/g,
];
/** Ten bare digits are a phone only after a phone word: alone, they could be a load number. */
const PHONE_WORD_DIGITS = /\b(phone|ph|tel|telephone|fax|cell|mobile|call|text)\b(\W{0,6})1?\d{10}\b/gi;
const AMOUNTS = [/\$\s?\d[\d,]*(?:\.\d+)?/g, /\b\d[\d,]*(?:\.\d+)?\s?(?:USD|dollars)\b/gi];
/** A cell about money: its numbers, and the next cell's, are amounts. "Rate Confirmation" is a title, not a rate. */
const MONEY_LABEL = /\b(?:rate(?!\s*con)|line\s?haul|total|fuel|fsc|accessorials?|detention|lumper|tonu|pay|amount|charges?)\b/i;
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
/**
 * A label whose value is a person or how to reach one; the value runs to the
 * end of the cell. Never the word inside a placeholder: `[PHONE]` is not a label.
 */
const LABEL =
  /(?<!\[)\b(?:(?:contact|dispatcher|broker rep|carrier rep|agent|rep|booked by|driver(?: name| cell| phone)?|phone|ph|tel|telephone|fax|cell|mobile|e-?mail)\b|(?:truck|trailer|tractor)\s?#)\s*[:#.-]?\s*/gi;
const STARTS_WITH_PLACEHOLDER = /^\[(?:EMAIL|PHONE|AMOUNT|REMOVED|ID|URL)\]/;

const zero = (): MaskCounts => ({ email: 0, phone: 0, amount: 0, labelled: 0, id: 0, url: 0 });

function mask(text: string, patterns: readonly RegExp[], kind: MaskKind, counts: MaskCounts): string {
  return patterns.reduce(
    (t, pattern) =>
      t.replace(pattern, () => {
        counts[kind] += 1;
        return PLACEHOLDER[kind];
      }),
    text,
  );
}

/** Where a label's value starts, for the first label whose value is not already masked; -1 if none. */
function labelledValueAt(text: string): number {
  for (const match of text.matchAll(LABEL)) {
    const at = match.index + match[0].length;
    if (!STARTS_WITH_PLACEHOLDER.test(text.slice(at))) return at;
  }
  return -1;
}

/** One cell, without regard to its neighbours. `labelOnly`: a label with nothing after it, whose value is the next cell. */
function maskCell(text: string, counts: MaskCounts): { text: string; labelOnly: boolean } {
  let t = mask(text, EMAILS, 'email', counts);
  t = mask(t, URLS, 'url', counts);
  t = mask(t, IDS, 'id', counts);
  t = mask(t, PHONES, 'phone', counts);
  t = t.replace(PHONE_WORD_DIGITS, (_, word: string, gap: string) => {
    counts.phone += 1;
    return `${word}${gap}${PLACEHOLDER.phone}`;
  });
  t = mask(t, AMOUNTS, 'amount', counts);
  const at = labelledValueAt(t);
  if (at !== -1 && at === t.length) return { text: t, labelOnly: true };
  if (at !== -1) {
    counts.labelled += 1;
    t = `${t.slice(0, at)}${PLACEHOLDER.labelled}`;
  }
  return { text: t, labelOnly: false };
}

/** One line: each cell masked, a label's value in the next cell masked, money cells' numbers masked. */
export function redactLine(line: Line): { text: string; masks: MaskCounts } {
  const counts = zero();
  const cells = line.cells.map((c) => maskCell(c.text, counts));
  const texts = cells.map((c) => c.text);
  cells.forEach((cell, i) => {
    if (cell.labelOnly && i + 1 < texts.length && !STARTS_WITH_PLACEHOLDER.test(texts[i + 1]!)) {
      counts.labelled += 1;
      texts[i + 1] = PLACEHOLDER.labelled;
    }
  });
  const money = texts.map((t) => MONEY_LABEL.test(t));
  money.forEach((isMoney, i) => {
    if (!isMoney) return;
    for (const j of [i, i + 1]) {
      if (j >= texts.length) continue;
      texts[j] = texts[j]!.replace(NUMBER, () => {
        counts.amount += 1;
        return PLACEHOLDER.amount;
      });
    }
  });
  return { text: texts.join('  '), masks: counts };
}

/**
 * What a second look would still mask in a line exactly as it is sent — the
 * cells joined, where a phone split across two cells is whole again. Any `@`
 * left is an email's remains. Money
 * by `$` and USD only: a money label's rule is about cells, and the joined
 * line no longer has them.
 */
export function residue(text: string): MaskKind[] {
  const hit = (patterns: readonly RegExp[]) => patterns.some((p) => new RegExp(p.source, p.flags.replace('g', '')).test(text));
  const found: Record<MaskKind, boolean> = {
    // Any `@` at all: half an email split across cells ("ops@" | a masked domain) is still a leak.
    email: hit(EMAILS) || text.includes('@'),
    phone: hit(PHONES) || new RegExp(PHONE_WORD_DIGITS.source, 'i').test(text),
    amount: hit(AMOUNTS),
    labelled: [...text.matchAll(LABEL)].some((m) => {
      const value = text.slice(m.index + m[0].length);
      return value !== '' && !STARTS_WITH_PLACEHOLDER.test(value);
    }),
    id: hit(IDS),
    url: hit(URLS),
  };
  return KINDS.filter((k) => found[k]);
}

/** Page 1, and every page with a US city line. Pasted text has no pages: all of it. */
function selectPages(lines: readonly Line[]): Line[] {
  if (lines.every((l) => l.page === null)) return [...lines];
  const withCity = new Set(
    lines.filter((l) => cityLine(l.text) !== null || l.cells.some((c) => cityLine(c.text) !== null)).map((l) => l.page),
  );
  return lines.filter((l) => l.page === 1 || withCity.has(l.page));
}

/** The document, made ready to send: chosen, redacted, re-scanned, numbered — or refused, saying why. */
export function prepareForReading(lines: readonly Line[]): Prepared {
  const chosen = selectPages(lines);
  if (chosen.length === 0) return { ok: false, reason: 'nothing-to-send' };
  if (chosen.length > SEND_LIMITS.lines) return { ok: false, reason: 'too-large' };

  const masks = zero();
  const out: PreparedLine[] = [];
  for (const [i, line] of chosen.entries()) {
    const redacted = redactLine(line);
    for (const k of KINDS) masks[k] += redacted.masks[k];
    if (redacted.text.length > SEND_LIMITS.lineChars) return { ok: false, reason: 'too-large' };
    out.push({ n: i + 1, page: line.page, text: redacted.text });
  }

  const left = new Set(out.flatMap((l) => residue(l.text)));
  if (left.size > 0) return { ok: false, reason: 'residue', kinds: KINDS.filter((k) => left.has(k)) };

  const text = out.map((l) => `L${l.n} ${l.text}`).join('\n');
  if (text.length > SEND_LIMITS.totalChars) return { ok: false, reason: 'too-large' };
  return { ok: true, version: REDACTION_VERSION, lines: out, text, masks };
}
