import { describe, expect, it } from 'vitest';
import {
  ClearStopRequest,
  confirmLines,
  DEFAULT_CLEAR_STATUS,
  initialChoice,
  openLoadChoices,
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
