import { describe, expect, it } from 'vitest';
import {
  ClearStopRequest,
  clearStopTitle,
  closesFor,
  confirmLines,
  DEFAULT_CLEAR_STATUS,
  initialChoice,
  newLoadSubtitle,
  openLoadChoices,
  previousLoadLine,
  previousLoads,
  savePrompt,
  timelineSentence,
} from './clear-stop';
import { timeInZone } from './format';
import { timelineStay } from './timeline';
import type { TimelineStop } from '@/server/timeline';

/** §12.88 — the rules Clear stop's confirm step states. */

const NOW = Date.parse('2026-09-23T18:00:00.000Z');
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();
const TZ = 'America/Chicago';

const stop = (over: Partial<TimelineStop> = {}): TimelineStop => ({
  stopId: 's1',
  loadId: 'l1',
  loadNumber: 'LD-1',
  loadStatus: 'DISPATCHED',
  loadCreatedAt: '2026-09-22T06:00:00.000Z',
  sequence: 1,
  type: 'DEL',
  addressLine: null,
  city: 'Joliet',
  state: 'IL',
  zip: null,
  apptStartUtc: null,
  apptEndUtc: null,
  apptTz: TZ,
  apptType: 'APPT',
  arrivedAt: null,
  arrivedSource: null,
  departedAt: null,
  departedSource: null,
  dispatcherNote: null,
  noteAt: null,
  overrides: [],
  ...over,
});

describe('which load it closes', () => {
  const single = [stop()];
  const plusOne = [
    stop(),
    stop({ stopId: 's2', loadId: 'l2', loadNumber: 'LD-2', city: 'Fargo', state: 'ND' }),
  ];

  it('starts on the only open load when there is one', () => {
    expect(initialChoice(openLoadChoices(single))).toBe('l1');
  });

  it('starts on NONE when the truck holds two — never a default', () => {
    const choices = openLoadChoices(plusOne);
    expect(choices.map((c) => c.loadId)).toEqual(['l1', 'l2']);
    expect(initialChoice(choices)).toBeNull();
  });

  it('names each open load by number and next stop, and skips closed ones', () => {
    const choices = openLoadChoices([
      stop({ stopId: 'x', loadId: 'l0', loadStatus: 'DELIVERED' }),
      stop({ stopId: 'a', departedAt: ago(5), city: 'Joliet' }),
      stop({ stopId: 'b', sequence: 2, city: 'Moorhead', state: 'MN' }),
      stop({ stopId: 'c', loadId: 'l2', loadNumber: null, city: 'Fargo', state: 'ND' }),
    ]);
    expect(choices.map((c) => [c.loadNumber, c.nextPlace, c.stops.length])).toEqual([
      ['LD-1', 'Moorhead, MN', 2],
      [null, 'Fargo, ND', 1],
    ]);
  });

  it('refuses a request that does not name the load, so the server cannot pick one', () => {
    const truckId = '11111111-1111-4111-8111-111111111101';
    expect(ClearStopRequest.safeParse({ truckId, status: 'DELIVERED' }).success).toBe(
      false,
    );
    expect(
      ClearStopRequest.safeParse({
        truckId,
        loadId: '33333333-3333-4333-8333-333333333301',
        status: 'TONU',
      }).success,
    ).toBe(false);
  });

  it('closes as Delivered unless told otherwise', () => {
    expect(DEFAULT_CLEAR_STATUS).toBe('DELIVERED');
  });
});

describe('the timeline sentence', () => {
  const sentence = (stops: TimelineStop[]) =>
    timelineSentence(timelineStay({ status: 'DELIVERED', stops }, NOW), TZ);

  it('arrived within 24 hours: stays until 24 hours after the arrival', () => {
    const until = new Date(Date.parse(ago(2)) + 24 * 3_600_000);
    expect(sentence([stop({ arrivedAt: ago(2), arrivedSource: 'detected' })])).toBe(
      `It stays on the timeline until ${timeInZone(until, TZ, { weekday: true })}, 24 hours after its last arrival.`,
    );
  });

  it('arrived 30 hours ago: leaves now', () => {
    expect(sentence([stop({ arrivedAt: ago(30), arrivedSource: 'detected' })])).toBe(
      'It leaves the timeline now: its last arrival was more than 24 hours ago.',
    );
  });

  it('never reached: leaves now', () => {
    expect(sentence([stop(), stop({ stopId: 's2', sequence: 2 })])).toBe(
      'It leaves the timeline now: none of its stops was reached.',
    );
  });
});

describe('what the confirm step says', () => {
  const lines = (
    stops: TimelineStop[],
    extra: Partial<Parameters<typeof confirmLines>[0]> = {},
  ) => {
    const [choice, ...others] = openLoadChoices(stops);
    return confirmLines({
      truckName: '101',
      choice: choice!,
      status: 'DELIVERED',
      others,
      stay: timelineStay({ status: 'DELIVERED', stops: choice!.stops }, NOW),
      dispatchTz: TZ,
      unsaved: [],
      ...extra,
    });
  };

  it('keeps the times as the record and never says they are wiped', () => {
    const said = lines([stop({ arrivedAt: ago(1), arrivedSource: 'dispatcher' })]).join(
      '\n',
    );
    expect(said).toContain('Load LD-1 is closed as Delivered.');
    expect(said).toContain('The arrival and departure times are kept as the record.');
    expect(said).not.toMatch(/wipe|erase|remov/i);
    expect(said).toContain(
      'Truck 101 then shows no next stop, appointment or load number.',
    );
    expect(said).toContain(
      'Not changed: the driver assignment, whether the truck is active, and its history.',
    );
  });

  it('says every stop of a multi-stop load closes with it', () => {
    const said = lines([stop(), stop({ stopId: 's2', sequence: 2, type: 'DEL' })]);
    expect(said).toContain('All 2 of its stops close with it.');
    expect(lines([stop()]).join('\n')).not.toMatch(/stops close with it/);
  });

  it('says how many stops of a multi-stop load were never reached (§12.119)', () => {
    const reached = { arrivedAt: ago(5), arrivedSource: 'detected' as const };
    const two = lines([
      stop({ type: 'PU', ...reached }),
      stop({ stopId: 's2', sequence: 2 }),
      stop({ stopId: 's3', sequence: 3 }),
    ]);
    expect(two).toContain(
      '2 of its stops were never reached; they stay on record as not reached.',
    );
    const one = lines([stop({ type: 'PU', ...reached }), stop({ stopId: 's2', sequence: 2 })]);
    expect(one).toContain('1 of its stops was never reached; it stays on record as not reached.');

    const all = lines([
      stop({ type: 'PU', ...reached }),
      stop({ stopId: 's2', sequence: 2, ...reached }),
    ]).join('\n');
    expect(all).not.toMatch(/never reached/);
    // One stop: the timeline sentence already says whether it was reached.
    expect(lines([stop()]).join('\n')).not.toMatch(/never reached/);
  });

  it('on a "+1 load" truck, names the load that keeps going', () => {
    const said = lines([
      stop(),
      stop({
        stopId: 's2',
        loadId: 'l2',
        loadNumber: 'LD-2',
        city: 'Fargo',
        state: 'ND',
      }),
    ]);
    expect(said).toContain('Truck 101 keeps its other open load, load LD-2.');
    expect(said.join('\n')).not.toMatch(/no next stop/);
  });

  it('names a load with no number as such (§12.21), and the chosen status', () => {
    const said = lines([stop({ loadNumber: null })], { status: 'CANCELLED' });
    expect(said[0]).toBe('The load with no number is closed as Cancelled.');
  });

  it('warns that unsaved edits in the form go', () => {
    expect(lines([stop()], { unsaved: ['appointment', 'note'] }).at(-1)).toBe(
      'Unsaved edits in this form are discarded: appointment, note.',
    );
  });
});

/* ------------------------- previous loads (§12.92) ----------------------- */

describe('previous loads (§12.92)', () => {
  const done = (over: Partial<TimelineStop> = {}) =>
    stop({
      city: 'Vernon Hills',
      arrivedAt: ago(4),
      arrivedSource: 'detected',
      departedAt: ago(3),
      ...over,
    });

  it('is an open load with every stop departed — and nothing else', () => {
    const rows = [
      done({ loadId: 'done', loadNumber: '6612193' }),
      // Open, one stop still ahead: not previous.
      stop({ stopId: 'a1', loadId: 'going', departedAt: ago(5), sequence: 1 }),
      stop({ stopId: 'a2', loadId: 'going', sequence: 2 }),
      // Closed: not previous, whatever its stops say.
      done({ stopId: 'c1', loadId: 'closed', loadStatus: 'DELIVERED' }),
    ];
    expect(previousLoads(rows).map((l) => l.loadId)).toEqual(['done']);
  });

  describe('the header', () => {
    it.each([
      [0, 'No load on this truck yet'],
      [1, 'No next stop. 1 previous load still open'],
      [2, 'No next stop. 2 previous loads still open'],
    ])('with %i open loads: %s', (count, expected) => {
      expect(newLoadSubtitle(count)).toBe(expected);
    });

    it('says "No load" only when there is none', () => {
      for (const count of [0, 1, 2, 7]) {
        expect(newLoadSubtitle(count).includes('No load')).toBe(count === 0);
      }
    });
  });

  describe('the line above the form', () => {
    const now = new Date(NOW);
    const at = (h: number) => timeInZone(new Date(ago(h)), TZ);

    it('names the load, the last stop, both times in dispatch time, and how', () => {
      const [load] = previousLoads([done({ loadNumber: '6612193' })]);
      expect(previousLoadLine(load!, TZ, now)).toBe(
        `Previous load 6612193: Vernon Hills, arrived ${at(4)}, departed ${at(3)} (detected automatically). Still open.`,
      );
    });

    it('says "marked by hand" for an arrival the dispatcher entered', () => {
      const [load] = previousLoads([done({ arrivedSource: 'dispatcher' })]);
      expect(previousLoadLine(load!, TZ, now)).toContain('(marked by hand). Still open.');
    });

    it('says which time a dispatcher entered when the departure was theirs (§12.118)', () => {
      const [load] = previousLoads([done({ loadNumber: '6612193', departedSource: 'dispatcher' })]);
      expect(previousLoadLine(load!, TZ, now)).toBe(
        `Previous load 6612193: Vernon Hills, arrived ${at(4)} (detected automatically), departed ${at(3)} (marked by hand). Still open.`,
      );
    });

    it('says "no number" for a load without one (§12.21)', () => {
      const [load] = previousLoads([done({ loadNumber: null })]);
      expect(previousLoadLine(load!, TZ, now)).toMatch(/^Previous load no number: /);
    });

    it('uses the LAST stop, and gives the weekday when it was not today', () => {
      const [load] = previousLoads([
        done({ stopId: 'p', sequence: 1, city: 'Joliet', departedAt: ago(40) }),
        done({ stopId: 'q', sequence: 2, arrivedAt: ago(30), departedAt: ago(29) }),
      ]);
      const day = timeInZone(new Date(ago(30)), TZ, { weekday: true });
      expect(previousLoadLine(load!, TZ, now)).toContain(`Vernon Hills, arrived ${day}`);
    });
  });

  describe('Clear stop names what it would close when the form is empty', () => {
    it('one load, by number and place', () => {
      expect(clearStopTitle(previousLoads([done({ loadNumber: '6612193' })]))).toBe(
        'Close previous load 6612193 (Vernon Hills).',
      );
    });

    it('two loads, both named', () => {
      const two = previousLoads([
        done({ loadId: 'a', loadNumber: '6612193' }),
        done({ stopId: 's2', loadId: 'b', loadNumber: null, city: 'Joliet' }),
      ]);
      expect(clearStopTitle(two)).toBe(
        'Close one of 2 previous loads: 6612193 (Vernon Hills), no number (Joliet).',
      );
    });

    it('says what it is waiting for while the loads are read', () => {
      expect(clearStopTitle(null)).toBe(
        'Close a previous load still open on this truck.',
      );
    });
  });

  describe('the save-time question', () => {
    it('asks by number', () => {
      const [load] = previousLoads([done({ loadNumber: '6612193' })]);
      expect(savePrompt(load!)).toBe(
        'Previous load 6612193 is still open. Close it as Delivered?',
      );
    });

    it('closes what was answered Delivered or Cancelled, and nothing kept open', () => {
      expect(closesFor({ a: 'DELIVERED', b: 'keep', c: 'CANCELLED' })).toEqual([
        { loadId: 'a', status: 'DELIVERED' },
        { loadId: 'c', status: 'CANCELLED' },
      ]);
      expect(closesFor({ a: 'keep' })).toEqual([]);
    });
  });
});
