import { ZONE_BY_STATE } from '../geo/zone-by-state';
import { startsLikeStreet } from '../paste-address';
import { documentIs24Hour } from './clock-24';
import type { Line } from './lines';
import { splitStreetCity } from './street-split';

/**
 * §12.122. The rate-confirmation layouts this fleet receives, each
 * recognised by its labels and read by them. Pure.
 *
 * A layout is used only when EVERY label it is recognised by is present, and
 * when exactly one layout is: anything else is "not recognised" and nothing
 * is filled. Never part of a load from a layout we do not know.
 *
 * A reader returns what the text SAYS, with the line it said it on. It does
 * not decide what an appointment becomes in the form — `ratecon-fill` does,
 * by rules that are the same for every layout.
 *
 * Never read: rate, broker, contacts, phones, emails, driver, trailer,
 * notes, instructions. No pattern below looks at them.
 */

/** The templates, and `model`: a language-model read, checked by `verify-read.ts` (docs/llm-reader-design.md). */
export type LayoutId =
  | 'label-rows'
  | 'stops-section'
  | 'pu-so-blocks'
  | 'pickup-delivery-columns'
  | 'route-blocks'
  | 'stop-table'
  | 'stop-detail'
  | 'model';

export const LAYOUT_NAME: Record<LayoutId, string> = {
  'label-rows': 'label rows (PICKUP DATE / SHIPPER / CONSIGNEE)',
  'stops-section': 'a Stops section (Stop 1 Pickup, Stop 2 Drop)',
  'pu-so-blocks': 'PU / SO blocks (Name, Address, Date)',
  'pickup-delivery-columns': 'Pickup # / Delivery # blocks (address and appointment columns)',
  'route-blocks': 'Route blocks (Pickup / Delivery, a date and “HH:MM Apt” beside each stop)',
  'stop-table': 'a stop table (Stop, From, To, Name, City, St; two lines a stop)',
  'stop-detail': 'a Stop Detail table (Type, Scheduled Arrival, Name and Address)',
  model: 'an AI read',
};

export interface Source {
  text: string;
  page: number | null;
}

export interface Sourced<T> {
  value: T;
  source: Source;
}

/** What the text says about one stop's time, before any rule is applied. */
export type TimeRead =
  | { kind: 'exact'; date: string; time: string; flag: Flag; source: Source }
  | { kind: 'range'; date: string; time: string; endDate: string; endTime: string; flag: Flag; source: Source }
  /** Written, but not as anything a rule can read: quoted, never guessed. */
  | { kind: 'unreadable'; date: string | null; quoted: string; source: Source }
  | { kind: 'none'; source: Source | null };

export type Flag = 'APPT' | 'FCFS' | null;

export interface StopRead {
  type: Sourced<'PU' | 'DEL'>;
  /** Said under the type when the layout's word for it is not certain. */
  typeCheck: string | null;
  street: Sourced<string> | null;
  city: Sourced<string> | null;
  state: Sourced<string> | null;
  zip: Sourced<string> | null;
  time: TimeRead;
  /** What to check about an address field: why it is blank (a model read, `verify-read.ts`), or, filled, that the app split it (Route blocks, 3ac). */
  fieldChecks?: Partial<Record<'street' | 'city' | 'state' | 'zip', string>>;
  /** Said under the appointment in place of the fill's own check. Only two-read agreement sets it (`agree-reads.ts`). */
  timeCheck?: string;
}

export interface RateconRead {
  layout: LayoutId;
  loadNumber: Sourced<string> | null;
  /** Why the load number was not filled, when it was not. */
  loadNumberCheck: string | null;
  stops: StopRead[];
}

export type ReadOutcome =
  | { ok: true; read: RateconRead }
  | { ok: false; reason: 'not-recognised' };

const US = new Set(Object.keys(ZONE_BY_STATE));
/** A two-letter US state code the zone table knows. */
export const isUsState = (code: string): boolean => US.has(code);
const src = (line: Line): Source => ({ text: line.text, page: line.page });
const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
const validClock = (h: number, m: number) => h >= 0 && h <= 23 && m >= 0 && m <= 59;
const validDate = (y: number, m: number, d: number) => {
  const at = new Date(Date.UTC(y, m - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d;
};

/** "ROCKFORD, IL 61109", "FARGO  ND  58102", "MN 56560" merged — city, state, ZIP. */
const CITY_LINE = /^(.+?)[,\s]+([A-Z]{2})[,\s]+(\d{5})(?:-\d{4})?\b/;

export function cityLine(text: string): { city: string; state: string; zip: string } | null {
  const match = CITY_LINE.exec(text.trim());
  if (!match || !US.has(match[2]!)) return null;
  return { city: match[1]!.replace(/[\s,]+$/, ''), state: match[2]!, zip: match[3]! };
}

function addressFrom(
  streetLine: Line | null,
  street: string | null,
  place: Line | null,
): Pick<StopRead, 'street' | 'city' | 'state' | 'zip'> {
  const parsed = place ? cityLine(place.text.replace(/^CITY, STATE\s+/, '')) : null;
  return {
    street: streetLine && street ? { value: street, source: src(streetLine) } : null,
    city: parsed && place ? { value: parsed.city, source: src(place) } : null,
    state: parsed && place ? { value: parsed.state, source: src(place) } : null,
    zip: parsed && place ? { value: parsed.zip, source: src(place) } : null,
  };
}

/* ------------------------------ label rows ------------------------------ */

const LABEL_ROWS = {
  recognise: [/^ORDER CONFIRMATION\b/, /\bOrder ID\b/, /^PICKUP DATE\b/, /^DELIVERY DATE\b/, /^CITY, STATE\b/],
  stop: /^(PICKUP|DELIVERY) DATE\s+(.*)$/,
};

/** "5:00PM", "10A", "0800" — and only those: a bare "8:00" could be either half of the day. */
function clock12(text: string, meridiem?: string): { h: number; m: number } | null {
  const twelve = /^(\d{1,2})(?::(\d{2}))?\s*([AP])\.?M?\.?$/i.exec(text.trim());
  if (twelve) {
    const h12 = Number(twelve[1]);
    const m = Number(twelve[2] ?? 0);
    if (h12 < 1 || h12 > 12) return null;
    const pm = twelve[3]!.toUpperCase() === 'P';
    return validClock(h12, m) ? { h: (h12 % 12) + (pm ? 12 : 0), m } : null;
  }
  const bare = /^(\d{1,2})(?::(\d{2}))?$/.exec(text.trim());
  if (bare && meridiem) return clock12(`${text.trim()}${meridiem}`);
  const four = /^(\d{2})(\d{2})$/.exec(text.trim());
  if (four && validClock(Number(four[1]), Number(four[2]))) return { h: Number(four[1]), m: Number(four[2]) };
  return null;
}

function labelRowsTime(rest: string, line: Line): TimeRead {
  const date = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(rest);
  const day = date && validDate(Number(date[3]), Number(date[1]), Number(date[2]))
    ? iso(Number(date[3]), Number(date[1]), Number(date[2]))
    : null;
  const written = /\bTIME:\s*(.*)$/i.exec(rest)?.[1]?.trim() ?? '';
  if (!day) return { kind: 'unreadable', date: null, quoted: rest, source: src(line) };
  if (written === '') return { kind: 'unreadable', date: day, quoted: rest, source: src(line) };
  const flagMatch = /\s*\b(APPT|FCFS)\.?$/i.exec(written);
  const flag = (flagMatch?.[1]?.toUpperCase() as Flag) ?? null;
  const body = flagMatch ? written.slice(0, flagMatch.index).trim() : written;
  const single = clock12(body);
  if (single) return { kind: 'exact', date: day, time: hhmm(single.h, single.m), flag, source: src(line) };
  const range = /^(.+?)\s*-\s*(.+)$/.exec(body);
  if (range) {
    const endMeridiem = /([AP])\.?M?\.?$/i.exec(range[2]!.trim())?.[1];
    const end = clock12(range[2]!);
    const start = clock12(range[1]!, endMeridiem);
    if (start && end) {
      return {
        kind: 'range',
        date: day,
        time: hhmm(start.h, start.m),
        endDate: day,
        endTime: hhmm(end.h, end.m),
        flag,
        source: src(line),
      };
    }
  }
  return { kind: 'unreadable', date: day, quoted: written, source: src(line) };
}

function readLabelRows(lines: Line[]): RateconRead {
  const idAt = lines.findIndex((l) => /\bOrder ID\b/.test(l.text));
  const idLine = lines.slice(idAt + 1, idAt + 3).find((l) => /^\d[\w-]*\b/.test(l.text));
  const loadNumber = idLine
    ? { value: /^(\d[\w-]*)/.exec(idLine.text)![1]!, source: src(idLine) }
    : null;

  const stops: StopRead[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const start = LABEL_ROWS.stop.exec(lines[i]!.text);
    if (!start) continue;
    let streetLine: Line | null = null;
    let street: string | null = null;
    let place: Line | null = null;
    for (let j = i + 1; j < lines.length && !LABEL_ROWS.stop.test(lines[j]!.text); j += 1) {
      const text = lines[j]!.text;
      const address = /^ADDRESS\s+(.+)$/.exec(text);
      if (address && !streetLine) {
        streetLine = lines[j]!;
        street = address[1]!.replace(/[\s,]+$/, '');
      }
      if (/^CITY, STATE\s+/.test(text) && !place) place = lines[j]!;
    }
    stops.push({
      type: { value: start[1] === 'PICKUP' ? 'PU' : 'DEL', source: src(lines[i]!) },
      typeCheck: null,
      ...addressFrom(streetLine, street, place),
      time: labelRowsTime(start[2]!, lines[i]!),
    });
  }
  return {
    layout: 'label-rows',
    loadNumber,
    loadNumberCheck: loadNumber ? null : 'No number under “Order ID”.',
    stops,
  };
}

/* ---------------------------- a Stops section ---------------------------- */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAY = '(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day';
const SECTION = {
  recognise: [/\bRate Confirmation\b/, /\bLOAD ID:\s*\S/, /^Stops$/, /^Stop \d+ (Pickup|Drop|Delivery)\b/i, /^Customer$/],
  stop: /^Stop (\d+) (Pickup|Drop|Delivery)\b/i,
  dated: new RegExp(
    `(?:${WEEKDAY},\\s*)?(${MONTHS.join('|')})\\s+(\\d{1,2}),\\s*(\\d{4})\\s+(\\d{1,2}):(\\d{2})`,
    'g',
  ),
};

/**
 * The date column of a stop block, apart from the address column. With
 * positions, by the "Date:" label's x; pasted, by the shapes a date takes.
 */
function splitColumns(line: Line, dateX: number | null): { left: string; right: string } {
  if (dateX !== null && line.cells.every((c) => c.x !== null)) {
    const left = line.cells.filter((c) => c.x! < dateX - 4).map((c) => c.text).join(' ');
    const right = line.cells.filter((c) => c.x! >= dateX - 4).map((c) => c.text).join(' ');
    return { left: left.trim(), right: right.replace(/^Date:\s*/, '').trim() };
  }
  const text = line.text;
  const labelled = /\s+Date:\s*/.exec(text);
  if (labelled) return { left: text.slice(0, labelled.index).trim(), right: text.slice(labelled.index + labelled[0].length).trim() };
  const tail = new RegExp(
    `\\s+((?:${WEEKDAY},?\\s*)?(?:(?:${MONTHS.join('|')})\\b.*|\\d{4}\\s+\\d{1,2}:\\d{2}.*|APPT|FCFS))$`,
  ).exec(text);
  return tail ? { left: text.slice(0, tail.index).trim(), right: tail[1]!.trim() } : { left: text.trim(), right: '' };
}

function readStopsSection(lines: Line[]): RateconRead {
  const idLine = lines.find((l) => /\bLOAD ID:\s*\S/.test(l.text))!;
  const loadNumber = { value: /\bLOAD ID:\s*(\S+)/.exec(idLine.text)![1]!, source: src(idLine) };

  const sectionAt = lines.map((l) => l.text).lastIndexOf('Stops');
  const stops: StopRead[] = [];
  for (let i = sectionAt + 1; i < lines.length; i += 1) {
    const start = SECTION.stop.exec(lines[i]!.text);
    if (!start) continue;
    // The block: from "Customer" to the city line in the address column.
    const block: Line[] = [];
    for (let j = i + 1; j < lines.length && !SECTION.stop.test(lines[j]!.text) && block.length < 6; j += 1) {
      if (lines[j]!.text === 'Customer') continue;
      block.push(lines[j]!);
      if (cityLine(splitColumns(lines[j]!, null).left) && /\b(APPT|FCFS)\b/.test(lines[j]!.text)) break;
    }
    const dateCell = block[0]?.cells.find((c) => c.text === 'Date:' || c.text.startsWith('Date:'));
    const dateX = dateCell?.x ?? null;
    const columns = block.map((l) => ({ line: l, ...splitColumns(l, dateX) }));
    const placeAt = columns.findIndex((c) => cityLine(c.left) !== null);
    const streets = placeAt > 1 ? columns.slice(1, placeAt) : [];
    const place = placeAt === -1 ? null : columns[placeAt]!;
    const parsed = place ? cityLine(place.left) : null;
    const right = columns.slice(0, placeAt === -1 ? columns.length : placeAt + 1).map((c) => c.right).join(' ').replace(/\s+/g, ' ').trim();
    const timeSource: Source = {
      text: right,
      page: block[0]?.page ?? null,
    };

    stops.push({
      type: {
        value: /pickup/i.test(start[2]!) ? 'PU' : 'DEL',
        source: src(lines[i]!),
      },
      typeCheck: null,
      street: streets.length > 0
        ? { value: streets.map((s) => s.left).join(' ').replace(/[\s,]+$/, ''), source: src(streets[0]!.line) }
        : null,
      city: parsed && place ? { value: parsed.city, source: src(place.line) } : null,
      state: parsed && place ? { value: parsed.state, source: src(place.line) } : null,
      zip: parsed && place ? { value: parsed.zip, source: src(place.line) } : null,
      time: sectionTime(right, timeSource),
    });
  }
  return { layout: 'stops-section', loadNumber, loadNumberCheck: null, stops };
}

function sectionTime(right: string, source: Source): TimeRead {
  if (right === '') return { kind: 'none', source: null };
  const flag = (/\b(APPT|FCFS)\b/.exec(right)?.[1] as Flag) ?? null;
  const found = [...right.matchAll(SECTION.dated)].map((m) => ({
    y: Number(m[3]),
    mo: MONTHS.indexOf(m[1]!) + 1,
    d: Number(m[2]),
    h: Number(m[4]),
    mi: Number(m[5]),
  }));
  const ok = found.every((f) => validDate(f.y, f.mo, f.d) && validClock(f.h, f.mi));
  const at = (f: (typeof found)[number]) => ({ date: iso(f.y, f.mo, f.d), time: hhmm(f.h, f.mi) });
  if (ok && found.length === 1) return { kind: 'exact', ...at(found[0]!), flag, source };
  if (ok && found.length === 2) {
    const end = at(found[1]!);
    return { kind: 'range', ...at(found[0]!), endDate: end.date, endTime: end.time, flag, source };
  }
  return { kind: 'unreadable', date: found[0] && ok ? at(found[0]).date : null, quoted: right, source };
}

/* ------------------------------ PU / SO blocks ------------------------------ */

/** Said under an SO (stop-off) read as a delivery when it is not the last stop. */
export const STOP_OFF_CHECK = 'An SO (stop-off) before the last stop is read as a delivery. It can be a pickup.';

const BLOCKS = {
  recognise: [/^(PU|SO)\b(?:\s+\d+)?\s+Name:/, /^Address:/, /\bDriver Load:/, /\b(?:Order|Load Number):\s*\S/],
  stop: /^(PU|SO)\b(?:\s+(\d+))?\s+Name:\s*(.*?)(?:\s+Date:\s*(.*))?$/,
  address: /^Address:\s*(.*?)(?:\s+(\d{2}\/\d{2}\/\d{4}\s+\d{4}))?$/,
  stamp: /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2})(\d{2})$/,
};

function blockStamp(text: string | undefined): { date: string; time: string } | null {
  const match = text ? BLOCKS.stamp.exec(text.trim()) : null;
  if (!match) return null;
  const [y, m, d, h, mi] = [match[3], match[1], match[2], match[4], match[5]].map(Number) as [number, number, number, number, number];
  return validDate(y, m, d) && validClock(h, mi) ? { date: iso(y, m, d), time: hhmm(h, mi) } : null;
}

function readBlocks(lines: Line[]): RateconRead {
  const numbers = (pattern: RegExp) =>
    lines.flatMap((l) => {
      const match = pattern.exec(l.text);
      return match ? [{ value: match[1]!, source: src(l) }] : [];
    });
  const loadNumbers = numbers(/\bLoad Number:\s*(\S+)/);
  const orders = numbers(/\bOrder:\s*(\S+)/);
  const candidates = [...loadNumbers, ...orders];
  const distinct = new Set(candidates.map((c) => c.value));
  const loadNumber = distinct.size === 1 ? candidates[0]! : null;

  const stops: StopRead[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const start = BLOCKS.stop.exec(lines[i]!.text);
    if (!start) continue;
    const addressLine = lines[i + 1] && BLOCKS.address.exec(lines[i + 1]!.text) ? lines[i + 1]! : null;
    const address = addressLine ? BLOCKS.address.exec(addressLine.text)! : null;
    // The city line is within the next three: a facility code may sit between.
    const place = lines.slice(i + 2, i + 5).find((l) => cityLine(l.text) !== null && !BLOCKS.stop.test(l.text)) ?? null;
    const from = blockStamp(start[4]);
    const to = blockStamp(address?.[2]);
    const timeSource: Source = {
      text: [start[4], address?.[2]].filter(Boolean).join(' – '),
      page: lines[i]!.page,
    };
    const time: TimeRead =
      from && to && from.date === to.date && from.time === to.time
        ? { kind: 'exact', ...from, flag: null, source: timeSource }
        : from && to
          ? { kind: 'range', ...from, endDate: to.date, endTime: to.time, flag: null, source: timeSource }
          : from && !address?.[2]
            ? { kind: 'exact', ...from, flag: null, source: timeSource }
            : start[4] || address?.[2]
              ? { kind: 'unreadable', date: from?.date ?? null, quoted: timeSource.text, source: timeSource }
              : { kind: 'none', source: null };
    stops.push({
      type: { value: start[1] === 'PU' ? 'PU' : 'DEL', source: src(lines[i]!) },
      typeCheck: null,
      ...addressFrom(addressLine, address?.[1]?.replace(/[\s,]+$/, '') || null, place),
      time,
    });
  }
  // "SO" is a stop-off: the last one is the delivery; one before it could be
  // a pickup too, and is said so rather than assumed.
  stops.forEach((stop, i) => {
    if (/^SO\b/.test(stop.type.source.text) && i < stops.length - 1) {
      stop.typeCheck = STOP_OFF_CHECK;
    }
  });
  return {
    layout: 'pu-so-blocks',
    loadNumber,
    loadNumberCheck:
      loadNumber ? null : distinct.size > 1 ? `More than one number is labelled as the load or order: ${[...distinct].map((n) => `“${n}”`).join(', ')}.` : 'No load or order number.',
    stops,
  };
}

/* ------------------- Pickup # / Delivery # columns (§12.125) ------------------- */

/**
 * Each stop is a "Pickup #1" or "Delivery #1" heading, then a label row
 * ("Pickup Address", "Appointment", …) that sets the columns. Under it the
 * address column holds the facility, the street and the city line, in that
 * order, and the appointment column holds one date and time, or "Earliest"
 * and "Latest" each with a date and a time, then "Appt. Type" and its value.
 * Times are 24-hour, followed by a zone word the stop's address overrules.
 *
 * Read by COLUMN, so it needs a PDF's positions: pasted text, whose columns
 * cannot be told apart, is not read. The load number is the one beside
 * "Arrive Order" — not "Load", not "Shipment ID".
 *
 * Strict, because a wrong stop is worse than none: every city line in the
 * document must be a stop's, the page header's (the same lines on every
 * page), or the one billing address after the last stop. Anything else —
 * an address column with two city lines or none, an unlabelled address
 * between the stops, a heading without its label row — and nothing is read.
 */
const COLUMNS = {
  recognise: [/^Shipment ID\b/, /^Total Miles\b/, /^Line ?Haul\b/i, /^Pickup #\d+$/, /^Delivery #\d+$/],
  heading: /^(Pickup|Delivery) #\d+$/,
  addressLabel: /^(Pickup|Delivery) Address$/,
  end: /^(Driver Instructions:|Pickup Notes:|Delivery Notes:)/,
  date: /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})$/,
  clock: /^(\d{2}):(\d{2})(?:\s+[A-Z]{2,4})?$/,
  /** The page header: lines found among the first few of every page. */
  headerDepth: 4,
};

const MONTH_ABBR = MONTHS.map((m) => m.slice(0, 3).toLowerCase());

function columnsWhen(date: string, clock: string): { date: string; time: string } | null {
  const d = COLUMNS.date.exec(date.trim());
  const c = COLUMNS.clock.exec(clock.trim());
  if (!d || !c) return null;
  const [y, mo, day, h, mi] = [Number(d[3]), MONTH_ABBR.indexOf(d[1]!.toLowerCase()) + 1, Number(d[2]), Number(c[1]), Number(c[2])];
  return mo > 0 && validDate(y, mo, day) && validClock(h, mi) ? { date: iso(y, mo, day), time: hhmm(h, mi) } : null;
}

function columnsTime(entries: string[], flagText: string | null, source: Source): TimeRead {
  if (entries.length === 0) return { kind: 'none', source: null };
  const flag: Flag = flagText === null ? null : /^By Appointment$/i.test(flagText) ? 'APPT' : /^FCFS$/i.test(flagText) ? 'FCFS' : null;
  if (entries.length === 2) {
    const at = columnsWhen(entries[0]!, entries[1]!);
    if (at) return { kind: 'exact', ...at, flag, source };
  }
  if (entries.length === 6 && /^Earliest\b/i.test(entries[0]!) && /^Latest\b/i.test(entries[3]!)) {
    const from = columnsWhen(entries[1]!, entries[2]!);
    const to = columnsWhen(entries[4]!, entries[5]!);
    if (from && to) return { kind: 'range', ...from, endDate: to.date, endTime: to.time, flag, source };
  }
  const firstDate = entries.map((e) => COLUMNS.date.exec(e.trim())).find(Boolean);
  const date = firstDate ? columnsWhen(firstDate[0], '00:00')?.date ?? null : null;
  return { kind: 'unreadable', date, quoted: entries.join(' '), source };
}

function readColumns(lines: Line[]): RateconRead {
  const refuse: RateconRead = { layout: 'pickup-delivery-columns', loadNumber: null, loadNumberCheck: null, stops: [] };
  if (lines.some((l) => l.page === null || l.cells.some((c) => c.x === null))) return refuse;

  const headings = lines.flatMap((l, i) => (COLUMNS.heading.test(l.text) ? [i] : []));
  const kinds = headings.map((i) => (/^Pickup/.test(lines[i]!.text) ? 'PU' : 'DEL'));
  if (!kinds.includes('PU') || !kinds.includes('DEL')) return refuse;

  const stopCities = new Set<Line['cells'][number]>();
  const stops: StopRead[] = [];
  let lastEnd = -1;
  for (const [n, h] of headings.entries()) {
    const heading = lines[h]!;
    const word = /^(Pickup|Delivery)/.exec(heading.text)![1]!;
    const labels = lines[h + 1];
    const addressLabel = labels?.cells[0] && COLUMNS.addressLabel.exec(labels.cells[0].text);
    const appointment = labels?.cells.find((c) => c.text === 'Appointment');
    if (!labels || !addressLabel || addressLabel[1] !== word || !appointment) return refuse;
    const apptX = appointment.x!;
    const nextX = Math.min(...labels.cells.filter((c) => c.x! > apptX).map((c) => c.x!), Infinity);

    let end = h + 2;
    const stopAt = headings[n + 1] ?? lines.length;
    while (end < stopAt && !COLUMNS.end.test(lines[end]!.cells[0]?.text ?? '')) end += 1;
    lastEnd = end;

    const address: { cell: Line['cells'][number]; page: number | null }[] = [];
    const column: string[] = [];
    for (let j = h + 2; j < end; j += 1) {
      const cells = lines[j]!.cells;
      for (const cell of cells.filter((c) => c.x! < apptX - 4)) address.push({ cell, page: lines[j]!.page });
      for (const cell of cells.filter((c) => c.x! >= apptX - 4 && c.x! < nextX - 4)) column.push(cell.text);
    }
    // The appointment's own lines end at the first "… Type" label; "Appt. Type" says APPT or FCFS.
    const typeAt = column.findIndex((t) => /\bType$/.test(t));
    const appt = typeAt === -1 ? column : column.slice(0, typeAt);
    const flagAt = column.indexOf('Appt. Type');
    const flagText = flagAt === -1 ? null : (column[flagAt + 1] ?? null);

    const cityAt = address.flatMap((a, i) => (cityLine(a.cell.text) ? [i] : []));
    // One city line, and it closes the address column.
    if (cityAt.length !== 1 || cityAt[0] !== address.length - 1) return refuse;
    const place = address[cityAt[0]!]!;
    stopCities.add(place.cell);
    const parsed = cityLine(place.cell.text)!;
    const streetAt = address[cityAt[0]! - 1];
    const timeSource: Source = {
      text: [...appt, ...(flagText ? [flagText] : [])].join(' · '),
      page: heading.page,
    };
    stops.push({
      type: { value: kinds[n]!, source: src(heading) },
      typeCheck: null,
      street: streetAt ? { value: streetAt.cell.text.replace(/[\s,]+$/, ''), source: { text: streetAt.cell.text, page: streetAt.page } } : null,
      city: { value: parsed.city, source: { text: place.cell.text, page: place.page } },
      state: { value: parsed.state, source: { text: place.cell.text, page: place.page } },
      zip: { value: parsed.zip, source: { text: place.cell.text, page: place.page } },
      time: columnsTime(appt, flagText, timeSource),
    });
  }

  // Every other city line is the page header's or the billing address's.
  const pages = [...new Set(lines.map((l) => l.page!))];
  const firstOf = (page: number) => lines.filter((l) => l.page === page).slice(0, COLUMNS.headerDepth).map((l) => l.text);
  const header = new Set(pages.length > 1 ? firstOf(pages[0]!).filter((t) => pages.every((p) => firstOf(p).includes(t))) : []);
  const others = lines.flatMap((l, i) =>
    header.has(l.text) ? [] : l.cells.filter((c) => cityLine(c.text) && !stopCities.has(c)).map(() => i),
  );
  if (others.length > 1) return refuse;
  if (others.length === 1) {
    const at = others[0]!;
    const near = lines.slice(Math.max(0, at - 3), at + 1);
    if (at <= lastEnd || near.some((l) => l.cells.some((c) => c.text === 'Appointment'))) return refuse;
  }

  const numbers = lines.flatMap((l) =>
    l.cells[0]?.text === 'Arrive Order' && l.cells[1] && /^[A-Za-z0-9-]+$/.test(l.cells[1].text)
      ? [{ value: l.cells[1].text, source: { text: `Arrive Order  ${l.cells[1].text}`, page: l.page } }]
      : [],
  );
  const distinct = new Set(numbers.map((x) => x.value));
  const loadNumber = distinct.size === 1 ? numbers[0]! : null;
  return {
    layout: 'pickup-delivery-columns',
    loadNumber,
    loadNumberCheck: loadNumber
      ? null
      : distinct.size > 1
        ? `More than one number is beside “Arrive Order”: ${[...distinct].map((x) => `“${x}”`).join(', ')}.`
        : 'No number beside “Arrive Order”.',
    stops,
  };
}

/* ------------------------- Route blocks (3aa, 3ac) ------------------------- */

/**
 * A page header on every page ("Page N", "Shipment ID", "Rate Confirmation",
 * then a date and the shipment ID), and the stops in three columns, opened by
 * "Route" in the left one. Each stop is four lines: its type ("Pickup" or
 * "Delivery") and the facility; the date and the address; the time and
 * "Pickup #" or "Delivery #" with a number; one more line of the facility's.
 * Below the stops, one summary line names the first and the last facility
 * with their city and state: "A (City, ST) > B (City, ST)".
 *
 * The address is ONE run: street and city with nothing between them, then
 * ", ST 12345". Where the street ends is written down only for the stops the
 * summary line names (the first and the last), and their address must end in
 * exactly that city and state: those are read as confirmed, unmarked. A stop
 * the summary does not name (a middle stop) is split by the app's own grammar
 * (`splitStreetCity`, 3ac, Alex 2026-10-15: this lane runs with three stops),
 * only when exactly one division fits, and its street and city then carry
 * `SPLIT_CHECK` for the dispatcher to confirm. No fitting division, or more
 * than one: nothing is read, and the document goes to the AI reader.
 *
 * Only "HH:MM Apt" is a time: an appointment at that time. The hour is
 * 24-hour when it is past 12 or has a leading zero, or when the whole
 * document is on a 24-hour clock by the app's rule (`documentIs24Hour`, 3x);
 * a template sends nothing, so the rule runs over all of it. Anything else
 * beside a stop is quoted as unreadable.
 *
 * The load number is the ID under "Shipment ID" in the page header, not a
 * "Pickup #" or "Delivery #" number.
 *
 * Read by column, so it needs a PDF's positions: pasted text is not read.
 * Strict, because a wrong stop is worse than none: a block of any other
 * shape, a line among the stops that is not a stop's, a city line anywhere but
 * a stop's address, a middle stop whose street and city do not divide one
 * way only, a summary line that does not name the first and the last
 * facility, an address that does not end in the summary's city and state —
 * and nothing is read.
 */
const ROUTE = {
  recognise: [/^Page \d+\s+Shipment ID$/, /^Rate Confirmation$/, /^Route\s+Pickup\s+\S/, /(?:^|\s)Pickup # \d/, /(?:^|\s)Delivery # \d/],
  type: /^(Pickup|Delivery)$/,
  date: /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{4})$/,
  time: /^(\d{2}):(\d{2}) Apt$/,
  address: /^(.+), ([A-Z]{2}) (\d{5})(?:-\d{4})?$/,
  summary: /^(.+) \(([^()]+), ([A-Z]{2})\) > (.+) \(([^()]+), ([A-Z]{2})\)$/,
  id: /^[A-Za-z0-9][A-Za-z0-9-]*$/,
};

/**
 * Said under the street and the city of a stop the app split itself (3ac). The field shows it after
 * "Check: ", as every check; edited, the field's check goes.
 */
export const SPLIT_CHECK = (text: string) => `the street and city were split by the app from “${text}”. Confirm them against the PDF.`;

function routeTime(dateText: string, timeText: string, hours24: boolean, source: Source): TimeRead {
  if (dateText === '' && timeText === '') return { kind: 'none', source: null };
  const d = ROUTE.date.exec(dateText);
  const [y, mo, day] = d ? [Number(d[3]), MONTH_ABBR.indexOf(d[1]!.toLowerCase()) + 1, Number(d[2])] : [0, 0, 0];
  const date = d && validDate(y, mo, day) ? iso(y, mo, day) : null;
  const t = ROUTE.time.exec(timeText);
  const [h, mi] = t ? [Number(t[1]), Number(t[2])] : [-1, -1];
  // "10:00" alone could be either half of the day: it is a time only on a 24-hour document.
  const clear = t !== null && validClock(h, mi) && (h >= 13 || t[1]!.startsWith('0') || hours24);
  if (date && clear) return { kind: 'exact', date, time: hhmm(h, mi), flag: 'APPT', source };
  return { kind: 'unreadable', date, quoted: [dateText, timeText].filter(Boolean).join(' '), source };
}

function readRouteBlocks(lines: Line[]): RateconRead {
  const refuse: RateconRead = { layout: 'route-blocks', loadNumber: null, loadNumberCheck: null, stops: [] };
  if (lines.some((l) => l.page === null || l.cells.some((c) => c.x === null))) return refuse;

  const routeAt = lines.flatMap((l, i) => (l.cells[0]?.text === 'Route' ? [i] : []));
  if (routeAt.length !== 1 || lines[routeAt[0]!]!.cells.length !== 3) return refuse;
  const [label, , facility] = lines[routeAt[0]!]!.cells;
  // The columns, by the "Route" line: labels, then type, date and time, then facility, address and number.
  const leftX = label!.x!;
  const rightX = facility!.x!;
  const columns = (line: Line) => {
    const at = (c: Line['cells'][number]) =>
      c.x! <= leftX + 4 ? 'left' : Math.abs(c.x! - rightX) <= 4 ? 'right' : c.x! < rightX ? 'middle' : 'beyond';
    const of = (where: string) => line.cells.filter((c) => at(c) === where);
    return { left: of('left'), middle: of('middle'), right: of('right'), beyond: of('beyond') };
  };

  type Block = { kind: 'Pickup' | 'Delivery'; head: Line; name: string; date: string; address: Line['cells'][number]; time: string };
  const blocks: Block[] = [];
  let at = routeAt[0]!;
  for (;;) {
    const four = lines.slice(at, at + 4);
    if (four.length < 4 || four.some((l) => l.page !== four[0]!.page)) return refuse;
    const [head, dated, timed, last] = four.map(columns) as [ReturnType<typeof columns>, ReturnType<typeof columns>, ReturnType<typeof columns>, ReturnType<typeof columns>];
    if ([head, dated, timed, last].some((c) => c.beyond.length > 0)) return refuse;
    // The type and the facility; "Route" before the first, nothing before the others.
    const kind = head.middle.length === 1 ? ROUTE.type.exec(head.middle[0]!.text)?.[1] : undefined;
    if (!kind || head.left.length !== (blocks.length === 0 ? 1 : 0) || head.right.length !== 1) return refuse;
    // The date and the address.
    if (dated.left.length > 0 || dated.middle.length > 1 || dated.right.length !== 1) return refuse;
    // The time, and the stop's own number, which must say the same type.
    if (timed.left.length > 0 || timed.right.length !== 1 || !timed.right[0]!.text.startsWith(`${kind} # `)) return refuse;
    // One more line of the facility's, and nothing else.
    if (last.left.length > 0 || last.middle.length > 0 || last.right.length !== 1 || cityLine(last.right[0]!.text)) return refuse;
    blocks.push({
      kind: kind as Block['kind'],
      head: four[0]!,
      name: head.right[0]!.text,
      date: dated.middle[0]?.text ?? '',
      address: dated.right[0]!,
      time: timed.middle.map((c) => c.text).join(' '),
    });
    at += 4;
    // The stops end where the left column starts again; anything else must be the next stop.
    const next = lines[at];
    if (!next || columns(next).left.length > 0) break;
  }
  if (blocks[0]!.kind !== 'Pickup' || !blocks.some((b) => b.kind === 'Delivery')) return refuse;

  // Every city line in the document is a stop's address.
  const addresses = new Set(blocks.map((b) => b.address));
  if (lines.some((l) => l.cells.some((c) => cityLine(c.text) && !addresses.has(c)))) return refuse;

  // The summary names the first and the last facility, with their city and state.
  const summaries = lines.filter((l) => l.cells.length === 1 && l.text.split(' > ').length === 2 && ROUTE.summary.test(l.text));
  if (summaries.length !== 1) return refuse;
  const s = ROUTE.summary.exec(summaries[0]!.text)!;
  const ends = new Map([
    [0, { name: s[1]!, city: s[2]!, state: s[3]! }],
    [blocks.length - 1, { name: s[4]!, city: s[5]!, state: s[6]! }],
  ]);

  const hours24 = documentIs24Hour(lines.map((l, n) => ({ n, text: l.text, page: l.page })));
  const stops: StopRead[] = [];
  for (const [n, b] of blocks.entries()) {
    const a = ROUTE.address.exec(b.address.text);
    if (!a || !US.has(a[2]!) || !startsLikeStreet(a[1]!)) return refuse;
    // A stop the summary names: that city and state end its address. Any other: the app's split, marked.
    const end = ends.get(n);
    let street: string;
    let city: string;
    if (end) {
      if (end.name !== b.name || end.state !== a[2] || !a[1]!.endsWith(` ${end.city}`)) return refuse;
      street = a[1]!.slice(0, -(end.city.length + 1)).trim();
      city = end.city;
      if (!startsLikeStreet(street)) return refuse;
    } else {
      const split = splitStreetCity(a[1]!);
      if (!split) return refuse;
      ({ street, city } = split);
    }
    const place: Source = { text: b.address.text, page: b.head.page };
    stops.push({
      type: { value: b.kind === 'Pickup' ? 'PU' : 'DEL', source: src(b.head) },
      typeCheck: null,
      street: { value: street, source: place },
      city: { value: city, source: place },
      state: { value: a[2]!, source: place },
      zip: { value: a[3]!, source: place },
      ...(end ? {} : { fieldChecks: { street: SPLIT_CHECK(a[1]!), city: SPLIT_CHECK(a[1]!) } }),
      time: routeTime(b.date, b.time, hours24, { text: [b.date, b.time].filter(Boolean).join(' · '), page: b.head.page }),
    });
  }

  // The page header: "Page N  Shipment ID", "Rate Confirmation", then a date and the ID.
  const ids = lines.flatMap((l, k) => {
    const row = lines[k + 2];
    return l.cells.length === 2 && /^Page \d+$/.test(l.cells[0]!.text) && l.cells[1]!.text === 'Shipment ID' &&
      lines[k + 1]?.text === 'Rate Confirmation' && row?.page === l.page && row.cells.length === 2 && ROUTE.id.test(row.cells[1]!.text)
      ? [{ value: row.cells[1]!.text, source: { text: `Shipment ID  ${row.cells[1]!.text}`, page: row.page } }]
      : [];
  });
  const distinct = new Set(ids.map((x) => x.value));
  const loadNumber = distinct.size === 1 ? ids[0]! : null;
  return {
    layout: 'route-blocks',
    loadNumber,
    loadNumberCheck: loadNumber
      ? null
      : distinct.size > 1
        ? `More than one number is under “Shipment ID”: ${[...distinct].map((x) => `“${x}”`).join(', ')}.`
        : 'No number under “Shipment ID”.',
    stops,
  };
}

/* ------------------------------ Stop table (3ak) ------------------------------ */

/**
 * A "LOAD NUMBER" box at the top right of page 1, the number under it and
 * the document's date under that; and the stops in ONE table under a
 * two-line header:
 *
 *     Stop  From  To  Name     City   St   Ref      Appt
 *                     Address  Phone  Zip  Contact  Appt Ref
 *
 * Each stop is two lines, and a "Notes" line may follow it:
 *
 *     A: <n> <PU|Del> <from date> <to date> <name> <city> <state> <ref> <Yes|No>
 *     B: <from time> <to time> <street> <phone> <ZIP> <contact> <appt ref>
 *
 * The table ends at "Commodity". Later pages repeat the number as
 * "Load No <n> - <date>"; when one disagrees with the box, the load number
 * is blank with a check, as in the other templates. Arrives as a scan (OCR,
 * §12.128) or as a text PDF: the same lines either way.
 *
 * Line A is read by COLUMN: the city and the state are the cells that start
 * under the "City" and "St" headings, the name the cells under "Name". Before
 * them, the stop's number, its type and its two dates are read by their
 * shapes, so a date that OCR runs together with the name ("10/12 PRAIRIE
 * FOODS") is still read. A name and a city in one cell are never divided:
 * there is then no cell under "City", and nothing is read.
 *
 * Line B is read in order: the times, then the street up to the phone, then
 * the ZIP, the five digits after the phone. The phone only marks where the
 * street ends; it is never read or quoted. It may be one token or two
 * ("(555) 010-0100", "555-010-0100", OCR's "(555)010-0100"), or three digit
 * groups separated by spaces, "555 010 0100" (3ay, Alex).
 *
 * Dates are M/D with no year: the year is the one that puts the date nearest
 * the document's own date (the box's, else a "Load No" line's); with neither,
 * the time is quoted as unreadable. A stop runs from its From date and time
 * to its To date and time, and the fill's window rules decide what that is
 * (`appointmentFrom`). The Appt column (Yes/No) is NOT read. Times are read as
 * Route blocks reads them: 24-hour when past 12, with a leading zero, or on a
 * 24-hour document (`documentIs24Hour`).
 *
 * Read by column, so it needs a PDF's positions: pasted text is not read.
 * Strict, because a wrong stop is worse than none: a heading not in its own
 * cell; any line in the table that is not a stop's two lines or a note; a
 * line A with no cell under "City" or "St", or a state that is not one; a
 * line B with no phone, no five-digit ZIP after it, or a street that does
 * not start like one; stops not numbered 1, 2, 3…; a first stop that is not a
 * pickup, or a last stop of several that is not a delivery; a table with no
 * "Commodity" after it on its page — and nothing is read. Every stop must be
 * read, or none is, and the document goes to the AI reader as before.
 */
const TABLE = {
  recognise: [/^Stop\s+From\s+To\s+Name\s+City\s+St\s+Ref\s+Appt$/, /^Address\s+Phone\s+Zip\s+Contact\s+Appt\s+Ref$/],
  /** The headings whose cells set the columns line A is read by. */
  headings: ['Name', 'City', 'St', 'Ref', 'Appt'] as const,
  number: /^\d{1,2}$/,
  type: /^(PU|Del)$/,
  date: /^(\d{1,2})\/(\d{1,2})$/,
  clock: /^(\d{1,2}):(\d{2})$/,
  phone: /^\(?\d{3}\)?[-.\s]?\d{3}[-.]\d{4}$/,
  /** The phone as three digit groups separated by spaces: three tokens. */
  spacedPhone: /^\d{3} \d{3} \d{4}$/,
  zip: /^(\d{5})(?:-\d{4})?$/,
  boxDate: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
  later: /^Load No\s+(\S+)\s+-\s+(\d{1,2})\/(\d{1,2})\/(\d{2})$/,
  id: /^[A-Za-z0-9][A-Za-z0-9-]*$/,
  notes: /^Notes\b/,
  end: /^Commodity\b/,
  /** A cell starts under its heading when its x is this close to the heading's. */
  slack: 4,
};

type DocDate = { y: number; m: number; d: number };

/** M/D with no year, in the year that puts it nearest the document's date. */
function nearestYear(m: number, d: number, doc: DocDate): string | null {
  const at = Date.UTC(doc.y, doc.m - 1, doc.d);
  const gap = (y: number) => Math.abs(Date.UTC(y, m - 1, d) - at);
  const years = [doc.y - 1, doc.y, doc.y + 1].filter((y) => validDate(y, m, d));
  if (years.length === 0) return null;
  const y = years.reduce((a, b) => (gap(b) < gap(a) ? b : a));
  return iso(y, m, d);
}

function tableTime(dates: [string, string], times: string[], doc: DocDate | null, hours24: boolean, source: Source): TimeRead {
  const day = (text: string) => {
    const m = TABLE.date.exec(text);
    return m && doc ? nearestYear(Number(m[1]), Number(m[2]), doc) : null;
  };
  const clock = (text: string) => {
    const t = TABLE.clock.exec(text);
    const [h, mi] = t ? [Number(t[1]), Number(t[2])] : [-1, -1];
    // "10:00" alone could be either half of the day: it is a time only on a 24-hour document.
    return t && validClock(h, mi) && (h >= 13 || t[1]!.startsWith('0') || hours24) ? hhmm(h, mi) : null;
  };
  const [date, endDate] = dates.map(day) as [string | null, string | null];
  const [time, endTime] = times.length === 2 ? (times.map(clock) as [string | null, string | null]) : [null, null];
  if (date && endDate && time && endTime) {
    return date === endDate && time === endTime
      ? { kind: 'exact', date, time, flag: null, source }
      : { kind: 'range', date, time, endDate, endTime, flag: null, source };
  }
  return { kind: 'unreadable', date, quoted: [...dates, ...times].join(' '), source };
}

/** The number under "LOAD NUMBER", the document's date under it, and the "Load No" lines of later pages. */
function tableNumbers(lines: Line[]) {
  const labels = lines.flatMap((l, i) => l.cells.filter((c) => c.text === 'LOAD NUMBER').map((c) => ({ i, x: c.x!, page: l.page })));
  const under = (label: (typeof labels)[number], pattern: RegExp) =>
    lines
      .slice(label.i + 1, label.i + 5)
      .filter((l) => l.page === label.page)
      .flatMap((l) => l.cells.filter((c) => c.x! >= label.x - 12 && pattern.test(c.text)).map((c) => ({ text: c.text, page: l.page })))[0] ?? null;
  const boxed = labels.flatMap((label) => {
    const number = under(label, TABLE.id);
    return number ? [{ value: number.text, source: { text: `LOAD NUMBER  ${number.text}`, page: number.page } }] : [];
  });
  const later = lines.flatMap((l) => {
    const m = TABLE.later.exec(l.text);
    return m ? [{ value: m[1]!, date: { y: 2000 + Number(m[4]), m: Number(m[2]), d: Number(m[3]) } }] : [];
  });
  const boxDate = labels.map((label) => under(label, TABLE.boxDate)).find(Boolean);
  const b = boxDate ? TABLE.boxDate.exec(boxDate.text)! : null;
  const date: DocDate | null = b ? { y: Number(b[3]), m: Number(b[1]), d: Number(b[2]) } : (later[0]?.date ?? null);

  const distinct = new Set([...boxed, ...later].map((x) => x.value));
  const loadNumber = boxed.length > 0 && distinct.size === 1 ? boxed[0]! : null;
  const loadNumberCheck = loadNumber
    ? null
    : boxed.length === 0
      ? 'No number under “LOAD NUMBER”.'
      : `More than one number is under “LOAD NUMBER” or after “Load No”: ${[...distinct].map((x) => `“${x}”`).join(', ')}.`;
  return { loadNumber, loadNumberCheck, date };
}

function readStopTable(lines: Line[]): RateconRead {
  const refuse: RateconRead = { layout: 'stop-table', loadNumber: null, loadNumberCheck: null, stops: [] };
  if (lines.some((l) => l.page === null || l.cells.some((c) => c.x === null))) return refuse;

  const heads = lines.flatMap((l, i) => (TABLE.recognise[0]!.test(l.text) ? [i] : []));
  if (heads.length !== 1) return refuse;
  const header = lines[heads[0]!]!;
  const second = lines[heads[0]! + 1];
  if (!second || second.page !== header.page || !TABLE.recognise[1]!.test(second.text)) return refuse;
  // Each heading line A is read by is its own cell (the header's pattern has them in order).
  const xs = TABLE.headings.map((name) => header.cells.find((c) => c.text === name)?.x ?? null);
  if (xs.some((x) => x === null)) return refuse;
  const [nameX, cityX, stX, refX, apptX] = xs as [number, number, number, number, number];
  const column = (cell: Line['cells'][number]) => {
    const x = cell.x! + TABLE.slack;
    return x < nameX ? 'lead' : x < cityX ? 'name' : x < stX ? 'city' : x < refX ? 'st' : x < apptX ? 'ref' : 'appt';
  };
  const under = (cell: Line['cells'][number], x: number) => Math.abs(cell.x! - x) <= TABLE.slack;
  const words = (cells: Line['cells']) => cells.flatMap((c) => c.text.split(' ').filter((w) => w !== ''));

  /** Line A: the number, type and dates by shape; the city and state by column. */
  const lineA = (line: Line) => {
    const [n, type, from, to, ...spill] = words(line.cells.filter((c) => column(c) === 'lead'));
    if (!n || !TABLE.number.test(n) || !type || !TABLE.type.test(type) || !from || !TABLE.date.test(from) || !to || !TABLE.date.test(to)) return null;
    const of = (where: string) => line.cells.filter((c) => column(c) === where);
    const [names, cities, states] = [of('name'), of('city'), of('st')];
    // The name: words after the To date, run into its cell, or a cell under "Name".
    if (spill.length === 0 && !(names[0] && under(names[0], nameX))) return null;
    if (cities.length !== 1 || !under(cities[0]!, cityX) || /\d/.test(cities[0]!.text)) return null;
    if (states.length !== 1 || !under(states[0]!, stX)) return null;
    const state = states[0]!.text.split(' ')[0]!;
    if (!US.has(state)) return null;
    return { n: Number(n), type: type as 'PU' | 'Del', dates: [from, to] as [string, string], city: cities[0]!.text, state };
  };

  /** Line B: the times, the street up to the phone, the ZIP after it. */
  const lineB = (line: Line) => {
    const tokens = words(line.cells);
    let k = 0;
    while (k < 2 && k < tokens.length && TABLE.clock.test(tokens[k]!)) k += 1;
    let phone = -1;
    let width = 0;
    for (let j = k + 1; j < tokens.length && phone === -1; j += 1) {
      if (TABLE.phone.test(tokens[j]!)) [phone, width] = [j, 1];
      else if (j + 1 < tokens.length && TABLE.phone.test(`${tokens[j]} ${tokens[j + 1]}`)) [phone, width] = [j, 2];
      else if (j + 2 < tokens.length && TABLE.spacedPhone.test(tokens.slice(j, j + 3).join(' '))) [phone, width] = [j, 3];
    }
    if (phone === -1) return null;
    const street = tokens.slice(k, phone).join(' ');
    const zip = TABLE.zip.exec(tokens[phone + width] ?? '');
    if (!zip || !startsLikeStreet(street)) return null;
    return { times: tokens.slice(0, k), street, zip: zip[1]! };
  };

  type Row = NonNullable<ReturnType<typeof lineA>> & NonNullable<ReturnType<typeof lineB>> & { page: number | null };
  const rows: Row[] = [];
  let i = heads[0]! + 2;
  for (;;) {
    const line = lines[i];
    // The table ends at "Commodity", on its own page.
    if (!line || line.page !== header.page) return refuse;
    if (TABLE.end.test(line.text)) break;
    const a = lineA(line);
    if (a) {
      const next = lines[i + 1];
      const b = next && next.page === line.page ? lineB(next) : null;
      if (!b) return refuse;
      rows.push({ ...a, ...b, page: line.page });
      i += 2;
      continue;
    }
    // A note after a stop, and the lines its text wraps onto, under that text.
    if (rows.length > 0 && TABLE.notes.test(line.cells[0]?.text ?? '') && column(line.cells[0]!) === 'lead') {
      const textX = line.cells[1]?.x ?? null;
      i += 1;
      while (textX !== null && lines[i]?.page === line.page && Math.abs(lines[i]!.cells[0]!.x! - textX) <= TABLE.slack) i += 1;
      continue;
    }
    return refuse;
  }
  if (rows.length === 0 || rows.some((r, k) => r.n !== k + 1)) return refuse;
  if (rows[0]!.type !== 'PU' || (rows.length > 1 && rows.at(-1)!.type !== 'Del')) return refuse;

  const { loadNumber, loadNumberCheck, date } = tableNumbers(lines);
  const hours24 = documentIs24Hour(lines.map((l, n) => ({ n, text: l.text, page: l.page })));
  const stops: StopRead[] = rows.map((r) => {
    const at = (text: string): Source => ({ text, page: r.page });
    return {
      type: { value: r.type === 'PU' ? 'PU' : 'DEL', source: at(`${r.n} ${r.type}`) },
      typeCheck: null,
      street: { value: r.street, source: at(r.street) },
      city: { value: r.city, source: at(`${r.city} ${r.state}`) },
      state: { value: r.state, source: at(`${r.city} ${r.state}`) },
      zip: { value: r.zip, source: at(r.zip) },
      time: tableTime(r.dates, r.times, date, hours24, at([r.dates.join(' '), r.times.join(' ')].filter(Boolean).join(' · '))),
    };
  });
  return { layout: 'stop-table', loadNumber, loadNumberCheck, stops };
}

/* ------------------------------ Stop detail (3ax) ------------------------------ */

/**
 * A header on every page ("CARRIER RATE CONFIRMATION PAGE n of m", then
 * "Load Confirmation" and the load number under it), and the stops in a
 * "STOP DETAIL" table under a three-line header:
 *
 *             Scheduled  Scheduled                               Weight (lbs)/Cases/
 *     Type                          Name and Address  Commodity                       Reference #
 *             Arrival    Departure                               Dims
 *
 * One stop is one row. Its type, PU or SO (a stop-off), on the row's first
 * line; under "Scheduled Arrival" the word "Arrival", the date (M/D/YY) and
 * the time, one a line, or for a window (3ay) the start as "HH:MM -" and the
 * end on the line under it; under "Scheduled Departure" "N/A"; under "Name and
 * Address", centred, the facility's name on one line or more, the street on
 * one or more, then "City, ST 12345". The table ends at the next section's
 * heading ("NOTES"), on its page. The other columns are not read.
 *
 * Read by COLUMN, so it needs a PDF's positions: pasted text is not read. A
 * cell belongs to the heading that starts nearest to it, because the address
 * column is centred and the columns beside it are not.
 *
 * The name ends where the street starts: at the one line of the cell before
 * the city line that starts like a street (a house number). A name that
 * starts like one too leaves two such lines, and nothing is read. A street on
 * more than one line is read joined with a space and marked (`WRAP_CHECK`):
 * the PDF can run two words together at the break.
 *
 * The time is an appointment at the scheduled arrival; a window runs from
 * its start to its end on the same date, and the fill's window rules decide
 * what that is (`appointmentFrom`). Times are read as Route blocks reads
 * them: 24-hour when past 12, with a leading zero, or on a 24-hour document
 * (`documentIs24Hour`); either end of a window unclear, and the stop's time
 * is quoted as unreadable. The departure must be "N/A": what a
 * departure time would mean, no copy shows. The last stop must be an SO, read
 * as the delivery; an SO before it is read as a delivery and says so
 * (`STOP_OFF_CHECK`), as PU / SO blocks says it.
 *
 * The load number is the one under "Load Confirmation", the same on every
 * page; one that differs leaves it blank with a check.
 *
 * Strict, because a wrong stop is worse than none: a heading not its own
 * cell; a line in the table before the first stop, or in the type column
 * that is not PU, SO or a heading; an arrival other than "Arrival", a date
 * and a time or a window; a departure other than "N/A"; a name cell with no
 * name, two street-like lines, or a last line that is not a city line; a
 * city line in any other column; a first stop that is not PU or a last that
 * is not SO; a table that does not end on its page — and nothing is read.
 */
const DETAIL = {
  recognise: [
    /^CARRIER RATE CONFIRMATION PAGE \d+ of \d+$/,
    /^STOP DETAIL$/,
    /^Type\s+Name and Address\s+Commodity\s+Reference #$/,
    /^Arrival\s+Departure\s+Dims$/,
  ],
  type: /^(PU|SO)$/,
  date: /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/,
  clock: /^(\d{1,2}):(\d{2})$/,
  /** A window's start; its end is the next line's clock. */
  from: /^(\d{1,2}):(\d{2}) -$/,
  place: /^(.+), ([A-Z]{2}) (\d{5})(?:-\d{4})?$/,
  /** The next section's heading, which ends the table: one cell, capitals. */
  heading: /^[A-Z][A-Z ]*[A-Z]$/,
  id: /^[A-Za-z0-9][A-Za-z0-9-]*$/,
};

/**
 * Said under a street the layout prints on more than one line, read joined with a space. The
 * field shows it after "Check: ", as every check; edited, the field's check goes.
 */
export const WRAP_CHECK = (text: string) => `the street is printed on more than one line, read as “${text}”. Confirm it against the PDF.`;

/** One time, or a window's start ("HH:MM -") and end, on one M/D/YY date. */
function detailTime(date: string, clocks: string[], hours24: boolean, source: Source): TimeRead {
  const d = DETAIL.date.exec(date)!;
  const [y, m, day] = [2000 + Number(d[3]), Number(d[1]), Number(d[2])];
  const at = validDate(y, m, day) ? iso(y, m, day) : null;
  const times = clocks.map((text) => {
    const t = DETAIL.clock.exec(text.replace(/ -$/, ''))!;
    const [h, mi] = [Number(t[1]), Number(t[2])];
    // "10:00" alone could be either half of the day: it is a time only on a 24-hour document.
    return validClock(h, mi) && (h >= 13 || t[1]!.startsWith('0') || hours24) ? hhmm(h, mi) : null;
  });
  const [time, endTime] = times;
  if (at && time && clocks.length === 1) return { kind: 'exact', date: at, time, flag: null, source };
  if (at && time && endTime) {
    return time === endTime
      ? { kind: 'exact', date: at, time, flag: null, source }
      : { kind: 'range', date: at, time, endDate: at, endTime, flag: null, source };
  }
  return { kind: 'unreadable', date: at, quoted: `${date} ${clocks.join(' ')}`, source };
}

function readStopDetail(lines: Line[]): RateconRead {
  const refuse: RateconRead = { layout: 'stop-detail', loadNumber: null, loadNumberCheck: null, stops: [] };
  if (lines.some((l) => l.page === null || l.cells.some((c) => c.x === null))) return refuse;

  const heads = lines.flatMap((l, i) => (DETAIL.recognise[2]!.test(l.text) ? [i] : []));
  if (heads.length !== 1) return refuse;
  const [above, header, below] = [lines[heads[0]! - 1], lines[heads[0]!]!, lines[heads[0]! + 1]];
  if (!above || !below || above.page !== header.page || below.page !== header.page || !DETAIL.recognise[3]!.test(below.text)) return refuse;
  // Each heading is its own cell; "Scheduled" twice above, for the arrival and the departure.
  const scheduled = above.cells.filter((c) => c.text === 'Scheduled');
  const weight = above.cells.find((c) => c.text.startsWith('Weight'));
  const named = ['Type', 'Name and Address', 'Commodity', 'Reference #'].map((t) => header.cells.find((c) => c.text === t));
  if (scheduled.length !== 2 || !weight || named.some((c) => !c)) return refuse;
  const [type, name, commodity, reference] = named as Line['cells'];
  const headings = [
    { column: 'type', x: type!.x! },
    { column: 'arrival', x: scheduled[0]!.x! },
    { column: 'departure', x: scheduled[1]!.x! },
    { column: 'name', x: name!.x! },
    { column: 'commodity', x: commodity!.x! },
    { column: 'weight', x: weight.x! },
    { column: 'reference', x: reference!.x! },
  ];
  const column = (cell: Line['cells'][number]) =>
    headings.reduce((a, b) => (Math.abs(cell.x! - b.x) < Math.abs(cell.x! - a.x) ? b : a)).column;

  // The rows: a stop starts at PU or SO in the type column; the table ends at a heading there.
  const blocks: { head: Line; type: 'PU' | 'SO'; lines: Line[] }[] = [];
  for (let i = heads[0]! + 2; ; i += 1) {
    const line = lines[i];
    if (!line || line.page !== header.page) return refuse;
    const typed = line.cells.filter((c) => column(c) === 'type');
    if (typed.length === 0) {
      if (blocks.length === 0) return refuse;
      blocks.at(-1)!.lines.push(line);
      continue;
    }
    if (typed.length === 1 && line.cells[0] === typed[0] && DETAIL.type.test(typed[0]!.text)) {
      blocks.push({ head: line, type: typed[0]!.text as 'PU' | 'SO', lines: [line] });
      continue;
    }
    if (line.cells.length === 1 && DETAIL.heading.test(line.text) && blocks.length > 0) break;
    return refuse;
  }
  if (blocks[0]!.type !== 'PU' || blocks.at(-1)!.type !== 'SO') return refuse;

  const hours24 = documentIs24Hour(lines.map((l, n) => ({ n, text: l.text, page: l.page })));
  const stops: StopRead[] = [];
  for (const [n, b] of blocks.entries()) {
    const of = (where: string) => b.lines.flatMap((l) => l.cells.filter((c) => column(c) === where).map((c) => c.text));
    // "Arrival", the date, then one time, or a window's "HH:MM -" and its end.
    const arrival = of('arrival');
    const [word, date, ...clocks] = arrival;
    const one = clocks.length === 1 && DETAIL.clock.test(clocks[0]!);
    const window = clocks.length === 2 && DETAIL.from.test(clocks[0]!) && DETAIL.clock.test(clocks[1]!);
    if (word !== 'Arrival' || !date || !DETAIL.date.test(date) || !(one || window)) return refuse;
    const departure = of('departure');
    if (departure.length !== 1 || departure[0] !== 'N/A') return refuse;
    // The address cell: one cell a line, the city line last and nowhere else in the row.
    if (b.lines.some((l) => l.cells.filter((c) => column(c) === 'name').length > 1)) return refuse;
    if (b.lines.some((l) => l.cells.some((c) => column(c) !== 'name' && cityLine(c.text)))) return refuse;
    const cell = of('name');
    const place = DETAIL.place.exec(cell.at(-1) ?? '');
    if (!place || !US.has(place[2]!)) return refuse;
    const streetAt = cell.slice(0, -1).flatMap((t, k) => (startsLikeStreet(t) ? [k] : []));
    if (streetAt.length !== 1 || streetAt[0] === 0) return refuse;
    const streetLines = cell.slice(streetAt[0]!, -1);
    const street = streetLines.join(' ');
    const at = (text: string): Source => ({ text, page: b.head.page });
    stops.push({
      type: { value: b.type === 'PU' ? 'PU' : 'DEL', source: at(b.type) },
      typeCheck: b.type === 'SO' && n < blocks.length - 1 ? STOP_OFF_CHECK : null,
      street: { value: street, source: at(street) },
      city: { value: place[1]!, source: at(cell.at(-1)!) },
      state: { value: place[2]!, source: at(cell.at(-1)!) },
      zip: { value: place[3]!, source: at(cell.at(-1)!) },
      ...(streetLines.length > 1 ? { fieldChecks: { street: WRAP_CHECK(street) } } : {}),
      time: detailTime(date, clocks, hours24, at(arrival.join(' · '))),
    });
  }

  const ids = lines.flatMap((l, k) => {
    const next = lines[k + 1];
    return l.cells.length === 1 && l.text === 'Load Confirmation' && next?.page === l.page && next.cells.length === 1 && DETAIL.id.test(next.text)
      ? [{ value: next.text, source: { text: `Load Confirmation  ${next.text}`, page: next.page } }]
      : [];
  });
  const distinct = new Set(ids.map((x) => x.value));
  const loadNumber = distinct.size === 1 ? ids[0]! : null;
  return {
    layout: 'stop-detail',
    loadNumber,
    loadNumberCheck: loadNumber
      ? null
      : distinct.size > 1
        ? `More than one number is under “Load Confirmation”: ${[...distinct].map((x) => `“${x}”`).join(', ')}.`
        : 'No number under “Load Confirmation”.',
    stops,
  };
}

/* -------------------------------- choose -------------------------------- */

const LAYOUTS: { id: LayoutId; labels: RegExp[]; read: (lines: Line[]) => RateconRead }[] = [
  { id: 'label-rows', labels: LABEL_ROWS.recognise, read: readLabelRows },
  { id: 'stops-section', labels: SECTION.recognise, read: readStopsSection },
  { id: 'pu-so-blocks', labels: BLOCKS.recognise, read: readBlocks },
  { id: 'pickup-delivery-columns', labels: COLUMNS.recognise, read: readColumns },
  { id: 'route-blocks', labels: ROUTE.recognise, read: readRouteBlocks },
  { id: 'stop-table', labels: TABLE.recognise, read: readStopTable },
  { id: 'stop-detail', labels: DETAIL.recognise, read: readStopDetail },
];

/** Which layouts have every one of their labels here. */
export function recognisedLayouts(lines: readonly Line[]): LayoutId[] {
  return LAYOUTS.filter((layout) =>
    layout.labels.every((label) => lines.some((l) => label.test(l.text))),
  ).map((l) => l.id);
}

export function readRatecon(lines: Line[]): ReadOutcome {
  const found = recognisedLayouts(lines);
  if (found.length !== 1) return { ok: false, reason: 'not-recognised' };
  const read = LAYOUTS.find((l) => l.id === found[0])!.read(lines);
  if (read.stops.length === 0) return { ok: false, reason: 'not-recognised' };
  return { ok: true, read };
}
