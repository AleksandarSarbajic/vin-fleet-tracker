import { describe, expect, it } from 'vitest';
import { MODEL_REPLY, UNKNOWN_LAYOUT } from '@/test/model-read-fixtures';
import { AGREE_DIFFERED, agreePair, agreeReads } from './agree-reads';
import { prepareForReading } from './redact';
import type { RateconRead, StopRead, TimeRead } from './templates';
import { verifyRead } from './verify-read';

/**
 * Two-read agreement (phase 3d): two VERIFIED reads of the same document,
 * merged so that only what both said stands. Invented reads only: the
 * invented reply, verified against the invented document, then changed.
 */

const NOW = new Date('2026-10-13T15:00:00Z');
const base = (): RateconRead => {
  const sent = prepareForReading(UNKNOWN_LAYOUT);
  if (!sent.ok) throw new Error(sent.reason);
  const v = verifyRead(MODEL_REPLY, sent.lines, NOW);
  if (!v.ok) throw new Error(v.reason);
  return structuredClone(v.read);
};
const withStop = (read: RateconRead, i: number, patch: Partial<StopRead>): RateconRead => ({
  ...read,
  stops: read.stops.map((s, k) => (k === i ? { ...s, ...patch } : s)),
});
const src = { text: 'anything', page: 2 };

describe('two reads that agree', () => {
  it('merge to the same read, with no notice and nothing differed', () => {
    const out = agreeReads(base(), base());
    expect(out.read).toEqual(base());
    expect(out.notices).toEqual([]);
    expect(out.differed).toEqual([]);
    expect(out.stopCounts).toBeNull();
  });

  it('agreeing on a blank keeps the blank and its own mark', () => {
    const a = withStop(base(), 0, { zip: null, fieldChecks: { zip: 'Read by AI, but it does not follow.' } });
    const b = withStop(base(), 0, { zip: null });
    const out = agreeReads(a, b);
    expect(out.read.stops[0]!.zip).toBeNull();
    expect(out.read.stops[0]!.fieldChecks?.zip).toBe('Read by AI, but it does not follow.');
    expect(out.differed).toEqual([]);
  });

  it('two appointments neither read confirmed stay as they are: blank or unconfirmed is not a difference', () => {
    const unread: TimeRead = { kind: 'unreadable', date: null, quoted: 'x', source: src };
    const none: TimeRead = { kind: 'none', source: null };
    const out = agreeReads(withStop(base(), 0, { time: unread }), withStop(base(), 0, { time: none }));
    expect(out.read.stops[0]!.time).toEqual(unread);
    expect(out.differed).toEqual([]);
  });
});

describe('a field that differs is blanked and marked', () => {
  it.each([
    ['street', { street: { value: '9 Other Rd', source: src } }],
    ['city', { city: { value: 'Moorhead', source: src } }],
    ['state', { state: { value: 'MN', source: src } }],
    ['zip', { zip: { value: '58103', source: src } }],
  ] as const)('%s', (field, patch) => {
    const out = agreeReads(base(), withStop(base(), 0, patch));
    expect(out.read.stops[0]![field]).toBeNull();
    expect(out.read.stops[0]!.fieldChecks?.[field]).toMatch(new RegExp(`^${AGREE_DIFFERED}`));
    expect(out.differed).toEqual([{ stop: 1, field }]);
    // The other stop, and the other fields, untouched.
    expect(out.read.stops[1]).toEqual(base().stops[1]);
    expect(out.read.stops[0]!.street ?? null).toEqual(field === 'street' ? null : base().stops[0]!.street);
  });

  it('one read filled, the other left it blank: that is a difference too', () => {
    const out = agreeReads(base(), withStop(base(), 1, { city: null }));
    expect(out.read.stops[1]!.city).toBeNull();
    expect(out.differed).toEqual([{ stop: 2, field: 'city' }]);
  });

  it.each([
    ['the date', { date: '2026-10-15' }],
    ['the start time', { time: '09:00' }],
    ['the end time (the window)', { endTime: '11:00' }],
    ['the end date', { endDate: '2026-10-15' }],
    ['the flag (APPT or FCFS)', { flag: 'FCFS' as const }],
  ])('an appointment: %s differs, and the whole appointment is blanked and marked', (_, change) => {
    const a = base();
    const time = a.stops[0]!.time;
    if (time.kind !== 'range') throw new Error('the invented stop 1 is a range');
    const out = agreeReads(a, withStop(base(), 0, { time: { ...time, ...change } }));
    const merged = out.read.stops[0]!;
    expect(merged.time.kind).toBe('unreadable');
    expect(merged.time.kind === 'unreadable' ? merged.time.date : 'x').toBeNull();
    expect(merged.timeCheck).toMatch(new RegExp(`^${AGREE_DIFFERED}`));
    expect(out.differed).toEqual([{ stop: 1, field: 'appointment' }]);
  });

  it('an appointment one read confirmed and the other did not is a difference', () => {
    const out = agreeReads(base(), withStop(base(), 0, { time: { kind: 'none', source: null } }));
    expect(out.read.stops[0]!.time.kind).toBe('unreadable');
    expect(out.differed).toEqual([{ stop: 1, field: 'appointment' }]);
  });

  it('an exact time against a range is a difference', () => {
    const exact: TimeRead = { kind: 'exact', date: '2026-10-14', time: '08:00', flag: 'APPT', source: src };
    expect(agreeReads(base(), withStop(base(), 0, { time: exact })).differed).toEqual([{ stop: 1, field: 'appointment' }]);
  });

  it('the type: no blank exists for it, so the value of the base read stays, marked', () => {
    const out = agreeReads(base(), withStop(base(), 1, { type: { value: 'PU', source: src } }));
    expect(out.read.stops[1]!.type.value).toBe('DEL');
    expect(out.read.stops[1]!.typeCheck).toMatch(new RegExp(`^${AGREE_DIFFERED}`));
    expect(out.differed).toEqual([{ stop: 2, field: 'type' }]);
  });

  it('the load number, by value; and one read without it', () => {
    const other = { ...base(), loadNumber: { value: 'EX-40418', source: src } };
    const out = agreeReads(base(), other);
    expect(out.read.loadNumber).toBeNull();
    expect(out.read.loadNumberCheck).toMatch(new RegExp(`^${AGREE_DIFFERED}`));
    expect(out.differed).toEqual([{ stop: null, field: 'load number' }]);
    expect(agreeReads(base(), { ...base(), loadNumber: null, loadNumberCheck: 'none found' }).read.loadNumber).toBeNull();
  });

  it('both without a load number: as it was', () => {
    const none = { ...base(), loadNumber: null, loadNumberCheck: 'The AI found no load number in the text.' };
    const out = agreeReads(none, none);
    expect(out.read.loadNumberCheck).toBe('The AI found no load number in the text.');
    expect(out.differed).toEqual([]);
  });

  it('says how many fields differed, in a notice', () => {
    const out = agreeReads(base(), withStop(withStop(base(), 0, { zip: null }), 1, { street: null }));
    expect(out.notices).toEqual(['The two AI reads differed on 2 fields; each is left blank and marked.']);
  });
});

describe('the stop count differs', () => {
  const one = (): RateconRead => ({ ...base(), stops: [base().stops[0]!] });

  it('the read with MORE stops gives the stops, whichever it is; a notice names both counts', () => {
    for (const [a, b] of [
      [base(), one()],
      [one(), base()],
    ] as const) {
      const out = agreeReads(a, b);
      expect(out.read.stops).toHaveLength(2);
      expect(out.read.stops[1]).toEqual(base().stops[1]);
      expect(out.stopCounts).toEqual({ a: a.stops.length, b: b.stops.length });
      expect(out.notices[0]).toBe(
        `The two AI reads found ${a.stops.length} and ${b.stops.length} stops. The ${2} shown are the read with more; check each against the document.`,
      );
    }
  });

  it('the stops both have are still compared, index by index', () => {
    const out = agreeReads(base(), withStop(one(), 0, { zip: { value: '58103', source: src } }));
    expect(out.read.stops[0]!.zip).toBeNull();
    expect(out.differed).toEqual([{ stop: 1, field: 'zip' }]);
  });

  it('a stop dropped from the MIDDLE misaligns the rest: those compare as different and are blanked (the cost of comparing by index)', () => {
    const three: RateconRead = { ...base(), stops: [base().stops[0]!, { ...base().stops[1]!, zip: { value: '55801', source: src } }, base().stops[1]!] };
    const out = agreeReads(three, base());
    expect(out.read.stops).toHaveLength(3);
    expect(out.differed).toEqual([{ stop: 2, field: 'zip' }]);
    expect(out.read.stops[2]).toEqual(base().stops[1]);
  });
});

describe('the result is what fillLoad takes', () => {
  it("layout 'model', always", () => {
    expect(agreeReads(base(), base()).read.layout).toBe('model');
  });

  it('does not change its inputs', () => {
    const a = base();
    const b = withStop(base(), 0, { zip: null });
    const before = [structuredClone(a), structuredClone(b)];
    agreeReads(a, b);
    expect([a, b]).toEqual(before);
  });
});

describe('agreePair: the caller contract — a pair where either read fails fails as a whole (Alex, 2026-10-14)', () => {
  const ok = (read = base()) => ({ ok: true as const, read });
  const failed = (code: string) => ({ ok: false as const, code });

  it('both reads verified: their agreement', () => {
    const out = agreePair(ok(), ok(withStop(base(), 0, { zip: null })));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.agreement.differed).toEqual([{ stop: 1, field: 'zip' }]);
  });

  it.each([
    ['read A failed at the adapter', failed('timeout'), ok(), 'timeout'],
    ['read B failed the schema', ok(), failed('invalid_output'), 'invalid_output'],
    ['read B had nothing confirmed', ok(), failed('nothing_confirmed'), 'nothing_confirmed'],
    ["both failed: read A's code", failed('unavailable'), failed('refused'), 'unavailable'],
  ] as const)('%s: the pair fails with that code, and there is no read to fill', (_, a, b, code) => {
    const out = agreePair(a, b);
    expect(out).toEqual({ ok: false, code });
    expect('agreement' in out).toBe(false);
  });
});
