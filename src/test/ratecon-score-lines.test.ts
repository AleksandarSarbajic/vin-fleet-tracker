import { describe, expect, it } from 'vitest';
import { loadFormFrom, stopFormFrom, type FillField, type LoadForm, type StopForm } from '@/components/edit/load-form';
import type { ExpectedStop } from '../../scripts/ratecon-expected.mjs';
import {
  expectedNotReadLine,
  markOf,
  newTally,
  notReadLine,
  notReadWhy,
  sampleMark,
  scoreSample,
  scoredLines,
  summaryLines,
  tallyFailed,
  tallyScored,
  type SampleScore,
} from '../../scripts/ratecon-score-lines.mjs';

/**
 * What `ratecon:score` prints (phase 3az): `pass`, `FAIL (marked)` or
 * `FAIL` per field, the sample's own line, why a sample was not read, and the
 * last lines. Invented loads, addresses and times only.
 */

const OPENED = '2026-10-13T15:00:00.000Z';

const WANT_STOPS: ExpectedStop[] = [
  { type: 'PU', street: '4001 Main St', city: 'Fargo', state: 'ND', zip: '58102', appointment: { type: 'APPT', date: '2026-10-14', time: '08:00', windowMinutes: 120 } },
  { type: 'DEL', street: '220 Harbor Rd', city: 'Duluth', state: 'MN', zip: '55802', appointment: { type: 'APPT', date: '2026-10-15', time: '13:30', windowMinutes: 0 } },
];
const WANT = { loadNumber: 'EX-40417', stops: WANT_STOPS };

/** A stop filled as its truth says, with `patch` over it and a Check on each field in `checks`. */
const stop = (w: ExpectedStop, patch: Partial<StopForm> = {}, checks: FillField[] = []): StopForm => {
  const s = stopFormFrom(null, OPENED);
  const a = w.appointment;
  return {
    ...s,
    stopType: w.type,
    addressLine: w.street,
    city: w.city,
    state: w.state,
    zip: w.zip,
    appointment: 'type' in a && a.type === 'APPT' ? { ...s.appointment, enabled: true, type: 'APPT', date: a.date, time: a.time, windowMinutes: a.windowMinutes } : s.appointment,
    ...patch,
    fill: { sources: {}, checks: Object.fromEntries(checks.map((f) => [f, 'Check it.'])) },
  };
};

const form = (stops: StopForm[], loadNumber = WANT.loadNumber, loadNumberCheck: string | null = null): LoadForm => ({
  ...loadFormFrom(null, OPENED, null),
  loadNumber,
  stops,
  fill: { layout: 'stop-detail', loadNumber: null, loadNumberCheck },
});

const right = () => form([stop(WANT_STOPS[0]!), stop(WANT_STOPS[1]!)]);

const markIn = (score: SampleScore, field: string, stopIndex: number) => score.stops.find(([name]) => name === field)![1][stopIndex];

describe('markOf', () => {
  it.each([
    [true, false, 'pass'],
    [true, true, 'pass'],
    [false, true, 'FAIL (marked)'],
    [false, false, 'FAIL'],
  ] as const)('right %s, marked %s: %s', (r, m, want) => {
    expect(markOf(r, m)).toBe(want);
  });
});

describe('scoreSample: each bar field, right or wrong, marked or not', () => {
  it('all right and unmarked: every field pass', () => {
    const score = scoreSample(right(), WANT);
    expect(score.load).toEqual([['load number', 'pass'], ['stop count', 'pass']]);
    for (const [, marks] of score.stops) expect(marks).toEqual(['pass', 'pass']);
    expect(score.appointments).toEqual(['exact', 'exact']);
  });

  /** Each stop field: its name in the score, the fill's key for its Check, and a wrong value for a stop. */
  const STOP_CASES: readonly (readonly [string, FillField, (w: ExpectedStop) => Partial<StopForm>])[] = [
    ['order + type', 'stopType', (w) => ({ stopType: w.type === 'PU' ? 'DEL' : 'PU' })],
    ['street', 'addressLine', (w) => ({ addressLine: `${w.street} Ext` })],
    ['ZIP', 'zip', (w) => ({ zip: `${w.zip.slice(0, 4)}9` })],
    ['city', 'city', (w) => ({ city: `${w.city}o` })],
    ['state', 'state', (w) => ({ state: w.state === 'SD' ? 'ND' : 'SD' })],
  ];

  it.each(STOP_CASES)('%s: right and marked is pass', (name, key) => {
    const score = scoreSample(form([stop(WANT_STOPS[0]!, {}, [key]), stop(WANT_STOPS[1]!, {}, [key])]), WANT);
    expect(markIn(score, name, 0)).toBe('pass');
    expect(markIn(score, name, 1)).toBe('pass');
  });

  it.each(STOP_CASES)('%s: wrong and marked is FAIL (marked)', (name, key, wrong) => {
    const score = scoreSample(form([stop(WANT_STOPS[0]!, wrong(WANT_STOPS[0]!), [key]), stop(WANT_STOPS[1]!)]), WANT);
    expect(markIn(score, name, 0)).toBe('FAIL (marked)');
    expect(markIn(score, name, 1)).toBe('pass');
  });

  it.each(STOP_CASES)('%s: wrong and unmarked is FAIL', (name, _key, wrong) => {
    const score = scoreSample(form([stop(WANT_STOPS[0]!), stop(WANT_STOPS[1]!, wrong(WANT_STOPS[1]!))]), WANT);
    expect(markIn(score, name, 0)).toBe('pass');
    expect(markIn(score, name, 1)).toBe('FAIL');
  });

  it.each(STOP_CASES)('%s: a Check on another field does not mark it', (name, key, wrong) => {
    const others = STOP_CASES.map(([, k]) => k).filter((k) => k !== key);
    const score = scoreSample(form([stop(WANT_STOPS[0]!, wrong(WANT_STOPS[0]!), [...others, 'appointment']), stop(WANT_STOPS[1]!)]), WANT);
    expect(markIn(score, name, 0)).toBe('FAIL');
  });

  it.each([
    ['right, unmarked: pass', WANT.loadNumber, null, 'pass'],
    ['right, marked: pass', WANT.loadNumber, 'Check it.', 'pass'],
    ['wrong, marked by loadNumberCheck: FAIL (marked)', 'EX-40471', 'Check it.', 'FAIL (marked)'],
    ['blank, marked by loadNumberCheck: FAIL (marked)', '', 'Check it.', 'FAIL (marked)'],
    ['wrong, unmarked: FAIL', 'EX-40471', null, 'FAIL'],
  ] as const)('the load number %s', (_, loadNumber, check, want) => {
    const score = scoreSample(form(right().stops, loadNumber, check), WANT);
    expect(score.load[0]).toEqual(['load number', want]);
  });

  it('the load number is not marked by a stop’s Check', () => {
    const score = scoreSample(form([stop(WANT_STOPS[0]!, {}, ['addressLine']), stop(WANT_STOPS[1]!)], 'EX-40471'), WANT);
    expect(score.load[0]).toEqual(['load number', 'FAIL']);
  });

  it('a load with no fill: a wrong load number is FAIL', () => {
    const score = scoreSample({ ...right(), loadNumber: 'EX-40471', fill: null }, WANT);
    expect(score.load[0]).toEqual(['load number', 'FAIL']);
  });

  it('the stop count is never "(marked)", with every field of the fill marked', () => {
    const all: FillField[] = ['stopType', 'addressLine', 'zip', 'city', 'state', 'appointment'];
    const score = scoreSample(form([stop(WANT_STOPS[0]!, {}, all)], WANT.loadNumber, 'Check it.'), WANT);
    expect(score.load[1]).toEqual(['stop count', 'FAIL']);
  });

  it('a stop missing from the fill: each of its fields FAIL, its appointment WRONG', () => {
    const score = scoreSample(form([stop(WANT_STOPS[0]!, {}, ['addressLine'])]), WANT);
    expect(score.load[1]).toEqual(['stop count', 'FAIL']);
    for (const [, marks] of score.stops) expect(marks).toEqual(['pass', 'FAIL']);
    expect(score.appointments).toEqual(['exact', 'WRONG']);
    expect(score.appointmentsSaid).toEqual(['exact', 'WRONG (missing)']);
  });

  it('a stop more than the truth: the stop count FAIL, the truth’s stops scored', () => {
    const score = scoreSample(form([...right().stops, stop(WANT_STOPS[1]!)]), WANT);
    expect(score.load[1]).toEqual(['stop count', 'FAIL']);
    for (const [, marks] of score.stops) expect(marks).toEqual(['pass', 'pass']);
  });

  it('the appointment scores as appointmentScore does: marked and different is not WRONG', () => {
    const score = scoreSample(form([stop(WANT_STOPS[0]!), stop(WANT_STOPS[1]!, { appointment: { ...right().stops[1]!.appointment, time: '' } }, ['appointment'])]), WANT);
    expect(score.appointments).toEqual(['exact', 'marked, filled differently']);
    expect(score.appointmentsSaid[1]).toBe('marked, filled differently (time)');
  });
});

describe('sampleMark: the sample’s own line', () => {
  const wrongAppt = () => stop(WANT_STOPS[1]!, { appointment: { ...right().stops[1]!.appointment, time: '14:30' } });

  it('pass: every bar field right, marked or not, and no appointment WRONG', () => {
    expect(sampleMark(scoreSample(right(), WANT))).toBe('pass');
    expect(sampleMark(scoreSample(form([stop(WANT_STOPS[0]!, {}, ['addressLine', 'city']), stop(WANT_STOPS[1]!)], WANT.loadNumber, 'Check it.'), WANT))).toBe('pass');
  });

  it('FAIL (marked): every wrong bar field marked, no appointment WRONG', () => {
    const score = scoreSample(form([stop(WANT_STOPS[0]!), stop(WANT_STOPS[1]!, { addressLine: '220 HarborRd' }, ['addressLine'])], '', 'Check it.'), WANT);
    expect(sampleMark(score)).toBe('FAIL (marked)');
  });

  it('FAIL: one wrong bar field unmarked beside a marked one', () => {
    const score = scoreSample(form([stop(WANT_STOPS[0]!, { city: 'Fargoo' }), stop(WANT_STOPS[1]!, { addressLine: '220 HarborRd' }, ['addressLine'])]), WANT);
    expect(sampleMark(score)).toBe('FAIL');
  });

  it('FAIL: every bar field right but an appointment WRONG', () => {
    expect(sampleMark(scoreSample(form([stop(WANT_STOPS[0]!), wrongAppt()]), WANT))).toBe('FAIL');
  });

  it('FAIL: a marked wrong field and an appointment WRONG', () => {
    const score = scoreSample(form([stop(WANT_STOPS[0]!, { zip: '58103' }, ['zip']), wrongAppt()]), WANT);
    expect(sampleMark(score)).toBe('FAIL');
  });

  it('FAIL: the stop count wrong', () => {
    expect(sampleMark(scoreSample(form([stop(WANT_STOPS[0]!, {}, ['stopType', 'addressLine', 'zip', 'city', 'state'])]), WANT))).toBe('FAIL');
  });

  it('the lines: the header with the sample’s mark, each field, the appointments', () => {
    const score = scoreSample(form([stop(WANT_STOPS[0]!), stop(WANT_STOPS[1]!, { addressLine: '220 HarborRd' }, ['addressLine'])]), WANT);
    expect(scoredLines(38, { layout: 'stop-detail', stops: 2, fromScan: false }, score)).toEqual([
      'sample 38 (stop-detail, 2 stops): FAIL (marked)',
      '  load number    pass',
      '  stop count     pass',
      '  order + type   stop 1 pass   stop 2 pass',
      '  street         stop 1 pass   stop 2 FAIL (marked)',
      '  ZIP            stop 1 pass   stop 2 pass',
      '  city           stop 1 pass   stop 2 pass',
      '  state          stop 1 pass   stop 2 pass',
      '  appointment    stop 1 exact   stop 2 exact',
    ]);
    expect(scoredLines(31, { layout: 'stop-table', stops: 2, fromScan: true }, scoreSample(right(), WANT))[0]).toBe('sample 31 (stop-table, 2 stops, a scan read by OCR): pass');
  });
});

describe('why a sample was not read', () => {
  it.each([
    [[], 'no layout recognised'],
    [['stop-table'], 'recognised as stop-table, refused'],
    [['stop-table', 'stop-rows'], 'recognised as stop-table, stop-rows: more than one layout'],
  ] as const)('%j: %s', (found, why) => {
    expect(notReadWhy(found)).toBe(why);
  });

  it('priority 1: skipped, ground truth for the AI evaluation only; otherwise FAIL', () => {
    expect(notReadLine(5, ['stop-table'], true)).toBe('sample 5: recognised as stop-table, refused — ground truth for the AI evaluation only');
    expect(notReadLine(2, [], true)).toBe('sample 2: no layout recognised — ground truth for the AI evaluation only');
    expect(notReadLine(19, ['stops-section'], false)).toBe('sample 19: FAIL — recognised as stops-section, refused');
    expect(notReadLine(19, ['stops-section', 'pu-so-blocks'], false)).toBe('sample 19: FAIL — recognised as stops-section, pu-so-blocks: more than one layout');
  });

  it('ground truth that says no template reads it: pass when not read, FAIL when read; no count of layouts', () => {
    expect(expectedNotReadLine(4, null, [])).toBe('sample 4: no layout recognised — pass (expected: no template reads it)');
    expect(expectedNotReadLine(4, 'label-rows', ['label-rows'])).toBe('sample 4: read as label-rows — FAIL (expected: no template reads it)');
  });
});

describe('the last lines', () => {
  it('nothing wrong: both lists say none', () => {
    const t = newTally();
    tallyScored(t, 1, scoreSample(right(), WANT));
    expect(summaryLines(t)).toEqual([
      'The bar (load number, stop count, order and type, street, ZIP, city, state all exact): 1 of 1',
      'Wrong and not marked: none',
      'Appointments silently wrong: none',
    ]);
    expect(t.failed).toBe(0);
  });

  it('a marked wrong field only: the sample fails and misses the bar, and both lists say none', () => {
    const t = newTally();
    tallyScored(t, 38, scoreSample(form([stop(WANT_STOPS[0]!), stop(WANT_STOPS[1]!, { addressLine: '220 HarborRd' }, ['addressLine'])]), WANT));
    expect(summaryLines(t)).toEqual([
      'The bar (load number, stop count, order and type, street, ZIP, city, state all exact): 0 of 1',
      'Wrong and not marked: none',
      'Appointments silently wrong: none',
    ]);
    expect(t.failed).toBe(1);
  });

  it('lists every unmarked FAIL by sample, field and stop, and every WRONG appointment by sample and stop', () => {
    const t = newTally();
    tallyScored(t, 12, scoreSample(form([stop(WANT_STOPS[0]!, { addressLine: '4001 Mian St' }), stop(WANT_STOPS[1]!, { appointment: { ...right().stops[1]!.appointment, time: '14:30' }, city: 'Duluht' }, ['city'])]), WANT));
    tallyFailed(t, 19, 'not read', true);
    tallyScored(t, 20, scoreSample(right(), WANT));
    expect(summaryLines(t)).toEqual([
      'The bar (load number, stop count, order and type, street, ZIP, city, state all exact): 1 of 3',
      'Wrong and not marked: 2: sample 12 street stop 1, sample 19 not read',
      'Appointments silently wrong: 1: sample 12 stop 2',
    ]);
    expect(t.failed).toBe(2);
  });

  it('the load number and the stop count by name; a missing stop’s fields and appointment', () => {
    const t = newTally();
    tallyScored(t, 7, scoreSample(form([stop(WANT_STOPS[0]!)], 'EX-40471'), WANT));
    expect(summaryLines(t).slice(1)).toEqual([
      'Wrong and not marked: 7: sample 7 load number, sample 7 stop count, sample 7 order + type stop 2, sample 7 street stop 2, sample 7 ZIP stop 2, sample 7 city stop 2, sample 7 state stop 2',
      'Appointments silently wrong: 1: sample 7 stop 2',
    ]);
  });

  it('a failure before any field is scored counts against the bar only when held to it', () => {
    const t = newTally();
    tallyFailed(t, 3, 'PDF not read', false);
    tallyFailed(t, 9, 'fill refused', true);
    expect(t).toMatchObject({ bar: 0, barOf: 1, failed: 2, unmarked: ['sample 3 PDF not read', 'sample 9 fill refused'] });
  });
});

describe('no value in any printed string', () => {
  it('neither the truth’s nor the fill’s load number, street, city, state, ZIP, date or time', () => {
    const wrong = form(
      [
        stop(WANT_STOPS[0]!, { addressLine: '4001 Mian St', city: 'Fargoo', state: 'SD', zip: '58103' }, ['zip']),
        stop(WANT_STOPS[1]!, { appointment: { ...right().stops[1]!.appointment, date: '2026-10-16', time: '14:30' } }),
      ],
      'EX-40471',
    );
    const score = scoreSample(wrong, WANT);
    const t = newTally();
    tallyScored(t, 12, score);
    const printed = [...scoredLines(12, { layout: 'stop-detail', stops: 2, fromScan: false }, score), ...summaryLines(t)].join('\n');
    const values = [
      WANT.loadNumber,
      wrong.loadNumber,
      ...WANT_STOPS.flatMap((s) => [s.street, s.city, s.state, s.zip]),
      ...wrong.stops.flatMap((s) => [s.addressLine, s.city, s.state, s.zip]),
      '2026', '08:00', '13:30', '14:30', 'Mian', 'Harbor',
    ];
    for (const v of values) expect(printed).not.toContain(v);
  });
});
