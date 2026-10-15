import { describe, expect, it } from 'vitest';
import { LABEL_ROWS, PU_SO, STOPS_SECTION, puSoBlocks, type BlockStop } from '@/test/ratecon-fixtures';
import type { TinyRun } from '@/test/tiny-pdf';
import { linesFromRuns } from '@/lib/ratecon/lines';
import { readRatecon, type RateconRead, type Source, type TimeRead } from '@/lib/ratecon/templates';
import { MODEL_REPLY, UNKNOWN_LAYOUT, pdfLine } from '@/test/model-read-fixtures';
import type { Line } from '@/lib/ratecon/lines';
import type { ModelAppointment, ModelRead } from '@/lib/ratecon/model-read';
import { prepareForReading } from '@/lib/ratecon/redact';
import { NOT_IN_TEXT, verifyRead } from '@/lib/ratecon/verify-read';
import { AGREE_DIFFERED, agreeReads } from '@/lib/ratecon/agree-reads';
import { loadFormFrom, patchStop, type LoadForm } from './load-form';
import {
  TOO_MANY_STOPS,
  ZIP_NOT_REAL,
  aiMarkedFields,
  aiMarks,
  appointmentFrom,
  confirmAiLoadNumber,
  confirmAiStop,
  fieldsToCheck,
  AI_APPOINTMENT_CHECK,
  fillLoad,
  sourceLine,
} from './ratecon-fill';
import { fillSnapshot, outcomeFields } from './fill-outcome';

/** §12.122. A read, put into the form — by rules that are the same for every layout. Invented documents. */

const OPENED = '2026-10-10T15:00:00.000Z';
const NOW = new Date(OPENED);
const SOURCE: Source = { text: 'the line it said', page: 2 };

const readOf = (pages: TinyRun[][]): RateconRead => {
  const out = readRatecon(linesFromRuns(pages.flatMap((runs, i) => runs.map((r) => ({ page: i + 1, ...r })))));
  if (!out.ok) throw new Error('not recognised');
  return out.read;
};
const fill = (read: RateconRead, now = NOW, form: LoadForm = loadFormFrom(null, OPENED, null)) => {
  const out = fillLoad(form, read, OPENED, now);
  if (!out.ok) throw new Error(out.message);
  return out.form;
};
const range = (time: string, endDate: string, endTime: string, flag: 'APPT' | 'FCFS' | null = null): TimeRead => ({
  kind: 'range', date: '2026-10-12', time, endDate, endTime, flag, source: SOURCE,
});

describe('an appointment, from what the PDF says', () => {
  it('one time: APPT, no window', () => {
    expect(appointmentFrom({ kind: 'exact', date: '2026-10-12', time: '08:00', flag: 'APPT', source: SOURCE })).toEqual({
      patch: { enabled: true, type: 'APPT', date: '2026-10-12', time: '08:00', windowMinutes: 0 },
      check: null,
    });
  });

  it('a window of 2 hours or less: APPT with that window, even one the menu does not list', () => {
    expect(appointmentFrom(range('08:00', '2026-10-12', '09:30')).patch).toMatchObject({ type: 'APPT', windowMinutes: 90 });
    expect(appointmentFrom(range('08:00', '2026-10-12', '10:00')).patch).toMatchObject({ type: 'APPT', windowMinutes: 120 });
  });

  it('a longer window: FCFS receiving hours, and says why', () => {
    const out = appointmentFrom(range('08:00', '2026-10-12', '10:01', 'APPT'));
    expect(out.patch).toEqual({ enabled: true, type: 'FCFS', date: '2026-10-12', time: '08:00', endTime: '10:01' });
    expect(out.check).toBe(
      'Check: a window of 2 h 1 min (08:00–10:01) is longer than 2 hours, so it is filled as FCFS receiving hours. The PDF calls it APPT.',
    );
  });

  it('a window into the next morning: FCFS overnight, and says so', () => {
    const out = appointmentFrom(range('22:00', '2026-10-13', '06:00'));
    expect(out.patch).toMatchObject({ type: 'FCFS', time: '22:00', endTime: '06:00' });
    expect(out.check).toContain('22:00–06:00 the next day');
  });

  it('a window that ends before it starts: not read as overnight; blank, and marked', () => {
    const out = appointmentFrom(range('15:00', '2026-10-12', '07:00'));
    expect(out.patch).toMatchObject({ enabled: true, date: '2026-10-12', time: '' });
    expect(out.check).toBe('Check: the window ends before it starts: “the line it said”. It was not read as overnight; enter it by hand.');
  });

  it('a window longer than a day: blank, and marked', () => {
    const out = appointmentFrom(range('08:00', '2026-10-14', '09:00'));
    expect(out.patch.time).toBe('');
    expect(out.check).toContain('longer than a day');
  });

  it('text it cannot read: blank, quoted, never guessed', () => {
    const out = appointmentFrom({ kind: 'unreadable', date: '2026-10-12', quoted: 'BY 10P OR 10/13 7-10A', source: SOURCE });
    expect(out.patch).toMatchObject({ enabled: true, date: '2026-10-12', time: '' });
    expect(out.check).toBe("Couldn't read: “BY 10P OR 10/13 7-10A”.");
  });

  it('FCFS written beside one time or a short window is said, not hidden', () => {
    expect(appointmentFrom({ kind: 'exact', date: '2026-10-12', time: '08:00', flag: 'FCFS', source: SOURCE }).check).toContain('says FCFS');
    expect(appointmentFrom(range('08:00', '2026-10-12', '09:00', 'FCFS')).check).toContain('says FCFS');
  });
});

describe('filling the form', () => {
  it('fills the load number and every stop in order, each field with its source', () => {
    const form = fill(readOf(STOPS_SECTION));
    expect(form.loadNumber).toBe('77001');
    expect(form.fill?.loadNumber).toEqual({ text: 'LOAD ID: 77001', page: 1 });
    expect(form.stops.map((s) => [s.stopType, s.addressLine, s.city, s.state, s.zip])).toEqual([
      ['PU', '4001 Main St', 'Fargo', 'ND', '58102'],
      ['DEL', '1200 Harbor Rd', 'Dickinson', 'ND', '58601'],
    ]);
    // The exact line, as the PDF has it — the date column's word included.
    expect(sourceLine(form.stops[1]!.fill?.sources.city)).toBe('From p.2: “Dickinson, ND 58601  APPT”');
    expect(form.stops[0]!.appointment).toMatchObject({ enabled: true, type: 'APPT', time: '08:00', windowMinutes: 90 });
    expect(form.stops[1]!.appointment).toMatchObject({ type: 'FCFS', time: '07:00', endTime: '15:00' });
  });

  it('lets the zone follow each stop’s address (§12.120)', () => {
    const form = fill(readOf(LABEL_ROWS));
    expect(form.stops.map((s) => s.appointment.tz)).toEqual(['America/Chicago', 'America/Denver']);
  });

  it('keeps the driver and the status; touches nothing it does not fill', () => {
    const before = { ...loadFormFrom(null, OPENED, 'driver-1'), loadStatus: 'DISPATCHED' as const };
    const form = fill(readOf(LABEL_ROWS), NOW, before);
    expect([form.driverId, form.loadStatus]).toEqual(['driver-1', 'DISPATCHED']);
  });

  it('a stop the PDF has no city line for: filled as far as it goes, the rest marked', () => {
    const pages = puSoBlocks([{ ...PU_SO[0]!, city: 'FARGO', state: 'XX', merged: false }, PU_SO[1]!]);
    const form = fill(readOf(pages));
    expect(form.stops[0]!.fill?.checks).toMatchObject({
      city: 'Not found in the PDF.',
      state: 'Not found in the PDF.',
      zip: 'Not found in the PDF.',
    });
  });

  it('a date that has passed, or is more than 30 days out, is marked', () => {
    expect(fill(readOf(LABEL_ROWS), new Date('2026-10-14T12:00:00Z')).stops[0]!.fill?.checks.appointment).toBe(
      'Check: this date has passed.',
    );
    expect(fill(readOf(LABEL_ROWS), new Date('2026-09-01T12:00:00Z')).stops[0]!.fill?.checks.appointment).toBe(
      'Check: this date is more than 30 days out.',
    );
  });

  it('fills ten stops with Add stop, and refuses eleven, filling nothing', () => {
    const stop = (i: number): BlockStop => ({ ...PU_SO[1]!, kind: i === 0 ? 'PU' : 'SO', street: `${100 + i} Harbor Rd` });
    const ten = fill(readOf(puSoBlocks(Array.from({ length: 10 }, (_, i) => stop(i)))));
    expect(ten.stops.map((s) => s.addressLine)).toEqual(Array.from({ length: 10 }, (_, i) => `${100 + i} Harbor Rd`));
    const eleven = readOf(puSoBlocks(Array.from({ length: 11 }, (_, i) => stop(i))));
    expect(fillLoad(loadFormFrom(null, OPENED, null), eleven, OPENED, NOW)).toEqual({ ok: false, message: TOO_MANY_STOPS(11) });
  });
});

describe('"fields to check"', () => {
  it('counts what a fill marked, and falls as each is edited', () => {
    const form = fill(readOf(STOPS_SECTION));
    // The FCFS window on the delivery.
    expect(fieldsToCheck(form)).toBe(1);
    const edited = { ...form, stops: form.stops.map((s, i) => (i === 1 ? patchStop(s, { appointment: { ...s.appointment, endTime: '14:00' } }) : s)) };
    expect(fieldsToCheck(edited)).toBe(0);
    expect(edited.stops[1]!.fill?.sources.appointment).toBeUndefined();
  });

  it('counts a ZIP that is not in its state, and a delivery before the pickup', () => {
    const form = fill(readOf(LABEL_ROWS));
    // Illinois has one zone, so only the ZIP is in question: 58102 is North Dakota's.
    const wrongZip = { ...form, stops: form.stops.map((s, i) => (i === 0 ? patchStop(s, { state: 'IL' }) : s)) };
    expect(fieldsToCheck(wrongZip) - fieldsToCheck(form)).toBe(1);
    // The delivery's appointment moved to the day before the pickup's.
    const early = {
      ...form,
      stops: form.stops.map((s, i) => (i === 1 ? { ...s, appointment: { ...s.appointment, date: '2026-10-11' } } : s)),
    };
    expect(fieldsToCheck(early) - fieldsToCheck(form)).toBe(1);
  });
});

/* ----------- the language-model reader (docs/llm-reader-design.md §3) ----------- */

describe('a model read, filled', () => {
  /** The invented document, sent as redaction sends it, the scripted reply checked against it. */
  const modelRead = (reply: ModelRead = MODEL_REPLY, lines: Line[] = UNKNOWN_LAYOUT): RateconRead => {
    const prepared = prepareForReading(lines);
    if (!prepared.ok) throw new Error(prepared.reason);
    const out = verifyRead(reply, prepared.lines, NOW);
    if (!out.ok) throw new Error(out.reason);
    return out.read;
  };

  it('fills through the same rules, and every filled field carries an AI mark', () => {
    const form = fill(modelRead());
    expect(form.loadNumber).toBe('EX-40417');
    expect(form.stops.map((s) => [s.stopType, s.addressLine, s.city, s.state, s.zip])).toEqual([
      ['PU', '4001 Main St', 'Fargo', 'ND', '58102'],
      ['DEL', '220 Harbor Rd', 'Duluth', 'MN', '55802'],
    ]);
    expect(form.stops[0]!.appointment).toMatchObject({ enabled: true, type: 'APPT', date: '2026-10-14', time: '08:00', windowMinutes: 120 });
    // Load number 1; the pickup's type, four address fields and appointment 6; the delivery's type and address 5.
    expect(aiMarks(form)).toEqual({ stops: 2, fields: 12 });
  });

  it('a blank appointment is a check, not an AI mark: alternatives are quoted, never chosen', () => {
    const delivery = fill(modelRead()).stops[1]!;
    expect(delivery.appointment).toMatchObject({ enabled: true, time: '' });
    expect(delivery.fill?.checks.appointment).toBe("Couldn't read: “Delivery same day by 8 PM, or next day 7-10 AM”.");
  });

  it('AI marks are their own kind: "fields to check" does not count them, and confirming them does not move it', () => {
    const form = fill(modelRead());
    const confirmed = confirmAiLoadNumber(form.stops.reduce((f, s) => confirmAiStop(f, s.key), form));
    expect(aiMarks(confirmed)).toEqual({ stops: 0, fields: 0 });
    expect(fieldsToCheck(confirmed)).toBe(fieldsToCheck(form));
  });

  it('"Looks right" clears one stop\'s AI marks and keeps where each came from', () => {
    const form = fill(modelRead());
    const once = confirmAiStop(form, form.stops[0]!.key);
    expect(aiMarks(once)).toEqual({ stops: 1, fields: 1 + 5 });
    expect(once.stops[0]!.fill?.sources.addressLine).toEqual({ text: '4001 Main St', page: 2 });
  });

  it('editing a field clears its AI mark, as it clears its source', () => {
    const form = fill(modelRead());
    const edited = { ...form, stops: form.stops.map((s, i) => (i === 0 ? patchStop(s, { addressLine: '4003 Main St' }) : s)) };
    expect(aiMarks(edited)).toEqual({ stops: 2, fields: 11 });
  });

  it('the load number\'s AI mark clears when it is confirmed, or when the modal drops its source on an edit', () => {
    const form = fill(modelRead());
    expect(aiMarks(confirmAiLoadNumber(form)).fields).toBe(11);
    // What EditStopModal does when the load number is typed in.
    const typed = { ...form, loadNumber: 'X1', fill: form.fill ? { ...form.fill, loadNumber: null, loadNumberCheck: null } : null };
    expect(aiMarks(typed).fields).toBe(11);
  });

  it('a field the verifier could not confirm is blank and says why', () => {
    const reply = structuredClone(MODEL_REPLY);
    reply.stops[0]!.street = { value: '4001 Main St', quote: { line: 12, text: '4001 Main Street' } };
    const pickup = fill(modelRead(reply)).stops[0]!;
    expect(pickup.addressLine).toBe('');
    expect(pickup.fill?.checks.addressLine).toBe(NOT_IN_TEXT);
  });

  it('a window over two hours becomes FCFS receiving hours, marked; the zone follows the state', () => {
    const reply = structuredClone(MODEL_REPLY);
    const lines = UNKNOWN_LAYOUT.map((l) => (l.text.startsWith('Pick up 10/14') ? pdfLine(2, 'Pick up 10/14/2026 0800-1100 APPT') : l));
    reply.stops[0]!.appointment = { ...(reply.stops[0]!.appointment as Extract<ModelAppointment, { kind: 'range' }>), endTime: '11:00', dateQuote: { line: 14, text: 'Pick up 10/14/2026 0800-1100 APPT' }, timeQuote: { line: 14, text: '0800-1100' } };
    const pickup = fill(modelRead(reply, lines)).stops[0]!;
    expect(pickup.appointment).toMatchObject({ type: 'FCFS', time: '08:00', endTime: '11:00', tz: 'America/Chicago' });
    expect(pickup.fill?.checks.appointment).toContain('filled as FCFS receiving hours');
    expect(fill(modelRead()).stops[1]!.appointment.tz).toBe('America/Chicago');
  });

  it('a template read carries no AI marks, and its fill is shaped exactly as before', () => {
    const form = fill(readOf(LABEL_ROWS));
    expect(aiMarks(form)).toEqual({ stops: 0, fields: 0 });
    expect(Object.keys(form.fill ?? {}).sort()).toEqual(['layout', 'loadNumber', 'loadNumberCheck']);
    expect(form.stops.map((s) => Object.keys(s.fill ?? {}).sort())).toEqual([
      ['checks', 'sources'],
      ['checks', 'sources'],
    ]);
  });
});

describe('street and city in normal case (2026-10-14)', () => {
  /** The same read, as a PDF that prints in capitals would give it. Invented values only. */
  const shouted = (read: RateconRead): RateconRead => ({
    ...read,
    stops: read.stops.map((s) => ({
      ...s,
      street: s.street && { value: s.street.value.toUpperCase(), source: { ...s.street.source, text: s.street.source.text.toUpperCase() } },
      city: s.city && { value: s.city.value.toUpperCase(), source: { ...s.city.source, text: s.city.source.text.toUpperCase() } },
    })),
  });

  it('an all-caps read ends up in normal case, street and city only', () => {
    const form = fill(shouted(readOf(STOPS_SECTION)));
    expect(form.stops.map((s) => [s.stopType, s.addressLine, s.city, s.state, s.zip])).toEqual([
      ['PU', '4001 Main St', 'Fargo', 'ND', '58102'],
      ['DEL', '1200 Harbor Rd', 'Dickinson', 'ND', '58601'],
    ]);
    expect(form.loadNumber).toBe('77001');
  });

  it('a hyphenated, directional and Mc name, in a read', () => {
    const read = readOf(STOPS_SECTION);
    const first = read.stops[0]!;
    const loud: RateconRead = {
      ...read,
      stops: [{ ...first, street: { ...first.street!, value: '120 N MCALLEN BLVD' }, city: { ...first.city!, value: 'WINSTON-SALEM' } }, ...read.stops.slice(1)],
    };
    const stop = fill(loud).stops[0]!;
    expect([stop.addressLine, stop.city]).toEqual(['120 N McAllen Blvd', 'Winston-Salem']);
  });

  it('an already mixed-case read is unchanged', () => {
    const read = readOf(STOPS_SECTION);
    const form = fill(read);
    expect(form.stops.map((s) => [s.addressLine, s.city])).toEqual(read.stops.map((s) => [s.street?.value, s.city?.value]));
  });

  it('the state stays upper-case, the ZIP is untouched', () => {
    const read = shouted(readOf(STOPS_SECTION));
    const stops = read.stops.map((s) => ({ ...s, state: s.state && { ...s.state, value: 'ND' } }));
    const form = fill({ ...read, stops });
    expect(form.stops.map((s) => [s.state, s.zip])).toEqual([['ND', '58102'], ['ND', '58601']]);
  });

  it('the sources keep the printed line, capitals and all', () => {
    const read = shouted(readOf(STOPS_SECTION));
    const stop = fill(read).stops[0]!;
    const printed = read.stops[0]!.street!.source;
    expect(printed.text).toBe(printed.text.toUpperCase());
    expect(stop.fill?.sources.addressLine).toEqual(printed);
    expect(stop.fill?.sources.city).toEqual(read.stops[0]!.city!.source);
  });

  it('the marks do not change because of normalization: same checks, same count', () => {
    const base = readOf(puSoBlocks([{ ...PU_SO[0]!, city: 'FARGO', state: 'XX', merged: false }, PU_SO[1]!]));
    const plain = fill(base);
    const loud = fill(shouted(base));
    expect(loud.stops.map((s) => s.fill?.checks)).toEqual(plain.stops.map((s) => s.fill?.checks));
    expect(loud.stops.map((s) => Object.keys(s.fill?.sources ?? {}))).toEqual(plain.stops.map((s) => Object.keys(s.fill?.sources ?? {})));
    expect(fieldsToCheck(loud)).toBe(fieldsToCheck(plain));
    expect(loud.stops[0]!.fill?.checks.city).toBe('Not found in the PDF.');
  });

  it('a model read in capitals: verified against the printed line, then put in normal case; AI marks as before', () => {
    const lines = UNKNOWN_LAYOUT.map((l) => {
      if (l.text.startsWith('4001 Main St')) return pdfLine(2, '4001 MAIN ST');
      if (l.text.startsWith('Fargo, ND')) return pdfLine(2, 'FARGO, ND 58102');
      return l;
    });
    const reply = structuredClone(MODEL_REPLY);
    reply.stops[0]!.street = { value: '4001 MAIN ST', quote: { line: 12, text: '4001 MAIN ST' } };
    reply.stops[0]!.city = { value: 'FARGO', quote: { line: 13, text: 'FARGO, ND 58102' } };
    reply.stops[0]!.state = { value: 'ND', quote: { line: 13, text: 'FARGO, ND 58102' } };
    reply.stops[0]!.zip = { value: '58102', quote: { line: 13, text: 'FARGO, ND 58102' } };
    const prepared = prepareForReading(lines);
    if (!prepared.ok) throw new Error(prepared.reason);
    const verified = verifyRead(reply, prepared.lines, NOW);
    if (!verified.ok) throw new Error(verified.reason);
    // The verifier saw capitals and the read still carries them…
    expect(verified.read.stops[0]!.street?.value).toBe('4001 MAIN ST');
    // …the form is where they change.
    const form = fill(verified.read);
    expect([form.stops[0]!.addressLine, form.stops[0]!.city, form.stops[0]!.state]).toEqual(['4001 Main St', 'Fargo', 'ND']);
    expect(aiMarks(form)).toEqual({ stops: 2, fields: 12 });
  });
});

describe('no trailing punctuation on a street or city (2026-10-14)', () => {
  const withText = (read: RateconRead, at: number, field: 'street' | 'city' | 'state', value: string): RateconRead => ({
    ...read,
    stops: read.stops.map((s, i) => (i === at && s[field] ? { ...s, [field]: { ...s[field]!, value } } : s)),
  });
  const printed = (read: RateconRead, at: number, field: 'street' | 'city') => read.stops[at]![field]!.value;

  it('a trailing comma or period shows without it, in the form', () => {
    const base = readOf(STOPS_SECTION);
    const stop = fill(withText(withText(base, 0, 'street', `${printed(base, 0, 'street')},`), 0, 'city', `${printed(base, 0, 'city')}.`)).stops[0]!;
    expect([stop.addressLine, stop.city]).toEqual(['4001 Main St', 'Fargo']);
  });

  it('the read and its source line keep what was printed; checks, sources and marks are those of a read without the comma', () => {
    const base = readOf(STOPS_SECTION);
    const loud = withText(base, 0, 'street', `${printed(base, 0, 'street')},`);
    const sourced: RateconRead = {
      ...loud,
      stops: loud.stops.map((s, i) => (i === 0 && s.street ? { ...s, street: { ...s.street, source: { text: `${s.street.value}`, page: 2 } } } : s)),
    };
    expect(sourced.stops[0]!.street!.value.endsWith(',')).toBe(true);
    const plain = fill(base);
    const form = fill(sourced);
    // The source line is what was printed, comma and all.
    expect(form.stops[0]!.fill?.sources.addressLine?.text.endsWith(',')).toBe(true);
    expect(sourceLine(form.stops[0]!.fill?.sources.addressLine)).toBe('From p.2: “4001 Main St,”');
    expect(form.stops[0]!.fill?.checks).toEqual(plain.stops[0]!.fill?.checks);
    expect(Object.keys(form.stops[0]!.fill?.sources ?? {})).toEqual(Object.keys(plain.stops[0]!.fill?.sources ?? {}));
    expect(fieldsToCheck(form)).toBe(fieldsToCheck(plain));
  });

  it('a street or a city that is only punctuation is blank, with the same check as one not found', () => {
    const base = readOf(STOPS_SECTION);
    const missing = fill({ ...base, stops: base.stops.map((s, i) => (i === 0 ? { ...s, street: null, city: null } : s)) }).stops[0]!;
    const noise = fill(withText(withText(base, 0, 'street', '.,;'), 0, 'city', ' , ')).stops[0]!;
    expect([noise.addressLine, noise.city]).toEqual(['', '']);
    expect(noise.fill?.checks.addressLine).toBe('Not found in the PDF.');
    expect(noise.fill?.checks.city).toBe('Not found in the PDF.');
    expect(noise.fill?.sources.addressLine).toBeUndefined();
    expect(noise.fill?.sources.city).toBeUndefined();
    expect(noise.fill?.checks).toEqual(missing.fill?.checks);
    expect(noise.zip).toBe(missing.zip);
  });

  it('interior punctuation stays', () => {
    const base = readOf(STOPS_SECTION);
    const stop = fill(withText(withText(base, 0, 'street', 'N. Main St. #4,'), 0, 'city', 'St. Louis.')).stops[0]!;
    expect([stop.addressLine, stop.city]).toEqual(['N. Main St. #4', 'St. Louis']);
  });

  it('state is as read, and a ZIP that is not five digits still is not one: neither is stripped', () => {
    const base = readOf(STOPS_SECTION);
    const stop = fill(withText(base, 0, 'state', 'ND.')).stops[0]!;
    expect(stop.state).toBe('ND.');
    const zip = fill({ ...base, stops: base.stops.map((s, i) => (i === 0 && s.zip ? { ...s, zip: { ...s.zip, value: '58102,' } } : s)) }).stops[0]!;
    expect(zip.zip).toBe('');
    expect(zip.fill?.checks.zip).toBe(ZIP_NOT_REAL);
  });

  it('a model read: an all-punctuation street is a check, not an AI mark', () => {
    const lines = UNKNOWN_LAYOUT.map((l) => (l.text.startsWith('4001 Main St') ? pdfLine(2, '...') : l));
    const reply = structuredClone(MODEL_REPLY);
    reply.stops[0]!.street = { value: '...', quote: { line: 12, text: '...' } };
    const prepared = prepareForReading(lines);
    if (!prepared.ok) throw new Error(prepared.reason);
    const verified = verifyRead(reply, prepared.lines, NOW);
    if (!verified.ok) throw new Error(verified.reason);
    const form = fill(verified.read);
    // Whatever the verifier made of it, the form's street is blank, marked, and not read-by-AI.
    expect(form.stops[0]!.addressLine).toBe('');
    expect(form.stops[0]!.fill?.checks.addressLine).toBeTruthy();
    expect(aiMarkedFields(form.stops[0]!)).not.toContain('addressLine');
  });
});

describe('a ZIP that cannot exist is not put in the form (2026-10-14)', () => {
  const withZip = (read: RateconRead, at: number, zip: string): RateconRead => ({
    ...read,
    stops: read.stops.map((s, i) => (i === at && s.zip ? { ...s, zip: { ...s.zip, value: zip } } : s)),
  });

  it('00001 leaves the ZIP blank and marks it; the other fields are unaffected', () => {
    const base = readOf(STOPS_SECTION);
    const plain = fill(base).stops[0]!;
    const stop = fill(withZip(base, 0, '00001')).stops[0]!;
    expect(stop.zip).toBe('');
    expect(stop.fill?.checks.zip).toBe(ZIP_NOT_REAL);
    expect(stop.fill?.checks.zip).toBe("Check: the PDF's ZIP is not a real US ZIP. Enter it by hand.");
    expect(stop.fill?.checks.zip).not.toContain('00001');
    expect(stop.fill?.sources.zip).toBeUndefined();
    expect([stop.addressLine, stop.city, stop.state]).toEqual([plain.addressLine, plain.city, plain.state]);
    expect(stop.fill?.sources.addressLine).toEqual(plain.fill?.sources.addressLine);
    expect(stop.fill?.sources.city).toEqual(plain.fill?.sources.city);
    // Only the ZIP's own mark is new.
    expect(stop.fill?.checks).toEqual({ ...plain.fill?.checks, zip: ZIP_NOT_REAL });
  });

  it('it comes out exactly as a ZIP the reader did not find: the same form, the same count to check', () => {
    const base = readOf(STOPS_SECTION);
    const missing = fill({ ...base, stops: base.stops.map((s, i) => (i === 0 ? { ...s, zip: null } : s)) });
    const placeholder = fill(withZip(base, 0, '00001'));
    const stop = (f: LoadForm) => f.stops[0]!;
    expect(stop(placeholder).zip).toBe(stop(missing).zip);
    expect(stop(placeholder).appointment.tz).toBe(stop(missing).appointment.tz);
    expect(fieldsToCheck(placeholder)).toBe(fieldsToCheck(missing));
    expect(fieldsToCheck(placeholder)).toBeGreaterThan(fieldsToCheck(fill(base)));
    // Only the wording differs: a missing ZIP says it was not found.
    expect(Object.keys(stop(placeholder).fill?.checks ?? {}).sort()).toEqual(Object.keys(stop(missing).fill?.checks ?? {}).sort());
    expect(stop(missing).fill?.checks.zip).toBe('Not found in the PDF.');
  });

  it('00000, 00500 and a ZIP+4 of the same kind are all refused; 00501 and a real ZIP fill as before', () => {
    const base = readOf(STOPS_SECTION);
    for (const zip of ['00000', '00500', '00001-1234']) expect(fill(withZip(base, 0, zip)).stops[0]!.zip, zip).toBe('');
    expect(fill(withZip(base, 0, '00501')).stops[0]!.zip).toBe('00501');
    expect(fill(withZip(base, 0, '60450')).stops[0]!.zip).toBe('60450');
  });

  it('a real ZIP fills as before, source and all, and the other stop is untouched', () => {
    const form = fill(withZip(readOf(STOPS_SECTION), 0, '00001'));
    const stop2 = form.stops[1]!;
    expect(stop2.zip).toBe('58601');
    expect(stop2.fill?.checks.zip).toBeUndefined();
    expect(stop2.fill?.sources.zip).toBeDefined();
  });

  describe('a model read', () => {
    const lines = UNKNOWN_LAYOUT.map((l) => (l.text.startsWith('Fargo, ND') ? pdfLine(2, 'Fargo, ND 00001') : l));
    const reply = structuredClone(MODEL_REPLY);
    for (const f of ['city', 'state', 'zip'] as const) reply.stops[0]![f]!.quote = { line: 13, text: 'Fargo, ND 00001' };
    reply.stops[0]!.zip = { value: '00001', quote: { line: 13, text: 'Fargo, ND 00001' } };
    const read = (() => {
      const prepared = prepareForReading(lines);
      if (!prepared.ok) throw new Error(prepared.reason);
      const out = verifyRead(reply, prepared.lines, NOW);
      if (!out.ok) throw new Error(out.reason);
      return out.read;
    })();

    it('the verifier keeps what was printed; the form does not', () => {
      expect(read.stops[0]!.zip?.value).toBe('00001');
      const stop = fill(read).stops[0]!;
      expect(stop.zip).toBe('');
      expect(stop.fill?.checks.zip).toBe(ZIP_NOT_REAL);
      expect([stop.addressLine, stop.city, stop.state]).toEqual(['4001 Main St', 'Fargo', 'ND']);
    });

    it('the blank is a check, not an AI mark', () => {
      const form = fill(read);
      expect(aiMarkedFields(form.stops[0]!)).not.toContain('zip');
      expect(aiMarkedFields(form.stops[0]!).sort()).toEqual(['addressLine', 'appointment', 'city', 'state', 'stopType']);
      // The 12 fields of a good read, less the ZIP.
      expect(aiMarks(form)).toEqual({ stops: 2, fields: 11 });
    });
  });
});

describe('two-read agreement, through the fill (phase 3d)', () => {
  it('a field and an appointment the reads differed on are filled blank, each marked as differing', () => {
    const now = new Date('2026-10-13T15:00:00Z');
    const sent = prepareForReading(UNKNOWN_LAYOUT);
    if (!sent.ok) throw new Error(sent.reason);
    const verified = (reply: ModelRead) => {
      const v = verifyRead(reply, sent.lines, now);
      if (!v.ok) throw new Error(v.reason);
      return v.read;
    };
    const a = verified(MODEL_REPLY);
    const b = structuredClone(a);
    b.stops[0]!.zip = { value: '58103', source: { text: 'x', page: 2 } };
    const t = b.stops[0]!.time;
    if (t.kind !== 'range') throw new Error('stop 1 is a range');
    b.stops[0]!.time = { ...t, time: '09:00' };
    const merged = agreeReads(a, b).read;
    const filled = fillLoad(loadFormFrom(null, now.toISOString(), null), merged, now.toISOString(), now);
    if (!filled.ok) throw new Error(filled.message);
    const stop = filled.form.stops[0]!;
    expect(stop.zip).toBe('');
    expect(stop.fill?.checks.zip).toBe(`${AGREE_DIFFERED} Enter it by hand.`);
    expect(stop.appointment.date).toBe('');
    expect(stop.appointment.time).toBe('');
    expect(stop.fill?.checks.appointment).toMatch(new RegExp(`^${AGREE_DIFFERED}`));
    // What both said stands.
    expect(stop.addressLine).toBe('4001 Main St');
    expect(filled.form.stops[1]!.zip).toBe('55802');
  });
});

describe('an appointment the AI filled is never silent (phase 3v)', () => {
  const SAID = 'Check: the AI filled this appointment. Confirm the date and time against the PDF.';
  const prepared = prepareForReading(UNKNOWN_LAYOUT);
  if (!prepared.ok) throw new Error(prepared.reason);
  const verified = verifyRead(MODEL_REPLY, prepared.lines, NOW);
  if (!verified.ok) throw new Error(verified.reason);
  const MODEL: RateconRead = verified.read;

  /** The invented model read with its first stop's time replaced: same stops, same address, a time of the test's choosing. */
  const withTime = (time: TimeRead, layout: RateconRead['layout'] = 'model'): RateconRead => {
    const read = structuredClone(MODEL);
    read.stops[0]!.time = time;
    return { ...read, layout };
  };
  /** A window on the 14th (the `range` helper above starts on the 12th). */
  const win = (time: string, endTime: string, flag: 'APPT' | 'FCFS' | null = null): TimeRead => ({
    kind: 'range', date: '2026-10-14', time, endDate: '2026-10-14', endTime, flag, source: SOURCE,
  });
  const exact = (flag: 'APPT' | 'FCFS' | null = null, date = '2026-10-14'): TimeRead => ({ kind: 'exact', date, time: '08:00', flag, source: SOURCE });
  const appointmentCheck = (read: RateconRead, now = NOW) => fill(read, now).stops[0]!.fill?.checks.appointment;
  const times = (text: string | undefined) => (text ?? '').split(SAID).length - 1;

  it('says it in the words the neighbouring checks use', () => {
    expect(AI_APPOINTMENT_CHECK).toBe(SAID);
  });

  it('a confirmed exact time with nothing to flag: the appointment carries the check', () => {
    const form = fill(withTime(exact()));
    expect(form.stops[0]!.appointment).toMatchObject({ enabled: true, type: 'APPT', time: '08:00' });
    expect(form.stops[0]!.fill?.checks.appointment).toBe(SAID);
  });

  it('a window of two hours or less, nothing to flag: the same', () => {
    expect(appointmentCheck(withTime(win('08:00', '10:00')))).toBe(SAID);
    expect(appointmentCheck(withTime(win('08:00', '08:00')))).toBe(SAID);
  });

  it('an FCFS exact time: the old sentence first, then the new one', () => {
    expect(appointmentCheck(withTime(exact('FCFS')))).toBe(
      `Check: the PDF says FCFS but gives one time, so it is filled as an appointment at that time. ${SAID}`,
    );
  });

  it('an FCFS window of two hours or less: the old sentence first, then the new one', () => {
    const text = appointmentCheck(withTime(win('08:00', '10:00', 'FCFS')));
    expect(text).toBe(`Check: the PDF says FCFS; a window of 2 h is filled as an appointment window. ${SAID}`);
  });

  it('FCFS receiving hours (a longer window): the old sentence first, then the new one, once', () => {
    const read = withTime(win('08:00', '14:00', 'FCFS'));
    const form = fill(read);
    expect(form.stops[0]!.appointment).toMatchObject({ type: 'FCFS', time: '08:00', endTime: '14:00' });
    const text = form.stops[0]!.fill?.checks.appointment;
    expect(text).toMatch(/^Check: a window of 6 h \(08:00–14:00\) is longer than 2 hours, so it is filled as FCFS receiving hours\. /);
    expect(text?.endsWith(` ${SAID}`)).toBe(true);
    expect(times(text)).toBe(1);
  });

  it('a date check already there: the date sentence first, then the new one, once', () => {
    const later = new Date('2026-10-20T15:00:00Z');
    const text = appointmentCheck(withTime(exact()), later);
    expect(text).toBe(`Check: this date has passed. ${SAID}`);
    const far = appointmentCheck(withTime(exact(null, '2026-12-25')));
    expect(far).toBe(`Check: this date is more than 30 days out. ${SAID}`);
    expect(times(far)).toBe(1);
  });

  it('both an old sentence and a date check: old, date, new', () => {
    const later = new Date('2026-10-20T15:00:00Z');
    expect(appointmentCheck(withTime(exact('FCFS')), later)).toBe(
      `Check: the PDF says FCFS but gives one time, so it is filled as an appointment at that time. Check: this date has passed. ${SAID}`,
    );
  });

  it('every filled appointment of a read has it, whatever its kind', () => {
    const form = fill(MODEL);
    // The invented read: a 2-hour window on the pickup, and "Couldn\'t read" on the delivery.
    expect(form.stops[0]!.fill?.checks.appointment).toBe(SAID);
  });

  it('a blank appointment keeps only its own check: nothing is added', () => {
    const delivery = fill(MODEL).stops[1]!;
    expect(delivery.appointment).toMatchObject({ enabled: true, time: '' });
    expect(delivery.fill?.checks.appointment).toBe("Couldn't read: “Delivery same day by 8 PM, or next day 7-10 AM”.");
    const none = fill(withTime({ kind: 'none', source: null })).stops[0]!;
    expect(none.appointment.enabled).toBe(false);
    expect(none.fill?.checks.appointment).toBe('No date or time for this stop in the PDF.');
    const unreadable = fill(withTime({ kind: 'unreadable', date: '2026-10-14', quoted: 'Thursday morning', source: SOURCE })).stops[0]!;
    expect(unreadable.fill?.checks.appointment).toBe('Couldn\'t read: “Thursday morning”.');
  });

  it('an appointment the pair blanked and marked keeps only its own check', () => {
    const now = new Date('2026-10-13T15:00:00Z');
    const b = structuredClone(MODEL);
    const t = b.stops[0]!.time;
    if (t.kind !== 'range') throw new Error('stop 1 is a range');
    b.stops[0]!.time = { ...t, time: '09:00' };
    const merged = agreeReads(MODEL, b).read;
    const stop = fill(merged, now).stops[0]!;
    expect(stop.appointment.time).toBe('');
    expect(stop.fill?.checks.appointment).toBe(`${AGREE_DIFFERED} Enter it by hand.`);
    expect(stop.fill?.checks.appointment).not.toContain(SAID);
  });

  it('a read both reads agree on, filled: the check is there too (the case that was silent)', () => {
    const a = structuredClone(MODEL);
    const merged = agreeReads(MODEL, a).read;
    expect(fill(merged).stops[0]!.fill?.checks.appointment).toBe(SAID);
  });

  it('a template read with the same data: no AI check, and its fill is as before', () => {
    for (const layout of ['label-rows', 'pickup-delivery-columns', 'stops-section', 'pu-so-blocks', 'route-blocks'] as const) {
      const form = fill(withTime(exact(), layout));
      expect(form.stops[0]!.fill?.checks.appointment, layout).toBeUndefined();
      expect(form.stops[0]!.fill?.ai).toBeUndefined();
    }
    expect(appointmentCheck(withTime(exact('FCFS'), 'pu-so-blocks'))).toBe(
      'Check: the PDF says FCFS but gives one time, so it is filled as an appointment at that time.',
    );
  });

  it('the AI marks and the outcome counts behave as before: the appointment is still a filled field, counted as filled', () => {
    const form = fill(MODEL);
    expect(aiMarkedFields(form.stops[0]!)).toContain('appointment');
    expect(aiMarks(form)).toEqual({ stops: 2, fields: 12 });
    const cells = fillSnapshot(form).stops[0]!.cells;
    expect(cells.appointment).toMatchObject({ filled: true });
    const appointment = outcomeFields(fillSnapshot(form), form).find((f) => f.field === 'appointment');
    // The pickup's appointment kept; the delivery's, left blank and marked, left.
    expect(appointment).toMatchObject({ kept: 1, changed: 0, cleared: 0, blankFilled: 0, blankLeft: 1 });
  });

  it('"fields to check" counts it, once per filled appointment, and it falls when the appointment is edited', () => {
    const form = fill(MODEL);
    const edited = {
      ...form,
      stops: form.stops.map((s, i) => (i === 0 ? patchStop(s, { appointment: { ...s.appointment, time: '09:00' } }) : s)),
    };
    expect(edited.stops[0]!.fill?.checks.appointment).toBeUndefined();
    expect(fieldsToCheck(form) - fieldsToCheck(edited)).toBe(1);
    // "Looks right" clears the AI mark, not a check: as for any other check.
    const confirmed = confirmAiStop(form, form.stops[0]!.key);
    expect(confirmed.stops[0]!.fill?.checks.appointment).toBe(SAID);
    expect(fieldsToCheck(confirmed)).toBe(fieldsToCheck(form));
  });
});
