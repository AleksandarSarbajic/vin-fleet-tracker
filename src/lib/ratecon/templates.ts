import { ZONE_BY_STATE } from '../geo/zone-by-state';
import type { Line } from './lines';

/**
 * §12.122. The three rate-confirmation layouts this fleet receives, each
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

export type LayoutId = 'label-rows' | 'stops-section' | 'pu-so-blocks';

export const LAYOUT_NAME: Record<LayoutId, string> = {
  'label-rows': 'label rows (PICKUP DATE / SHIPPER / CONSIGNEE)',
  'stops-section': 'a Stops section (Stop 1 Pickup, Stop 2 Drop)',
  'pu-so-blocks': 'PU / SO blocks (Name, Address, Date)',
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

function cityLine(text: string): { city: string; state: string; zip: string } | null {
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
      stop.typeCheck = 'An SO (stop-off) before the last stop is read as a delivery. It can be a pickup.';
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

/* -------------------------------- choose -------------------------------- */

const LAYOUTS: { id: LayoutId; labels: RegExp[]; read: (lines: Line[]) => RateconRead }[] = [
  { id: 'label-rows', labels: LABEL_ROWS.recognise, read: readLabelRows },
  { id: 'stops-section', labels: SECTION.recognise, read: readStopsSection },
  { id: 'pu-so-blocks', labels: BLOCKS.recognise, read: readBlocks },
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
