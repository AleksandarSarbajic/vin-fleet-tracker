import type { Line } from './lines';
import { isAssignedAreaCode } from './nanp-area-codes';
import { cityLine, isUsState } from './templates';

/**
 * The language-model reader's redaction (docs/llm-reader-design.md §2). Pure,
 * and run IN THE BROWSER: what it returns is the only text that may leave.
 *
 * Masks what it can recognise — emails, phones, money, labelled contacts,
 * MC/DOT numbers, web addresses — with a typed placeholder, so the shape of
 * the line survives. Facility names, addresses, dates, times and reference
 * numbers stay on purpose; the read needs them.
 *
 * It is NOT a guarantee. KNOWN GAPS — what can still go through:
 *   - A person's name with no label and no header above it: a name in a
 *     paragraph, a signature, "Questions? Call Riley", a name in a cell
 *     nothing names. The broker's own name in a header goes through too.
 *   - A name under a header that names a person is masked by ROW (rule B),
 *     so it is found only in the next line (and the one after a blank): a
 *     name further down a table, or under a header that is not a person
 *     label ("Carrier", "Name"), is not.
 *   - A name of more than four words, or one with a digit or a comma in its
 *     cell, is not taken for a name under a header.
 *   - A bare phone (rule A) is found only when its area code is in the static
 *     list (nanp-area-codes.ts) and no identifier label is just before it: a
 *     phone with a code assigned after the list was written, a phone in a
 *     cell right after a "Pickup" or "Ref" cell, or one with letters stuck to
 *     it, is not.
 *   - The re-scan has no memory of other lines: it catches a bare phone and
 *     a name after a label in the same line, but not a name under a header.
 * "Show what is sent" is the dispatcher's check on all of it.
 *
 * Passes: each cell on its own; then the cells JOINED as they are sent, with
 * the same detectors — a value split across cells (an email, a phone, an MC
 * label and its number) is whole again only there; then a person's name that
 * runs on past its label's cell; then bare phone digits (A); and, over the
 * document, the row below a person header (B).
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
export const REDACTION_VERSION = 'redact-2026-10-14.3';

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
/**
 * Rule A (2026-10-14). A run of exactly ten digits, or eleven starting with 1,
 * standing alone: not part of a longer number, a word, or a hyphenated or
 * decimal one. A phone when its area code is assigned (nanp-area-codes.ts)
 * and no identifier label is just before it — "could be a load number" is
 * answered by the label, not by leaving every bare number alone.
 */
const BARE_DIGITS = /(?<![\w-]|\d[.,])\d{10,11}(?![\w-]|[.,]\d)/g;
/**
 * A label that says what follows is a reference number, at the end of the
 * text before it: the same cell ("Load #: ") or the previous one (the cell
 * gap is spaces). Nothing else between, so a label two cells back guards
 * nothing.
 */
const IDENTIFIER_LABEL =
  /\b(?:load|order|pro|bol|po|so|si|ref|reference|shipment|pickup|pick-up|delivery|confirmation|tracking|trip|stop)\b(?:\s*(?:#|no\b\.?|num(?:ber)?\b|nbr\b|id\b))*[\s:#.=-]*$/i;
export const identifierLabelBefore = (before: string): boolean => IDENTIFIER_LABEL.test(before);

const isBarePhoneDigits = (digits: string): boolean =>
  digits.length === 10 ? isAssignedAreaCode(digits.slice(0, 3)) : digits.startsWith('1') && isAssignedAreaCode(digits.slice(1, 4));

/** The bare phones in a text, as the mask and the re-scan both read them. */
function bareDigitPhones(text: string): RegExpExecArray[] {
  return [...text.matchAll(BARE_DIGITS)].filter(
    (m) => isBarePhoneDigits(m[0]) && !identifierLabelBefore(text.slice(0, m.index)),
  );
}

/** Rule A over a text: each bare phone becomes a phone placeholder, counted in `counts.phone` and in `n`. */
function maskBarePhones(text: string, counts: MaskCounts): { text: string; n: number } {
  const hits = bareDigitPhones(text);
  if (hits.length === 0) return { text, n: 0 };
  let out = '';
  let from = 0;
  for (const m of hits) {
    out += `${text.slice(from, m.index)}${PLACEHOLDER.phone}`;
    from = m.index + m[0].length;
  }
  counts.phone += hits.length;
  return { text: out + text.slice(from), n: hits.length };
}
/**
 * `$` then any spaces then a number (2026-10-14: was at most one space, so
 * "$" | "1,850" in two cells — "$  1,850" joined — passed both the mask and
 * the re-scan).
 */
const AMOUNTS = [/\$\s*\d[\d,]*(?:\.\d+)?/g, /\b\d[\d,]*(?:\.\d+)?\s?(?:USD|dollars)\b/gi];
/** A cell about money: its numbers, and the next cell's, are amounts. "Rate Confirmation" is a title, not a rate. */
const MONEY_LABEL = /\b(?:rate(?!\s*con)|line\s?haul|total|fuel|fsc|accessorials?|detention|lumper|tonu|pay|amount|charges?)\b/i;
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
/** The labels whose value is a PERSON, not only how to reach one. */
const PERSON_WORDS = 'contact|dispatcher|broker rep|carrier rep|agent|rep|booked by|driver(?: name| cell| phone)?';
/**
 * A label whose value is a person or how to reach one; the value runs to the
 * end of the cell. Never the word inside a placeholder: `[PHONE]` is not a label.
 */
const LABEL = new RegExp(
  `(?<!\\[)\\b(?:(?:${PERSON_WORDS}|phone|ph|tel|telephone|fax|cell|mobile|e-?mail)\\b|(?:truck|trailer|tractor)\\s?#)\\s*[:#.-]?\\s*`,
  'gi',
);
/** A label whose value is a person: a name can run on past its cell (`personNames`). */
const PERSON_LABEL = new RegExp(`(?<!\\[)\\b(?:${PERSON_WORDS})\\b\\s*[:#.-]?\\s*`, 'gi');
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

/** Cells are joined with this, as they are sent. */
const CELL_GAP = '  ';
const PLACEHOLDER_TOKEN = /^(?:\[(?:EMAIL|PHONE|AMOUNT|REMOVED|ID|URL)\])+$/;

/**
 * Any `@` the email detectors left is an email's remains. Its whole token
 * goes. When that token is the first or last of its cell, the token touching
 * it across the cell boundary goes too, and on outward while each is its
 * cell's only token: "ops" | "@example.com" loses "ops" with the rest, as a
 * local part can be a person's name. A placeholder stops the walk: it is
 * already a mask. An `@` between spaces inside a cell ("Pick up @ 08:00")
 * takes only itself.
 */
function maskAtTokens(cells: readonly string[], counts: MaskCounts): string[] {
  const tokens = cells.map((c) => c.split(/(\s+)/));
  /** Indexes of a cell's words (its non-space tokens). */
  const words = (cell: number) => tokens[cell]!.flatMap((t, k) => (t.trim() === '' ? [] : [k]));
  const doomed = tokens.map(() => new Set<number>());

  /** Walk from (cell, word) across boundaries in `step` direction, dooming each touching word. */
  const walk = (cell: number, word: number, step: -1 | 1) => {
    for (let c = cell, at = word; ; ) {
      const own = words(c);
      const edge = step === -1 ? own[0] : own[own.length - 1];
      if (at !== edge) return;
      c += step;
      if (c < 0 || c >= tokens.length) return;
      const next = words(c);
      if (next.length === 0) return;
      at = step === -1 ? next[next.length - 1]! : next[0]!;
      if (PLACEHOLDER_TOKEN.test(tokens[c]![at]!)) return;
      doomed[c]!.add(at);
      if (next.length > 1) return;
    }
  };

  tokens.forEach((cell, c) =>
    cell.forEach((token, k) => {
      if (!token.includes('@') || doomed[c]!.has(k)) return;
      counts.email += 1;
      doomed[c]!.add(k);
      walk(c, k, -1);
      walk(c, k, 1);
    }),
  );
  return tokens.map((cell, c) => cell.map((t, k) => (doomed[c]!.has(k) ? PLACEHOLDER.email : t)).join(''));
}

/**
 * The second pass, over the line as it is sent: the same detectors as a cell
 * gets. Idempotent — a placeholder matches none of them. Labels are not
 * re-run: a label's value is a cell's rest or the next cell, which the first
 * pass handled; the re-scan still checks them.
 */
export function maskJoined(text: string, counts: MaskCounts): string {
  let t = mask(text, EMAILS, 'email', counts);
  t = mask(t, URLS, 'url', counts);
  t = mask(t, IDS, 'id', counts);
  t = mask(t, PHONES, 'phone', counts);
  t = t.replace(PHONE_WORD_DIGITS, (_, word: string, gap: string) => {
    counts.phone += 1;
    return `${word}${gap}${PLACEHOLDER.phone}`;
  });
  return mask(t, AMOUNTS, 'amount', counts);
}

/** A cell's leading placeholders, with what separates them, and the rest of the cell. */
const LEADING_PLACEHOLDERS = /^(?:\[(?:EMAIL|PHONE|AMOUNT|REMOVED|ID|URL)\][\s,;/|-]*)*/;
/** A word of a name: letters, apostrophes, hyphens, periods, at least one letter. No digit, no colon, no bracket. */
const NAME_WORD = /^(?=.*\p{L})[\p{L}\p{M}'’.-]+$/u;
const isNameLike = (text: string) => text !== '' && text.split(' ').every((w) => NAME_WORD.test(w));
const hasLabel = (text: string) => new RegExp(LABEL.source, 'i').test(text);
/** Name-like cells a person label's value may run on into, past its own cell. */
export const NAME_CELLS = 3;

function splitLead(text: string): { lead: string; rest: string } {
  const lead = LEADING_PLACEHOLDERS.exec(text)![0];
  return { lead, rest: text.slice(lead.length) };
}

/** The rest's leading name words, as one placeholder; and whether nothing else follows them. */
function maskLeadingNames(rest: string): { text: string; masked: boolean; ended: boolean } {
  const words = rest.split(' ');
  const k = words.findIndex((w) => !NAME_WORD.test(w));
  const names = k === -1 ? words.length : k;
  const after = words.slice(names).join(' ');
  if (names === 0) return { text: rest, masked: false, ended: rest === '' };
  return { text: after === '' ? PLACEHOLDER.labelled : `${PLACEHOLDER.labelled} ${after}`, masked: true, ended: after === '' };
}

/**
 * The third pass, over the line as it is sent (2026-10-14, Alex: the
 * labelled name split across cells). After a PERSON label — contact,
 * dispatcher, rep, agent, booked by, driver — a name can outrun the label's
 * cell: "Dispatcher:" | "Dana" | "Example", or "Contact" | "[PHONE] Dana
 * Example", which the first pass sends because the value starts with a
 * placeholder. So:
 *   - in the label's own cell, the name-like words after its placeholders go;
 *   - if that reaches the cell's end, the walk goes on into the next cells:
 *     a cell of placeholders only is passed over (already masked; the value
 *     runs on), a cell that starts with placeholders loses its leading
 *     name-like words, and any other cell goes whole while it is name-like;
 *   - it stops at the first cell that is not, at a cell with a label of its
 *     own, or after NAME_CELLS cells it masked.
 * Name-like: letters, spaces, apostrophes, hyphens, periods; no digit, no
 * colon, no comma — so a ZIP, a time, a date, a street number, a load number
 * and "Fargo, ND" stop it. A facility name in the cells right after a person
 * label goes with it: that is the cost.
 *
 * Runs on the joined text, split back on the cell gap: the cells the re-scan
 * sees, after the joined pass has merged any value split across cells.
 */
function maskPersonNames(text: string, counts: MaskCounts): { text: string; names: number } {
  const cells = text.split(CELL_GAP);
  let names = 0;
  const masked = () => {
    names += 1;
    counts.labelled += 1;
  };
  for (let i = 0; i < cells.length; i += 1) {
    const labels = [...cells[i]!.matchAll(PERSON_LABEL)];
    let runsOn = false;
    // Last label first, so masking after one leaves the earlier ones' places as they were.
    for (const m of labels.reverse()) {
      const at = m.index + m[0].length;
      const { lead, rest } = splitLead(cells[i]!.slice(at));
      const out = maskLeadingNames(rest);
      if (out.masked) {
        cells[i] = `${cells[i]!.slice(0, at)}${lead}${out.text}`;
        masked();
      }
      runsOn ||= out.ended;
    }
    if (!runsOn) continue;
    for (let c = i + 1, walked = 0; c < cells.length && walked < NAME_CELLS; c += 1) {
      const cell = cells[c]!;
      if (hasLabel(cell)) break;
      const { lead, rest } = splitLead(cell);
      if (rest === '') continue;
      if (lead === '') {
        if (!isNameLike(rest)) break;
        cells[c] = PLACEHOLDER.labelled;
        masked();
        walked += 1;
        continue;
      }
      const out = maskLeadingNames(rest);
      if (out.masked) {
        cells[c] = `${lead}${out.text}`;
        masked();
        walked += 1;
      }
      if (!out.ended) break;
    }
  }
  return { text: cells.join(CELL_GAP), names };
}

/** One line, redacted: `names` and `bare` are what the person-name pass and rule A masked, counted in `masks` too. */
export interface RedactedLine {
  text: string;
  masks: MaskCounts;
  names: number;
  bare: number;
  /** What rule B masked in this line, because of the header above it: counted in `masks.labelled` too. */
  below: number;
}

/**
 * One line: each cell masked, a label's value in the next cell masked, money
 * cells' numbers masked; then the joined line; then a person's name that runs
 * on past its label's cell; then bare phone digits, last, so a cell the
 * earlier passes masked cannot leave a number without its label. `names`
 * counts the name pass's masks, which are in `masks.labelled` too; `bare`
 * rule A's, which are in `masks.phone`. `below` is the document pass's.
 */
export function redactLine(line: Line): RedactedLine {
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
  const person = maskPersonNames(maskJoined(maskAtTokens(texts, counts).join(CELL_GAP), counts), counts);
  const bare = maskBarePhones(person.text, counts);
  return { text: bare.text, masks: counts, names: person.names, bare: bare.n, below: 0 };
}

/* ------------------- rule B: the row below a person header ------------------- */

/** Words a header cell is made of; a header cell is all of these, and a person header has a role among them. */
const HEADER_WORDS = new Set([
  'contact', 'dispatcher', 'dispatch', 'rep', 'representative', 'agent', 'booked', 'by', 'driver', 'name', 'phone', 'ph',
  'tel', 'telephone', 'cell', 'mobile', 'fax', 'email', 'e-mail', 'number', 'no', 'ext', 'info', 'carrier', 'broker',
  'company', 'mc', 'dot', 'truck', 'trailer', 'tractor', 'id',
]);
const PERSON_ROLES = new Set(['contact', 'dispatcher', 'dispatch', 'rep', 'representative', 'agent', 'booked', 'driver']);
const headerWords = (cell: string): string[] => cell.toLowerCase().replace(/[:#.,]+/g, ' ').split(/\s+/).filter((w) => w !== '');
const isHeaderCell = (cell: string): boolean => {
  const words = headerWords(cell);
  return words.length > 0 && words.every((w) => HEADER_WORDS.has(w));
};
const isPersonHeaderCell = (cell: string): boolean => isHeaderCell(cell) && headerWords(cell).some((w) => PERSON_ROLES.has(w));

/**
 * A line is a person header when one of its cells is a person label with
 * nothing after it: the last cell of the line, or followed by another header
 * cell ("Contact" | "Phone" | "Email"). A person label followed by a value
 * ("Contact:" | "Dana Example") is the same-line case, handled where it
 * always was. Read from the cells as they were, not as masked: the label
 * pass has already turned the header's cells into placeholders.
 */
function isPersonHeader(line: Line): boolean {
  const cells = line.cells.map((c) => c.text.trim()).filter((t) => t !== '');
  return cells.some((cell, i) => isPersonHeaderCell(cell) && (i === cells.length - 1 || isHeaderCell(cells[i + 1]!)));
}

const COMPANY_WORDS = new Set([
  'INC', 'LLC', 'LTD', 'CORP', 'CO', 'LOGISTICS', 'FREIGHT', 'TRANSPORT', 'TRUCKING', 'EXPRESS', 'GROUP', 'SERVICES',
  'SOLUTIONS', 'DISTRIBUTION', 'WAREHOUSE', 'DC',
]);
const DAY_WORDS = new Set([
  'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun', 'monday', 'tuesday', 'wednesday', 'thursday',
  'friday', 'saturday', 'sunday', 'am', 'pm', 'to', 'thru', 'through',
]);
/** Letters, spaces, hyphens, apostrophes and periods only: no digit (so no ZIP, date, time, street number), no comma, no colon, no bracket. */
const PERSON_CELL = /^[\p{L}\p{M}'’. -]+$/u;
const PLACEHOLDER_ANY = /\[(?:EMAIL|PHONE|AMOUNT|REMOVED|ID|URL)\]/g;
/** A cell as leading placeholders, the rest, and trailing placeholders. */
const AROUND_PLACEHOLDERS = /^((?:\[(?:EMAIL|PHONE|AMOUNT|REMOVED|ID|URL)\][\s,;/|-]*)*)(.*?)((?:[\s,;/|-]*\[(?:EMAIL|PHONE|AMOUNT|REMOVED|ID|URL)\])*)$/;

/**
 * Under a person header, is this text a person? One to four words of letters
 * (a cell with a digit or a comma is a ZIP, a date, a time, an address, a
 * city line or a number, so `cityLine` is never needed here), and not
 * obviously not: an ALL-CAPS cell with a company word, a state, a run of
 * weekdays. In doubt it is a person: a lost name costs a blank, a leaked one
 * a person's privacy. A street name with no number ("Pat Lane") is masked:
 * every real street line has a number, and a street test without one would
 * only unmask surnames.
 */
function isPersonUnderHeader(text: string): boolean {
  if (!PERSON_CELL.test(text) || !/\p{L}/u.test(text)) return false;
  const words = text.split(/\s+/).filter((w) => w !== '');
  if (words.length < 1 || words.length > 4) return false;
  if (text === text.toUpperCase() && words.some((w) => COMPANY_WORDS.has(w.replace(/\./g, '')))) return false;
  if (/^[A-Z]{2}$/.test(text) && isUsState(text)) return false;
  if (text.toLowerCase().split(/[\s-]+/).every((w) => DAY_WORDS.has(w.replace(/\./g, '')))) return false;
  return true;
}

/** One cell of a row under a person header: the person part becomes a placeholder, placeholders around it stay. */
function maskPersonCell(cell: string): string | null {
  const [, lead, core, trail] = AROUND_PLACEHOLDERS.exec(cell)!;
  if (core === '' || !isPersonUnderHeader(core!)) return null;
  return `${lead}${PLACEHOLDER.labelled}${trail}`;
}

const isBlankOrMasked = (text: string): boolean => text.replace(PLACEHOLDER_ANY, '').replace(/[\s,;/|-]+/g, '') === '';

/**
 * Rule B (2026-10-14). The values under a person header sit on the NEXT line,
 * where the label rule does not look: "Contact" | "Phone" on one line, "Dana
 * Example" | "612-555-0147" on the next. The next line's cells are masked by
 * ROW — there is no column alignment to go by. If that line is blank or only
 * placeholders, the line after it is masked too, and no further. A line that
 * is itself a person header is not a row of values: it masks its own next
 * line. Never across a page.
 */
function maskBelowHeaders(lines: readonly Line[], out: RedactedLine[]): void {
  lines.forEach((header, i) => {
    if (!isPersonHeader(header)) return;
    for (let j = i + 1; j <= i + 2 && j < lines.length; j += 1) {
      const line = lines[j]!;
      const result = out[j]!;
      if (line.page !== header.page || isPersonHeader(line)) return;
      const wasEmpty = isBlankOrMasked(result.text);
      let below = 0;
      const cells = result.text.split(CELL_GAP).map((cell) => {
        const masked = maskPersonCell(cell);
        if (masked === null) return cell;
        below += 1;
        return masked;
      });
      if (below > 0) {
        result.masks.labelled += below;
        result.below += below;
        // A cell masked here may have been the label that kept a number: look again.
        const bare = maskBarePhones(cells.join(CELL_GAP), result.masks);
        result.text = bare.text;
        result.bare += bare.n;
      }
      if (!wasEmpty) return;
    }
  });
}

/** The lines of a document, redacted: each line on its own, then the rows under person headers (rule B). */
export function redactDocument(lines: readonly Line[]): RedactedLine[] {
  const out = lines.map(redactLine);
  maskBelowHeaders(lines, out);
  return out;
}

/**
 * The re-scan's own reading of a person label, written apart from the mask
 * (`maskPersonNames`) on purpose: does a name still follow one? In the
 * label's cell, after its placeholders, the next word must not be name-like;
 * if the cell ends there, the first following cell that is not placeholders
 * only must not be name-like (whole, or its first word after placeholders).
 * A cell with a label of its own ends the look. NO limit on how far: a fifth
 * name-like cell after "Contact" | four masked ones is a hit, and the
 * document is refused rather than sent with it.
 */
function nameLeft(text: string): boolean {
  const cells = text.split(CELL_GAP);
  const firstWordIsName = (rest: string) => NAME_WORD.test(rest.split(' ')[0]!);
  return cells.some((cell, i) =>
    [...cell.matchAll(PERSON_LABEL)].some((m) => {
      const own = cell.slice(m.index + m[0].length).replace(LEADING_PLACEHOLDERS, '');
      if (own !== '') return firstWordIsName(own);
      for (const next of cells.slice(i + 1)) {
        if (hasLabel(next)) return false;
        const rest = next.replace(LEADING_PLACEHOLDERS, '');
        if (rest === '') continue;
        return rest === next ? isNameLike(rest) : firstWordIsName(rest);
      }
      return false;
    }),
  );
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
    phone: hit(PHONES) || new RegExp(PHONE_WORD_DIGITS.source, 'i').test(text) || bareDigitPhones(text).length > 0,
    amount: hit(AMOUNTS),
    labelled:
      [...text.matchAll(LABEL)].some((m) => {
        const value = text.slice(m.index + m[0].length);
        return value !== '' && !STARTS_WITH_PLACEHOLDER.test(value);
      }) || nameLeft(text),
    id: hit(IDS),
    url: hit(URLS),
  };
  return KINDS.filter((k) => found[k]);
}

/** Page 1, and every page with a US city line. Pasted text has no pages: all of it. */
export function selectPages(lines: readonly Line[]): Line[] {
  if (lines.every((l) => l.page === null)) return [...lines];
  const withCity = new Set(
    lines.filter((l) => cityLine(l.text) !== null || l.cells.some((c) => cityLine(c.text) !== null)).map((l) => l.page),
  );
  return lines.filter((l) => l.page === 1 || withCity.has(l.page));
}

/**
 * The same chosen, redacted, numbered lines `prepareForReading` would send,
 * each with what the re-scan still finds in it — for a PERSON to review
 * locally (`npm run ratecon:review-redacted`, docs/llm-reader-design.md
 * §8.2). Never sent: `prepareForReading` refuses the whole document on any
 * hit. Not called by the app.
 */
export function redactedForReview(lines: readonly Line[]): {
  /** What the passes masked in the line, counts only, for the report: `names` the name pass, `bare` rule A, `below` rule B. */
  lines: (PreparedLine & { residue: MaskKind[]; names: number; bare: number; below: number })[];
  masks: MaskCounts;
} {
  const masks = zero();
  const chosen = selectPages(lines);
  const out = redactDocument(chosen).map((redacted, i) => {
    for (const k of KINDS) masks[k] += redacted.masks[k];
    return {
      n: i + 1,
      page: chosen[i]!.page,
      text: redacted.text,
      residue: residue(redacted.text),
      names: redacted.names,
      bare: redacted.bare,
      below: redacted.below,
    };
  });
  return { lines: out, masks };
}

/** The document, made ready to send: chosen, redacted, re-scanned, numbered — or refused, saying why. */
export function prepareForReading(lines: readonly Line[]): Prepared {
  const chosen = selectPages(lines);
  if (chosen.length === 0) return { ok: false, reason: 'nothing-to-send' };
  if (chosen.length > SEND_LIMITS.lines) return { ok: false, reason: 'too-large' };

  const masks = zero();
  const out: PreparedLine[] = [];
  for (const [i, redacted] of redactDocument(chosen).entries()) {
    for (const k of KINDS) masks[k] += redacted.masks[k];
    if (redacted.text.length > SEND_LIMITS.lineChars) return { ok: false, reason: 'too-large' };
    out.push({ n: i + 1, page: chosen[i]!.page, text: redacted.text });
  }

  const left = new Set(out.flatMap((l) => residue(l.text)));
  if (left.size > 0) return { ok: false, reason: 'residue', kinds: KINDS.filter((k) => left.has(k)) };

  const text = out.map((l) => `L${l.n} ${l.text}`).join('\n');
  if (text.length > SEND_LIMITS.totalChars) return { ok: false, reason: 'too-large' };
  return { ok: true, version: REDACTION_VERSION, lines: out, text, masks };
}
