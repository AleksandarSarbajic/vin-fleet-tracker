import { describe, expect, it } from 'vitest';
import { MODEL_REPLY, SENTINEL, UNKNOWN_LAYOUT } from '@/test/model-read-fixtures';
import { prepareForReading } from '@/lib/ratecon/redact';
import { verifyRead } from '@/lib/ratecon/verify-read';
import { OUTCOME_FIELDS } from '@/lib/ratecon/outcome-codes';
import { loadFormFrom, patchStop, removeStop, type LoadForm } from './load-form';
import { fillLoad } from './ratecon-fill';
import { fillSnapshot, outcomeFields } from './fill-outcome';

/**
 * What the dispatcher did with an AI fill, by field NAME and by outcome
 * (Alex, 2026-10-14): pure, counts only. Invented document; the fill is the
 * real one, then edited the way a dispatcher would.
 *
 * MODEL_REPLY fills the load number, and per stop: the type, street, city,
 * state and ZIP; stop 1's appointment too. Stop 2's appointment is read but
 * unclear, so it is left blank and marked ("Couldn't read").
 */

const NOW = new Date('2026-10-10T15:00:00.000Z');
const OPENED = NOW.toISOString();

const aiFilled = (reply = MODEL_REPLY, lines = UNKNOWN_LAYOUT): LoadForm => {
  const prepared = prepareForReading(lines);
  if (!prepared.ok) throw new Error(prepared.reason);
  const verified = verifyRead(reply, prepared.lines, NOW);
  if (!verified.ok) throw new Error(verified.reason);
  const filled = fillLoad(loadFormFrom(null, OPENED, null), { ...verified.read }, OPENED, NOW);
  if (!filled.ok) throw new Error(filled.message);
  return filled.form;
};

const edit = (form: LoadForm, i: number, patch: Parameters<typeof patchStop>[1]): LoadForm => ({
  ...form,
  stops: form.stops.map((s, k) => (k === i ? patchStop(s, patch) : s)),
});

const counts = (form: LoadForm, saved: LoadForm) => outcomeFields(fillSnapshot(form), saved);
const byField = (rows: ReturnType<typeof outcomeFields>) => Object.fromEntries(rows.map(({ field, ...c }) => [field, c]));
const zero = { kept: 0, changed: 0, cleared: 0, blankFilled: 0, blankLeft: 0 };

describe('a fill saved as it was', () => {
  it('every field it filled is kept, and the one it left blank and marked stays blank', () => {
    const form = aiFilled();
    expect(byField(counts(form, form))).toEqual({
      load_number: { ...zero, kept: 1 },
      stop_type: { ...zero, kept: 2 },
      street: { ...zero, kept: 2 },
      city: { ...zero, kept: 2 },
      state: { ...zero, kept: 2 },
      zip: { ...zero, kept: 2 },
      appointment: { ...zero, kept: 1, blankLeft: 1 },
    });
  });

  it('rows come in the list\'s order, one a field name', () => {
    const form = aiFilled();
    const rows = counts(form, form);
    expect(rows.map((r) => r.field)).toEqual([...OUTCOME_FIELDS]);
  });
});

describe('kept, changed, cleared', () => {
  it('a street retyped is changed, and the other stop\'s is kept: counts sum over stops', () => {
    const form = aiFilled();
    const saved = edit(form, 0, { addressLine: '4003 Main St' });
    expect(byField(counts(form, saved)).street).toEqual({ ...zero, kept: 1, changed: 1 });
  });

  it('a field emptied is cleared, not changed', () => {
    const form = aiFilled();
    const saved = edit(edit(form, 1, { city: '' }), 0, { zip: '   ' });
    const by = byField(counts(form, saved));
    expect(by.city).toEqual({ ...zero, kept: 1, cleared: 1 });
    expect(by.zip).toEqual({ ...zero, kept: 1, cleared: 1 });
  });

  it('a field edited and put back is kept: the value is compared, not the keystrokes', () => {
    const form = aiFilled();
    const saved = edit(edit(form, 0, { addressLine: 'something else' }), 0, { addressLine: form.stops[0]!.addressLine });
    expect(byField(counts(form, saved)).street).toEqual({ ...zero, kept: 2 });
  });

  it('a space added or removed at the ends is not a change', () => {
    const form = aiFilled();
    const saved = edit(form, 0, { addressLine: `  ${form.stops[0]!.addressLine} ` });
    expect(byField(counts(form, saved)).street).toEqual({ ...zero, kept: 2 });
  });

  it('the load number: changed, cleared, kept', () => {
    const form = aiFilled();
    expect(byField(counts(form, { ...form, loadNumber: 'OTHER-1' })).load_number).toEqual({ ...zero, changed: 1 });
    expect(byField(counts(form, { ...form, loadNumber: '' })).load_number).toEqual({ ...zero, cleared: 1 });
    expect(byField(counts(form, form)).load_number).toEqual({ ...zero, kept: 1 });
  });

  it('the stop type flipped is changed', () => {
    const form = aiFilled();
    const saved = edit(form, 0, { stopType: form.stops[0]!.stopType === 'PU' ? 'DEL' : 'PU' });
    expect(byField(counts(form, saved)).stop_type).toEqual({ ...zero, kept: 1, changed: 1 });
  });

  it('an appointment: a new time is changed, unticked is cleared', () => {
    const form = aiFilled();
    const retimed = edit(form, 0, { appointment: { ...form.stops[0]!.appointment, time: '09:30' } });
    expect(byField(counts(form, retimed)).appointment).toEqual({ ...zero, changed: 1, blankLeft: 1 });
    const off = edit(form, 0, { appointment: { ...form.stops[0]!.appointment, enabled: false } });
    expect(byField(counts(form, off)).appointment).toEqual({ ...zero, cleared: 1, blankLeft: 1 });
  });

  it('the zone following the address is not an appointment change', () => {
    const form = aiFilled();
    const saved = edit(form, 0, { appointment: { ...form.stops[0]!.appointment, tz: 'America/Denver' } });
    expect(byField(counts(form, saved)).appointment).toEqual({ ...zero, kept: 1, blankLeft: 1 });
  });
});

describe('a field the read left blank and marked', () => {
  it('filled by the dispatcher is blank-filled', () => {
    const form = aiFilled();
    const saved = edit(form, 1, { appointment: { ...form.stops[1]!.appointment, enabled: true, type: 'APPT', date: '2026-10-15', time: '07:00', windowMinutes: 0 } });
    expect(byField(counts(form, saved)).appointment).toEqual({ ...zero, kept: 1, blankFilled: 1 });
  });

  it('left blank is blank-left', () => {
    const form = aiFilled();
    expect(byField(counts(form, form)).appointment?.blankLeft).toBe(1);
  });

  it('a blank street (not found) that the dispatcher types is blank-filled', () => {
    const reply = structuredClone(MODEL_REPLY);
    reply.stops[0]!.street = { value: '4001 Main St', quote: { line: 1, text: 'not in the text' } };
    const form = aiFilled(reply);
    expect(form.stops[0]!.addressLine).toBe('');
    const saved = edit(form, 0, { addressLine: '4001 Main St' });
    expect(byField(counts(form, saved)).street).toEqual({ ...zero, kept: 1, blankFilled: 1 });
    expect(byField(counts(form, form)).street).toEqual({ ...zero, kept: 1, blankLeft: 1 });
  });
});

describe('a field the read left blank that already held what the dispatcher had typed', () => {
  /** The dispatcher typed a load number, then "Replace"d with a read that found none: the form keeps theirs. */
  const typedFirst = () => {
    const reply = structuredClone(MODEL_REPLY);
    reply.loadNumber = null;
    const prepared = prepareForReading(UNKNOWN_LAYOUT);
    if (!prepared.ok) throw new Error(prepared.reason);
    const verified = verifyRead(reply, prepared.lines, NOW);
    if (!verified.ok) throw new Error(verified.reason);
    const filled = fillLoad({ ...loadFormFrom(null, OPENED, null), loadNumber: 'MINE-1' }, verified.read, OPENED, NOW);
    if (!filled.ok) throw new Error(filled.message);
    return filled.form;
  };

  it('left as typed is blank-left: that is not the dispatcher filling what the read left blank', () => {
    const form = typedFirst();
    expect(form.loadNumber).toBe('MINE-1');
    expect(byField(counts(form, form)).load_number).toEqual({ ...zero, blankLeft: 1 });
  });

  it('changed after the fill is blank-filled', () => {
    const form = typedFirst();
    expect(byField(counts(form, { ...form, loadNumber: 'OTHER-2' })).load_number).toEqual({ ...zero, blankFilled: 1 });
  });
});

describe('stops the dispatcher added or removed', () => {
  it('a removed stop\'s filled fields are cleared, and its blank field stays blank', () => {
    const form = aiFilled();
    const saved = removeStop(form, form.stops[1]!.key);
    const by = byField(counts(form, saved));
    expect(by.street).toEqual({ ...zero, kept: 1, cleared: 1 });
    expect(by.stop_type).toEqual({ ...zero, kept: 1, cleared: 1 });
    expect(by.appointment).toEqual({ ...zero, kept: 1, blankLeft: 1 });
  });

  it('a stop added after the fill is not the read\'s: nothing is counted for it', () => {
    const form = aiFilled();
    const extra = { ...form.stops[0]!, key: 'new-9', fill: null };
    const saved = { ...form, stops: [...form.stops, extra] };
    expect(counts(form, saved)).toEqual(counts(form, form));
  });
});

describe('a form the read filled nothing in', () => {
  it('gives no rows: there is nothing to record', () => {
    const empty = loadFormFrom(null, OPENED, null);
    expect(counts(empty, empty)).toEqual([]);
  });

  it('a fill from a template (no AI mark) gives no rows either', () => {
    const form = aiFilled();
    const template: LoadForm = { ...form, fill: form.fill && { layout: 'stops-section', loadNumber: form.fill.loadNumber, loadNumberCheck: null }, stops: form.stops.map((s) => ({ ...s, fill: s.fill && { sources: s.fill.sources, checks: s.fill.checks } })) };
    expect(counts(template, template)).toEqual([]);
  });
});

describe('only counts leave', () => {
  it('no value, text or sentinel is in the rows, whatever the form holds', () => {
    const form = aiFilled();
    const saved = edit(edit(form, 0, { addressLine: `4001 Main St ${SENTINEL}`, city: SENTINEL }), 1, { zip: SENTINEL });
    const rows = counts(form, { ...saved, loadNumber: SENTINEL });
    const json = JSON.stringify(rows);
    expect(json).not.toContain(SENTINEL);
    expect(json).not.toContain('Main');
    expect(json).not.toContain('Fargo');
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['blankFilled', 'blankLeft', 'changed', 'cleared', 'field', 'kept']);
      expect(OUTCOME_FIELDS).toContain(row.field);
      for (const n of [row.kept, row.changed, row.cleared, row.blankFilled, row.blankLeft]) expect(Number.isInteger(n) && n >= 0 && n <= 10).toBe(true);
    }
  });

  it('the snapshot is taken at the fill: later edits to the form do not move it', () => {
    const form = aiFilled();
    const snapshot = fillSnapshot(form);
    const saved = edit(form, 0, { addressLine: 'changed after' });
    expect(byField(outcomeFields(snapshot, saved)).street).toEqual({ ...zero, kept: 1, changed: 1 });
    expect(byField(outcomeFields(fillSnapshot(saved), saved)).street?.changed).toBe(0);
  });
});
