import { describe, expect, it } from 'vitest';
import { LABEL_ROWS, PU_SO, STOPS_SECTION, puSoBlocks, type BlockStop } from '@/test/ratecon-fixtures';
import type { TinyRun } from '@/test/tiny-pdf';
import { linesFromRuns } from '@/lib/ratecon/lines';
import { readRatecon, type RateconRead, type Source, type TimeRead } from '@/lib/ratecon/templates';
import { loadFormFrom, patchStop, type LoadForm } from './load-form';
import { TOO_MANY_STOPS, appointmentFrom, fieldsToCheck, fillLoad, sourceLine } from './ratecon-fill';

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
