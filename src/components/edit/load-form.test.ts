import { describe, expect, it } from 'vitest';
import { springForward, YEAR } from '@/test/dst';
import { timeInZone } from '@/lib/format';
import type { LoadForEdit } from '@/lib/load-read';
import {
  ADD_STOP_FULL,
  REMOVE_LAST_STOP,
  addBlocked,
  addStop,
  deliveryBeforePickup,
  dirtyLabels,
  dirtyOf,
  loadFormFrom,
  nextTripAllowed,
  removeBlocked,
  removeStop,
  stopsToSend,
  type LoadForm,
  type StopForm,
} from './load-form';

/** §12.119, stage 4b. Add and Remove, and the order note, as pure rules. */

const TZ = 'America/Chicago';
const OPENED = '2026-10-08T15:00:00.000Z';
const TRUCK = '11111111-1111-4111-8111-111111111111';

type StopRead = LoadForEdit['stops'][number];
const read = (over: Partial<StopRead>[]): LoadForEdit => ({
  loadId: '33333333-3333-4333-8333-333333333333',
  truckId: TRUCK,
  loadNumber: 'VL-1',
  status: 'DISPATCHED',
  assignment: null,
  version: '0123456789abcdef0123456789abcdef',
  stops: over.map((o, i) => ({
    stopId: `66666666-6666-4666-8666-${String(i + 1).padStart(12, '0')}`,
    sequence: i + 1,
    type: i === 0 ? 'PU' : 'DEL',
    addressLine: null,
    city: `City ${i + 1}`,
    state: 'IL',
    zip: null,
    apptStartUtc: '2026-10-09T13:00:00.000Z',
    apptEndUtc: '2026-10-09T13:30:00.000Z',
    apptTz: TZ,
    apptType: 'APPT',
    dispatcherNote: null,
    arrivedAt: null,
    arrivedSource: null,
    departedAt: null,
    departedSource: null,
    precision: null,
    accuracyMiles: null,
    override: null,
    ...o,
  })),
});

const formOf = (stops: Partial<StopRead>[]) => loadFormFrom(read(stops), OPENED, null);

describe('Add stop', () => {
  it('appends the other type, ticked, on the last stop’s date and zone, with no time', () => {
    const form = formOf([{}, { apptTz: 'America/Denver', apptStartUtc: '2026-10-10T16:00:00.000Z' }]);
    const { form: next, key } = addStop(form, OPENED);
    const added = next.stops[2]!;
    expect(key).toBe('new-1');
    expect(added.key).toBe(key);
    expect(added.stored).toBeNull();
    expect(added.stopType).toBe('PU');
    expect(added.appointment).toMatchObject({
      enabled: true,
      type: 'APPT',
      date: '2026-10-10',
      time: '',
      tz: 'America/Denver',
    });
    expect(addStop(addStop(next, OPENED).form, OPENED).key).toBe('new-3');
  });

  it('follows a pickup with a delivery', () => {
    const form = formOf([{ type: 'PU' }]);
    expect(addStop(form, OPENED).form.stops[1]!.stopType).toBe('DEL');
  });

  it('is off at ten stops, and says why', () => {
    let form = formOf([{}]);
    for (let i = 0; i < 9; i += 1) {
      expect(addBlocked(form)).toBeNull();
      form = addStop(form, OPENED).form;
    }
    expect(form.stops).toHaveLength(10);
    expect(addBlocked(form)).toBe(ADD_STOP_FULL);
    expect(ADD_STOP_FULL).toBe('A load holds at most 10 stops.');
  });
});

describe('Remove stop', () => {
  it('is off for a stop the truck reached — arrived, or left — naming the arrival at the stop', () => {
    const arrivedAt = '2026-10-08T18:55:00.000Z';
    const form = formOf([
      { arrivedAt, arrivedSource: 'detected', departedAt: '2026-10-08T19:40:00.000Z', departedSource: 'detected' },
      { arrivedAt, arrivedSource: 'dispatcher' },
      {},
    ]);
    const said = `Can't remove: the truck arrived here at ${timeInZone(new Date(arrivedAt), TZ)}.`;
    expect(removeBlocked(form, 0, TZ)).toEqual({ text: said, reached: true });
    expect(removeBlocked(form, 1, TZ)).toEqual({ text: said, reached: true });
    expect(removeBlocked(form, 2, TZ)).toBeNull();
  });

  it('is off on the last stop left', () => {
    expect(removeBlocked(formOf([{}]), 0, TZ)).toEqual({ text: REMOVE_LAST_STOP, reached: false });
    expect(REMOVE_LAST_STOP).toBe('A load needs at least one stop.');
  });

  it('drops a stop this form added without a trace', () => {
    const opened = formOf([{}]);
    const added = addStop(opened, OPENED);
    const back = removeStop(added.form, added.key);
    expect(back).toEqual(opened);
    expect(dirtyLabels(dirtyOf(opened, back, TRUCK), back, opened)).toEqual([]);
  });

  it('remembers a saved stop, names it in the banner as it was numbered, and sends it as removed', () => {
    const opened = formOf([{}, { city: 'Ankeny', state: 'IA' }, { city: 'Moorhead', state: 'MN' }]);
    const form = removeStop(opened, opened.stops[1]!.key);
    expect(form.stops.map((s) => s.city)).toEqual(['City 1', 'Moorhead']);
    expect(form.removed).toEqual([opened.stops[1]!.stored!.stopId]);
    const dirty = dirtyOf(opened, form, TRUCK);
    expect(dirtyLabels(dirty, form, opened)).toEqual(['stop 2 (Ankeny, IA) removed']);
    // Nothing else changed: the save carries the next stop, as a load-only change does.
    expect(stopsToSend(form, dirty, opened.stops[0]!.key, false).map((s) => s.key)).toEqual([
      opened.stops[0]!.key,
    ]);
  });

  it('names a removal even when one stop is left', () => {
    const opened = formOf([{}, { city: 'Ankeny', state: 'IA' }]);
    const form = removeStop(opened, opened.stops[1]!.key);
    expect(dirtyLabels(dirtyOf(opened, form, TRUCK), form, opened)).toEqual([
      'stop 2 (Ankeny, IA) removed',
    ]);
  });
});

describe('a new load', () => {
  const blank = loadFormFrom(null, OPENED, null);

  it('of one stop sends it as it always did — through the fallback, untouched or not', () => {
    const dirty = dirtyOf(blank, blank, TRUCK);
    expect(stopsToSend(blank, dirty, null, false).map((s) => s.key)).toEqual(['new-1']);
  });

  it('of several sends every stop, the first one untouched included', () => {
    const form = addStop(blank, OPENED).form;
    const dirty = dirtyOf(blank, form, TRUCK);
    expect(dirtyLabels(dirty, form, blank)).toEqual(['stop 2: new']);
    expect(stopsToSend(form, dirty, null, false).map((s) => s.key)).toEqual(['new-1', 'new-2']);
  });
});

describe('"Next trip" on a load of several stops (§12.116 D3)', () => {
  const reached = { arrivedAt: '2026-10-08T12:00:00.000Z', arrivedSource: 'detected' as const };
  const loaded = read([reached, reached]);
  const form = loadFormFrom(loaded, OPENED, null);
  const asked = form.stops[1]!.key;

  it('is offered for the one reached stop, every stop reached, nothing added or removed', () => {
    expect(nextTripAllowed(loaded, [form.stops[1]!], asked)).toBe(true);
  });

  it('is not, with a stop removed or added in the same save', () => {
    expect(nextTripAllowed(loaded, [form.stops[1]!], asked, [form.stops[0]!.key])).toBe(false);
    const added = addStop(form, OPENED).form.stops[2]!;
    expect(nextTripAllowed(loaded, [added], asked)).toBe(false);
    expect(nextTripAllowed(loaded, [form.stops[1]!, added], asked)).toBe(false);
  });

  it('is not, while a stop is still ahead', () => {
    const ahead = read([reached, {}]);
    const f = loadFormFrom(ahead, OPENED, null);
    expect(nextTripAllowed(ahead, [f.stops[0]!], f.stops[0]!.key)).toBe(false);
  });
});

describe('the delivery-before-pickup note', () => {
  const at = (form: LoadForm, i: number, appointment: Partial<StopForm['appointment']>, type?: 'PU' | 'DEL'): LoadForm => ({
    ...form,
    stops: form.stops.map((s, j) =>
      j === i ? { ...s, ...(type ? { stopType: type } : {}), appointment: { ...s.appointment, ...appointment } } : s,
    ),
  });
  const two = formOf([{ type: 'PU' }, { type: 'DEL' }]);

  it('names the pickup above a delivery that comes first, in the pickup’s own zone', () => {
    const form = at(at(two, 0, { date: '2026-10-09', time: '08:00' }), 1, { date: '2026-10-08', time: '14:00' });
    const pickupAt = new Date('2026-10-09T13:00:00.000Z');
    expect(deliveryBeforePickup(form, 1)).toBe(
      `This delivery is before the pickup above it (stop 1, Oct 9 ${timeInZone(pickupAt, TZ)}).`,
    );
    expect(deliveryBeforePickup(form, 0)).toBeNull();
  });

  it('says nothing when the order is right, or a time is missing', () => {
    expect(deliveryBeforePickup(at(two, 1, { date: '2026-10-10', time: '09:00' }), 1)).toBeNull();
    expect(deliveryBeforePickup(at(two, 1, { date: '2026-10-08', time: '' }), 1)).toBeNull();
  });

  it('compares instants, not wall clocks, across zones', () => {
    // 08:00 in Chicago is 09:00 in New York: a 08:30 New York delivery is the earlier one.
    const east = at(at(two, 0, { date: '2026-10-09', time: '08:00' }), 1, {
      date: '2026-10-09',
      time: '08:30',
      tz: 'America/New_York',
    });
    expect(deliveryBeforePickup(east, 1)).toMatch(/^This delivery is before the pickup above it/);
    const west = at(east, 1, { tz: 'America/Denver' });
    expect(deliveryBeforePickup(west, 1)).toBeNull();
  });

  it('holds across the spring-forward night, derived for this year', () => {
    const change = springForward(TZ, YEAR);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(change);
    // 01:30 CST and 03:30 CDT are one hour apart, not two.
    const form = at(at(two, 0, { date: day, time: '03:30' }), 1, { date: day, time: '01:30' });
    expect(deliveryBeforePickup(form, 1)).toMatch(/stop 1/);
  });
});
