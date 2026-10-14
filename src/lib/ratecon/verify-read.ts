import { ZONE_BY_STATE } from '../geo/zone-by-state';
import { startsLikeStreet } from '../paste-address';
import type { ModelAppointment, ModelQuote, ModelRead, ModelStop } from './model-read';
import type { PreparedLine } from './redact';
import { cityLine, type Flag, type RateconRead, type Source, type Sourced, type StopRead, type TimeRead } from './templates';

/**
 * The language-model reader's verifier (docs/llm-reader-design.md §3). Pure,
 * and run in the browser against EXACTLY the lines it sent.
 *
 * A value stands only when (1) its quote is in the line(s) it cites, as sent,
 * and (2) the value follows from the quote by our own deterministic rules.
 * Anything else is left blank and marked. What stands is filled with the
 * DOCUMENT's text — the quote's spelling, never the model's.
 *
 * The result is a `RateconRead` with layout `model`, so `ratecon-fill.ts`
 * applies the same appointment, zone and date rules it applies to a template
 * read. No format is ever imposed on the load number (§12.21): it must only
 * be a whole token of its quote.
 *
 * A mark quotes only text that is in the document. When the model's quote is
 * not there, the mark says so and does not repeat it.
 */

export type Verified =
  | {
      ok: true;
      read: RateconRead;
      /** Values that stood, and values the model gave that did not: counts for the evaluation, never which. */
      confirmed: number;
      unconfirmed: number;
    }
  | { ok: false; reason: 'nothing-confirmed' };

type AddressField = 'street' | 'city' | 'state' | 'zip';

const PLACEHOLDER = /\[(?:EMAIL|PHONE|AMOUNT|REMOVED|ID|URL)\]/;
const ALNUM = /[A-Za-z0-9]/;
const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Said under a field the model filled from a quote that is not in the text. */
export const NOT_IN_TEXT = 'Read by AI, but what it quoted is not in the text. Enter it by hand.';
/** Said under a field whose quote is in the text but does not give the value. */
const doesNotFollow = (quote: string) => `Read by AI, but it does not follow from “${quote}”. Enter it by hand.`;
const NOT_IN_TEXT_QUOTED = 'the AI’s quote is not in the text';

interface Located {
  text: string;
  page: number | null;
}

/** The quote, if it is in the lines it cites (joined with a space, whitespace collapsed); null otherwise. */
export function locate(quote: ModelQuote, sent: ReadonlyMap<number, PreparedLine>): Located | null {
  const lines: PreparedLine[] = [];
  for (let n = quote.line; n <= (quote.lineEnd ?? quote.line); n += 1) {
    const line = sent.get(n);
    if (!line) return null;
    lines.push(line);
  }
  const wanted = squash(quote.text);
  if (wanted === '' || !squash(lines.map((l) => l.text).join(' ')).includes(wanted)) return null;
  return { text: quote.text, page: lines[0]!.page };
}

/** The value as the quote spells it, when it is a whole token run of the quote (any case); null otherwise. */
function tokenIn(quote: string, value: string): string | null {
  const v = squash(value);
  if (v === '' || PLACEHOLDER.test(v)) return null;
  const hay = squash(quote);
  const lower = hay.toLowerCase();
  for (let at = lower.indexOf(v.toLowerCase()); at !== -1; at = lower.indexOf(v.toLowerCase(), at + 1)) {
    const before = hay[at - 1];
    const after = hay[at + v.length];
    if ((!before || !ALNUM.test(before)) && (!after || !ALNUM.test(after))) return hay.slice(at, at + v.length);
  }
  return null;
}

/* --------------------------------- dates --------------------------------- */

const MONTH_INDEX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
/**
 * A year after a named date is 2020 to 2039: "Oct 14 0800" is a date and a time,
 * and "Oct 14 1400" too — a year of any four digits ate the time.
 */
const NAMED_DATE =
  /\b(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(20[23]\d)\b)?/gi;
/**
 * M/D, M/D/YY, M/D/YYYY (or with dashes) — but "7-10 AM" is a time, not July 10,
 * and neither is the "00-15" inside "08:00-15:00": a match never starts right after
 * a colon or ends right before one and a digit, where it is part of a clock time
 * (2026-10-15: the date blanking destroyed both times of a 24-hour range).
 */
const NUMERIC_DATE = /(?<!:)\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}|\d{2}))?\b(?!:\d)(?!\s*[ap]\.?\s?m?\b)/gi;

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const realDate = (y: number, m: number, d: number) => {
  const at = new Date(Date.UTC(y, m - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d;
};
const dayOffset = (now: Date, days: number) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days)).toISOString().slice(0, 10);

/**
 * Every date the text holds, and the text with them blanked out (so a year is
 * never read as a time). A date with no year stands only when exactly one of
 * last year, this year and next falls in −1 to +30 days of today (UTC; the
 * day either side covers the stop's own zone).
 */
function datesIn(text: string, now: Date): { dates: Set<string>; rest: string } {
  const dates = new Set<string>();
  const from = dayOffset(now, -1);
  const to = dayOffset(now, 30);
  const add = (y: number | null, m: number, d: number) => {
    if (y !== null) {
      if (realDate(y, m, d)) dates.add(isoOf(y, m, d));
      return;
    }
    const year = now.getUTCFullYear();
    const fits = [year - 1, year, year + 1]
      .filter((yy) => realDate(yy, m, d))
      .map((yy) => isoOf(yy, m, d))
      .filter((iso) => iso >= from && iso <= to);
    if (fits.length === 1) dates.add(fits[0]!);
  };
  let rest = text.replace(ISO_DATE, (all, y: string, m: string, d: string) => {
    add(Number(y), Number(m), Number(d));
    return ' '.repeat(all.length);
  });
  rest = rest.replace(NAMED_DATE, (all, month: string, d: string, y: string | undefined) => {
    add(y ? Number(y) : null, MONTH_INDEX[month.slice(0, 3).toLowerCase()]!, Number(d));
    return ' '.repeat(all.length);
  });
  rest = rest.replace(NUMERIC_DATE, (all, m: string, d: string, y: string | undefined) => {
    add(y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : null, Number(m), Number(d));
    return ' '.repeat(all.length);
  });
  return { dates, rest };
}

/* --------------------------------- times --------------------------------- */

const MERIDIEM = String.raw`([ap])\.?\s?m?\.?(?![a-z])`;
/** "7-10 AM": a start with no AM/PM of its own takes the end's. */
const SHARED_MERIDIEM = new RegExp(String.raw`\b(\d{1,2})(?::(\d{2}))?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*${MERIDIEM}`, 'gi');
const TWELVE = new RegExp(String.raw`\b(\d{1,2})(?::(\d{2}))?\s*${MERIDIEM}`, 'gi');
const FOUR_DIGITS = /\b([01]\d|2[0-3])([0-5]\d)\b/g;
const CLOCK = new RegExp(String.raw`\b(\d{1,2}):(\d{2})\b(?!\s*${MERIDIEM})`, 'gi');

const hhmm = (h: number, m: number) => `${pad(h)}:${pad(m)}`;
const from12 = (h: number, m: number, meridiem: string) =>
  h >= 1 && h <= 12 && m <= 59 ? (h % 12) + (meridiem.toLowerCase() === 'p' ? 12 : 0) : null;

/** A time with AM/PM: "8 AM", "8:00 pm", "7:00 A.M.", "8:00P", the end of "7-10 AM". Any one of these, anywhere, rules out a 24-hour document. */
const AM_PM_TIME = /\b\d{1,2}(?::\d{2})?\s*[ap]\.?\s?m\b|\b\d{1,2}:\d{2}\s*[ap]\b(?![a-z.])/i;
/** An unambiguous 24-hour clock: an hour past 12, or a two-digit hour with a leading zero. "10:00" is not one. */
const TWENTY_FOUR_HOUR_TIME = /\b(?:0\d|1[3-9]|2[0-3]):[0-5]\d\b/;

/**
 * Is the DOCUMENT on a 24-hour clock? It holds at least one unambiguous 24-hour
 * time (13:30, 08:00) and no time with AM/PM at all. Computed once, from the
 * lines that were sent. Then a bare "11:00" is 11:00; otherwise it is not
 * guessed (§12.122).
 */
export function documentIs24Hour(sent: readonly PreparedLine[]): boolean {
  const text = sent.map((l) => l.text).join('\n');
  return TWENTY_FOUR_HOUR_TIME.test(text) && !AM_PM_TIME.test(text);
}

/**
 * Every time the text holds. AM/PM, or four digits ("1400"), or HH:MM when
 * the quote shows a 24-hour clock — a leading zero or an hour past 12
 * somewhere in it — or when the document does (`hours24`). A bare "8:00" or
 * "10:00" alone is never guessed (§12.122).
 */
function timesIn(text: string, hours24: boolean): Set<string> {
  const times = new Set<string>();
  for (const m of text.matchAll(SHARED_MERIDIEM)) {
    const end = from12(Number(m[3]), Number(m[4] ?? 0), m[5]!);
    const start = from12(Number(m[1]), Number(m[2] ?? 0), m[5]!);
    if (end === null) continue;
    times.add(hhmm(end, Number(m[4] ?? 0)));
    const startTime = start === null ? null : hhmm(start, Number(m[2] ?? 0));
    if (startTime !== null && startTime <= hhmm(end, Number(m[4] ?? 0))) times.add(startTime);
  }
  for (const m of text.matchAll(TWELVE)) {
    const h = from12(Number(m[1]), Number(m[2] ?? 0), m[3]!);
    if (h !== null) times.add(hhmm(h, Number(m[2] ?? 0)));
  }
  for (const m of text.matchAll(FOUR_DIGITS)) times.add(hhmm(Number(m[1]), Number(m[2])));
  const clocks = [...text.matchAll(CLOCK)].map((m) => ({ raw: m[1]!, h: Number(m[1]), m: Number(m[2]) }));
  const twentyFour = clocks.some((c) => (c.raw.length === 2 && c.raw.startsWith('0')) || c.h >= 13);
  if (twentyFour || hours24) {
    for (const c of clocks) if (c.h <= 23 && c.m <= 59) times.add(hhmm(c.h, c.m));
  }
  return times;
}

/* ------------------------------ appointments ----------------------------- */

const APPT_WORDS = /\b(?:appt|appointment)\b/i;
const FCFS_WORDS = /\b(?:fcfs|first come)\b/i;

function timeFrom(
  a: ModelAppointment,
  sent: ReadonlyMap<number, PreparedLine>,
  now: Date,
  hours24: boolean,
): { time: TimeRead; confirmed: boolean } {
  if (a.kind === 'none') return { time: { kind: 'none', source: null }, confirmed: false };
  if (a.kind === 'unclear') {
    const at = locate(a.quote, sent);
    return {
      time: at
        ? { kind: 'unreadable', date: null, quoted: at.text, source: { text: at.text, page: at.page } }
        : { kind: 'unreadable', date: null, quoted: NOT_IN_TEXT_QUOTED, source: { text: NOT_IN_TEXT_QUOTED, page: null } },
      confirmed: false,
    };
  }

  const dateAt = locate(a.dateQuote, sent);
  const timeAt = locate(a.timeQuote, sent);
  const endAt = a.kind === 'range' && a.endQuote ? locate(a.endQuote, sent) : null;
  const located = [dateAt, timeAt, endAt].filter((l): l is Located => l !== null);
  const source: Source = {
    text: located.length > 0 ? [...new Set(located.map((l) => l.text))].join(' · ') : NOT_IN_TEXT_QUOTED,
    page: located[0]?.page ?? null,
  };

  const onDate = dateAt ? datesIn(dateAt.text, now).dates : new Set<string>();
  const clockOf = (at: Located | null) => (at ? timesIn(datesIn(at.text, now).rest, hours24) : new Set<string>());
  const atTime = clockOf(timeAt);
  const dateOk = onDate.has(a.date);
  const timeOk = atTime.has(a.time);
  const said = located.map((l) => l.text).join(' ');
  const flag: Flag = a.flag === 'APPT' && APPT_WORDS.test(said) ? 'APPT' : a.flag === 'FCFS' && FCFS_WORDS.test(said) ? 'FCFS' : null;
  const unreadable = (): TimeRead => ({
    kind: 'unreadable',
    date: dateOk ? a.date : null,
    quoted: timeAt?.text ?? dateAt?.text ?? NOT_IN_TEXT_QUOTED,
    source,
  });

  if (a.kind === 'exact') {
    return dateOk && timeOk
      ? { time: { kind: 'exact', date: a.date, time: a.time, flag, source }, confirmed: true }
      : { time: unreadable(), confirmed: false };
  }
  const endDates = new Set([...onDate, ...(endAt ? datesIn(endAt.text, now).dates : [])]);
  const endDateOk = a.endDate === a.date ? dateOk : endDates.has(a.endDate);
  const endTimeOk = atTime.has(a.endTime) || clockOf(endAt).has(a.endTime);
  return dateOk && timeOk && endDateOk && endTimeOk
    ? {
        time: { kind: 'range', date: a.date, time: a.time, endDate: a.endDate, endTime: a.endTime, flag, source },
        confirmed: true,
      }
    : { time: unreadable(), confirmed: false };
}

/* --------------------------------- stops --------------------------------- */

const PICKUP_WORDS = /\b(?:pick\s?-?\s?up|shipper|origin|load at)\b/i;
const DELIVERY_WORDS = /\b(?:deliver(?:y|ies|ed)?|consignee|receiver|destination|drop)\b/i;

type FieldResult = { value: Sourced<string> | null; check: string | null };

function addressField(
  field: AddressField,
  cited: ModelStop[AddressField],
  sent: ReadonlyMap<number, PreparedLine>,
): FieldResult {
  if (!cited) return { value: null, check: null };
  const at = locate(cited.quote, sent);
  if (!at) return { value: null, check: NOT_IN_TEXT };
  const source = { text: at.text, page: at.page };
  const no = { value: null, check: doesNotFollow(at.text) };
  const wanted = squash(cited.value);
  if (PLACEHOLDER.test(wanted)) return no;

  if (field === 'street') {
    const found = tokenIn(at.text, wanted);
    return found && startsLikeStreet(found) ? { value: { value: found, source }, check: null } : no;
  }
  const parsed = cityLine(squash(at.text));
  if (parsed) {
    const said = parsed[field];
    if (field === 'city') {
      // A facility may sit before the city on its line: the city is then its last words.
      const lower = said.toLowerCase();
      const w = wanted.toLowerCase();
      if (lower !== w && !lower.endsWith(` ${w}`)) return no;
      return { value: { value: said.slice(said.length - wanted.length), source }, check: null };
    }
    return said.toLowerCase() === wanted.toLowerCase() ? { value: { value: said, source }, check: null } : no;
  }
  const found = tokenIn(at.text, wanted);
  if (!found) return no;
  if (field === 'state' && !(/^[A-Za-z]{2}$/.test(found) && found.toUpperCase() in ZONE_BY_STATE)) return no;
  if (field === 'zip' && !/^\d{5}$/.test(found)) return no;
  return { value: { value: field === 'state' ? found.toUpperCase() : found, source }, check: null };
}

function stopFrom(
  stop: ModelStop,
  sent: ReadonlyMap<number, PreparedLine>,
  now: Date,
  hours24: boolean,
): { read: StopRead; confirmed: number; unconfirmed: number } {
  const typeAt = locate(stop.type.quote, sent);
  const words = typeAt?.text ?? '';
  const saysPickup = PICKUP_WORDS.test(words) || /\bPU\b/.test(words);
  const saysDelivery = DELIVERY_WORDS.test(words) || /\bSO\b/.test(words);
  const typeOk = typeAt !== null && saysPickup !== saysDelivery && (stop.type.value === 'PU' ? saysPickup : saysDelivery);

  let confirmed = 0;
  let unconfirmed = 0;
  const fieldChecks: Partial<Record<AddressField, string>> = {};
  const fields = {} as Record<AddressField, Sourced<string> | null>;
  for (const field of ['street', 'city', 'state', 'zip'] as const) {
    const result = addressField(field, stop[field], sent);
    fields[field] = result.value;
    if (result.value) confirmed += 1;
    if (result.check) {
      unconfirmed += 1;
      fieldChecks[field] = result.check;
    }
  }
  const time = timeFrom(stop.appointment, sent, now, hours24);
  if (time.confirmed) confirmed += 1;
  else if (stop.appointment.kind === 'exact' || stop.appointment.kind === 'range') unconfirmed += 1;

  return {
    read: {
      type: {
        value: stop.type.value,
        source: { text: typeAt?.text ?? NOT_IN_TEXT_QUOTED, page: typeAt?.page ?? null },
      },
      typeCheck: typeOk
        ? null
        : `Read by AI as a ${stop.type.value === 'PU' ? 'pickup' : 'delivery'}, but the text it cited does not say which. Check it.`,
      ...fields,
      time: time.time,
      fieldChecks,
    },
    confirmed,
    unconfirmed,
  };
}

/** The model's reply, checked against the lines that were sent; or nothing, when nothing in it stands. */
export function verifyRead(reply: ModelRead, sent: readonly PreparedLine[], now: Date): Verified {
  const byLine = new Map(sent.map((l) => [l.n, l]));
  let confirmed = 0;
  let unconfirmed = 0;

  let loadNumber: Sourced<string> | null = null;
  let loadNumberCheck: string | null = 'The AI found no load number in the text.';
  if (reply.loadNumber) {
    const at = locate(reply.loadNumber.quote, byLine);
    const found = at ? tokenIn(at.text, reply.loadNumber.value) : null;
    if (at && found) {
      loadNumber = { value: found, source: { text: at.text, page: at.page } };
      loadNumberCheck = null;
      confirmed += 1;
    } else {
      loadNumberCheck = at ? doesNotFollow(at.text) : NOT_IN_TEXT;
      unconfirmed += 1;
    }
  }

  const hours24 = documentIs24Hour(sent);
  const stops = reply.stops.map((s) => {
    const out = stopFrom(s, byLine, now, hours24);
    confirmed += out.confirmed;
    unconfirmed += out.unconfirmed;
    return out.read;
  });

  if (confirmed === 0) return { ok: false, reason: 'nothing-confirmed' };
  return { ok: true, read: { layout: 'model', loadNumber, loadNumberCheck, stops }, confirmed, unconfirmed };
}
