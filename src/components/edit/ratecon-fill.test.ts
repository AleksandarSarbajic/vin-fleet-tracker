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
  aiMarks,
  appointmentFrom,
  confirmAiLoadNumber,
  confirmAiStop,
  fieldsToCheck,
  fillLoad,
  sourceLine,
} from './ratecon-fill';

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
