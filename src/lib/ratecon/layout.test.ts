import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SENTINEL, UNKNOWN_LAYOUT } from '@/test/model-read-fixtures';
import { prepareForReading } from './redact';
import { GROUP_SIMILARITY, MAX_LAYOUT_LABELS, groupLayouts, jaccard, labelTexts, layoutLabels, sha256Hex } from './layout';

/**
 * A layout fingerprint (docs/llm-reader-design.md §4; Alex, 2026-10-15): the
 * set of LABEL words in the text that was sent — the text just before a colon
 * or a "#" in a cell — each as 8 hex characters of a hash. So which layouts
 * recur can be counted, with no value, name, address or label text kept.
 * Every document here is invented.
 */

const lines = (...texts: string[]) => texts.map((text) => ({ text }));
const hash8 = (label: string) => createHash('sha256').update(label.toLowerCase()).digest('hex').slice(0, 8);

/** One broker's layout; `values` are the only thing that changes between two loads. */
const layoutA = (v: { load: string; shipper: string; street: string; date: string; time: string; weight: string }) =>
  lines(
    'Rate Confirmation  Load #: ' + v.load,
    `Shipper: ${v.shipper}`,
    `Address: ${v.street}`,
    `Pick Up Date: ${v.date}  Pick Up Time: ${v.time}`,
    'Consignee: Lakeside Distribution',
    'Delivery Date: 10/15/2026  Delivery Time: 11:00 Appt.',
    'Equipment: Reefer',
    'Commodity: Produce',
    `Weight: ${v.weight}`,
    'Special Handling: Keep cold',
  );
const A1 = layoutA({ load: 'EX-40417', shipper: 'Prairie Cold Storage', street: '4001 Main St', date: '10/14/2026', time: '08:00-15:00', weight: '40000' });
const A2 = layoutA({ load: 'ZQ-99120', shipper: 'Northwind Packing', street: '88 Orchard Ln', date: '11/02/2026', time: '1400', weight: '18250' });

/** A different broker: other words before the colons. */
const LAYOUT_B = lines(
  'ORDER CONFIRMATION',
  'Order ID: 5530021',
  'PU Name: Harbor Foods',
  'Stop Type: Pickup',
  'Reference No: 77120',
  'Dispatcher Notes: none',
  'Trailer Type: Dry van',
  'Miles: 412',
  'Driver Load: yes',
);

describe('the hash of a label', () => {
  it.each(['', 'a', 'pick up date', 'load', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(200), 'résumé', 'über', 'pickup — delivery'])(
    'sha256 of %j agrees with node\'s',
    (text) => {
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text).digest('hex'));
    },
  );
});

describe('which text is a label', () => {
  const texts = (...cells: string[]) => labelTexts(lines(cells.join('  ')));

  it.each([
    ['text before a colon', 'Pick Up Date: 10/14/2026', ['pick up date']],
    ['text before a hash', 'Load # EX-40417', ['load']],
    ['a hash right after the word', 'Appointment#: 5555', ['appointment']],
    ['a hash and a colon', 'Pro #: 12345', ['pro']],
    ['lower-cased, trimmed, a space before the colon', '  PICK UP DATE :  x', ['pick up date']],
    ['digits turned into nothing', 'Stop 2 Date: x', ['stop date']],
    ['a number glued to the word', 'Pickup1 Date: x', ['pickup date']],
    ['two labels in one cell', 'Pick Up Date: 10/14 Time: 08', ['pick up date', 'time']],
    ['the time after a label is not a label', 'Delivery Time: 11:00 Appt.', ['delivery time']],
    ['a clock alone is no label', '08:00-15:00', []],
    ['a one-letter label is too short', 'A: x', []],
    ['a letter and a digit is too short once digits go', 'B2: x', []],
    ['the last text, with no colon after it, is not a label', 'Questions? Call dispatch', []],
    ['a label after punctuation', 'Note - Gate Code: x', ['note - gate code']],
  ])('%s', (_, cell, want) => {
    expect(texts(cell)).toEqual(want);
  });

  it('a label of 41 characters is too long, 40 is not', () => {
    const forty = 'abcdefghi '.repeat(4).trim();
    expect(forty).toHaveLength(39);
    const long = `${'a'.repeat(19)} ${'b'.repeat(20)}`;
    expect(long).toHaveLength(40);
    expect(texts(`${long}: x`)).toEqual([long]);
    expect(texts(`${long}c: x`)).toEqual([]);
  });

  it('a run of more than five words is a sentence, not a label', () => {
    expect(texts('one two three four five: x')).toEqual(['one two three four five']);
    expect(texts('one two three four five six: x')).toEqual([]);
  });

  it('a cell with a placeholder is ignored whole, its labels too', () => {
    expect(texts('Phone: [PHONE]')).toEqual([]);
    expect(texts('Booked by: [REMOVED]')).toEqual([]);
    expect(texts('Rate: [AMOUNT]')).toEqual([]);
    expect(texts('Email: [EMAIL]')).toEqual([]);
    expect(texts('Pick Up Date: 10/14/2026 MC [ID]')).toEqual([]);
    // The cell next to it still counts.
    expect(texts('Phone: [PHONE]', 'Pick Up Date: 10/14/2026')).toEqual(['pick up date']);
  });

  it('cells are what the sent line joins with two spaces', () => {
    expect(texts('Shipper: Prairie Cold Storage', 'Consignee: Lakeside')).toEqual(['shipper', 'consignee']);
  });
});

describe('the fingerprint', () => {
  it('is 8 lower-case hex characters a label, sorted, and each label once', () => {
    const f = layoutLabels(lines('Load #: a', 'Load #: b', 'Pick Up Date: c', 'Weight: d'));
    expect(f).toEqual([hash8('load'), hash8('pick up date'), hash8('weight')].sort());
    for (const h of f) expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(f).toEqual([...f].sort());
  });

  it('two documents with the same layout and different values give the same label set', () => {
    expect(layoutLabels(A1)).toEqual(layoutLabels(A2));
    expect(layoutLabels(A1).length).toBeGreaterThan(8);
  });

  it('a different layout has a Jaccard below 0.3', () => {
    expect(jaccard(layoutLabels(A1), layoutLabels(LAYOUT_B))).toBeLessThan(0.3);
  });

  it('a document with an optional extra label stays above 0.7', () => {
    const extra = [...A1, ...lines('Gate Code: 4471')];
    expect(jaccard(layoutLabels(A1), layoutLabels(extra))).toBeGreaterThan(0.7);
    const fewer = A1.filter((l) => !l.text.startsWith('Special Handling'));
    expect(jaccard(layoutLabels(A1), layoutLabels(fewer))).toBeGreaterThan(0.7);
  });

  it('is stable across line order and cell order', () => {
    const shuffled = [...A1].reverse().map((l) => ({ text: l.text.split('  ').reverse().join('  ') }));
    expect(layoutLabels(shuffled)).toEqual(layoutLabels(A1));
  });

  it('keeps at most 64 labels, the same 64 whatever the order', () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ text: `Label ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}x: v` }));
    expect(many.length).toBe(150);
    const f = layoutLabels(many);
    expect(MAX_LAYOUT_LABELS).toBe(64);
    // 150 distinct labels in, 64 out.
    expect(labelTexts(many)).toHaveLength(150);
    expect(f).toHaveLength(64);
    expect(layoutLabels([...many].reverse())).toEqual(f);
    // The 64 smallest hashes of the 150.
    const all = labelTexts(many).map(hash8).sort();
    expect(f).toEqual(all.slice(0, 64));
  });

  it('exactly 64 labels are all kept', () => {
    const sixtyFour = Array.from({ length: 64 }, (_, i) => ({ text: `Field ${'abcdefghijklmnop'[i % 16]}${'qrstuvwx'[Math.floor(i / 16)]}z: v` }));
    expect(layoutLabels(sixtyFour)).toHaveLength(64);
  });

  it('a document with no label has an empty fingerprint, and an empty one is similar to nothing', () => {
    expect(layoutLabels(lines('just words', 'and more words'))).toEqual([]);
    expect(jaccard([], [])).toBe(0);
    expect(jaccard([], layoutLabels(A1))).toBe(0);
  });

  it('the invented sent document: its labels are labels, and the text it was made from is not in them', () => {
    const sent = prepareForReading(UNKNOWN_LAYOUT);
    if (!sent.ok) throw new Error(sent.reason);
    const labels = labelTexts(sent.lines);
    expect(labels.join(' ')).not.toContain(SENTINEL);
    expect(layoutLabels(sent.lines)).toEqual([...new Set(labels.map(hash8))].sort().slice(0, 64));
  });
});

describe('a value or a name never enters', () => {
  it('a planted name, address and load number are in no hash, whatever else is in the fingerprint', () => {
    const PLANTED = ['Zorblat', 'Quenby', 'Fennimore', 'Wexcombe', 'ZQ-99120', '4417', 'Harbor', '88 Orchard Ln', '55802'];
    const doc = lines(
      'Rate Confirmation  Load #: ZQ-99120',
      'Shipper: Zorblat Quenby',
      'Address: 88 Orchard Ln  Duluth, MN 55802',
      'Pick Up Date: 10/14/2026  Pick Up Time: 08:00-15:00',
      'Driver: [REMOVED]',
      'Note: Fennimore Wexcombe signs for Harbor dock 4417',
      'Questions go to Zorblat Quenby at ACME FREIGHT INC',
    );
    const f = layoutLabels(doc);
    const words = PLANTED.flatMap((p) => [p, p.toLowerCase(), ...p.split(' ')]);
    for (const w of words) expect(f, w).not.toContain(hash8(w));
    expect(JSON.stringify(f)).not.toMatch(/zorblat|quenby|fennimore|wexcombe|orchard|harbor|55802|99120/i);
    // And the labels that are there are the labels.
    expect(f).toEqual(expect.arrayContaining([hash8('load'), hash8('shipper'), hash8('address'), hash8('pick up date'), hash8('note')]));
  });

  it('the fingerprint is hashes only: it carries no cell text, not even a short one', () => {
    for (const h of layoutLabels(A1)) expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(layoutLabels(A1))).not.toMatch(/load|shipper|date/i);
  });
});

describe('jaccard', () => {
  it('is intersection over union', () => {
    expect(jaccard(['a', 'b', 'c'], ['b', 'c', 'd'])).toBe(0.5);
    expect(jaccard(['a', 'b'], ['a', 'b'])).toBe(1);
    expect(jaccard(['a'], ['b'])).toBe(0);
  });

  it('does not change with order or duplicates', () => {
    expect(jaccard(['c', 'a', 'a', 'b'], ['b', 'a', 'c'])).toBe(1);
  });
});

describe('groups: a read joins the earliest read it is 0.7 similar to', () => {
  const at = (n: number) => `2026-10-14T10:00:0${n}Z`;
  const item = (id: string, n: number, labels: string[]) => ({ id, at: at(n), labels });

  it('the threshold is 0.7', () => {
    expect(GROUP_SIMILARITY).toBe(0.7);
  });

  it('the same layout is one group, another layout is another', () => {
    const out = groupLayouts([item('r1', 1, layoutLabels(A1)), item('r2', 2, layoutLabels(LAYOUT_B)), item('r3', 3, layoutLabels(A2))]);
    expect(out.groups.map((g) => g.ids)).toEqual([['r1', 'r3'], ['r2']]);
    expect(out.groups.map((g) => g.anchor)).toEqual(['r1', 'r2']);
    expect(out.unlabelled).toEqual([]);
  });

  it('exactly 0.7 joins; just under does not', () => {
    const base = Array.from({ length: 10 }, (_, i) => `h${i}`);
    const join = [...base.slice(0, 7), 'x1', 'x2', 'x3'];
    expect(jaccard(base, [...base.slice(0, 7)])).toBe(0.7);
    expect(groupLayouts([item('a', 1, base), item('b', 2, base.slice(0, 7))]).groups).toHaveLength(1);
    expect(jaccard(base, join)).toBeCloseTo(7 / 13);
    expect(groupLayouts([item('a', 1, base), item('b', 2, join)]).groups).toHaveLength(2);
  });

  it('the earliest read is the anchor, whatever the order given; ties go by id', () => {
    const out = groupLayouts([item('late', 3, layoutLabels(A2)), item('early', 1, layoutLabels(A1))]);
    expect(out.groups).toEqual([{ anchor: 'early', ids: ['early', 'late'] }]);
    const tie = groupLayouts([
      { id: 'b', at: at(1), labels: layoutLabels(A1) },
      { id: 'a', at: at(1), labels: layoutLabels(A2) },
    ]);
    expect(tie.groups).toEqual([{ anchor: 'a', ids: ['a', 'b'] }]);
  });

  it('is not transitive: a read counts with the earliest read it is similar to, and only that one', () => {
    const a = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
    const b = [...a.slice(2), 'x', 'y']; // 8 of 12 with a: under 0.7
    const c = b.slice(2); // 8 of 10 with b: over; 6 of 12 with a: under
    expect(jaccard(a, b)).toBeLessThan(0.7);
    expect(jaccard(b, c)).toBeGreaterThanOrEqual(0.7);
    expect(jaccard(a, c)).toBeLessThan(0.7);
    const out = groupLayouts([item('a', 1, a), item('b', 2, b), item('c', 3, c)]);
    expect(out.groups.map((g) => g.ids)).toEqual([['b', 'c'], ['a']].sort((x, y) => y.length - x.length));
  });

  it('a read with no labels is in no group, and is told apart', () => {
    const out = groupLayouts([item('r1', 1, layoutLabels(A1)), item('empty', 2, []), item('empty2', 3, [])]);
    expect(out.groups.map((g) => g.ids)).toEqual([['r1']]);
    expect(out.unlabelled).toEqual(['empty', 'empty2']);
  });

  it('largest group first', () => {
    const out = groupLayouts([
      item('b1', 1, layoutLabels(LAYOUT_B)),
      item('a1', 2, layoutLabels(A1)),
      item('a2', 3, layoutLabels(A2)),
      item('a3', 4, layoutLabels(A1)),
    ]);
    expect(out.groups.map((g) => g.ids.length)).toEqual([3, 1]);
  });
});
