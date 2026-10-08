import { describe, expect, it } from 'vitest';
import { springForward, YEAR } from '@/test/dst';
import { timeInZone } from '@/lib/format';
import { splitPastedAddress } from '@/lib/paste-address';
import type { LoadForEdit } from '@/lib/load-read';
import {
  ADD_STOP_FULL,
  REMOVE_LAST_STOP,
  addBlocked,
  addStop,
  appointmentErrors,
  confirmZone,
  patchStop,
  pasteAddress,
  takePasted,
  undoPaste,
  zoneSource,
  stopEditOf,
  stopFormFrom,
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

/** §12.120. The zone follows the address, as pure rules. */
describe('the zone follows the state', () => {
  const blank = () => {
    const stop = stopFormFrom(null, OPENED);
    return patchStop(stop, { appointment: { ...stop.appointment, enabled: true } });
  };
  const tzErrors = (stop: StopForm) =>
    appointmentErrors({ ...formOf([{}]), stops: [stop] }).filter((e) => e.field === 'appointment.tz');

  it('opening a saved stop never changes its zone, and decides nothing', () => {
    const form = formOf([{ state: 'IL', apptTz: 'America/Denver' }, { state: 'ND', zip: '58854' }]);
    expect(form.stops.map((s) => s.appointment.tz)).toEqual(['America/Denver', TZ]);
    expect(form.stops.map((s) => s.zone.mode)).toEqual(['kept', 'kept']);
    expect(appointmentErrors(form)).toEqual([]);
  });

  it('a saved stop with no stored zone opens on its state’s, as before, and is not asked', () => {
    const form = formOf([{ state: 'ND', zip: '58601', apptTz: null, apptStartUtc: null, apptEndUtc: null }]);
    const stop = form.stops[0]!;
    expect(stop.appointment.tz).toBe('America/Chicago');
    expect(stop.zone).toEqual({ mode: 'auto', verdict: null, confirmed: false });
    // Ticking the appointment asks the address: the ZIP is Mountain.
    const ticked = patchStop(stop, { appointment: { ...stop.appointment, enabled: true } });
    expect(ticked.appointment.tz).toBe('America/Denver');
  });

  it('a saved stop with a recorded arrival keeps its zone, so the arrival cannot move', () => {
    const arrivedAt = '2026-10-08T14:00:00.000Z';
    const form = formOf([
      { state: 'ND', zip: '58102', apptTz: null, apptStartUtc: null, apptEndUtc: null, arrivedAt },
    ]);
    const stop = form.stops[0]!;
    expect(stop.zone.mode).toBe('kept');
    const moved = patchStop(stop, { zip: '58601' });
    expect(moved.appointment.tz).toBe('America/Chicago');
    // The arrival goes back as the same instant it came in as.
    const edit = stopEditOf(form, moved, TRUCK);
    expect(edit.arrivedAt).toMatchObject({ tz: 'America/Chicago' });
    expect(timeInZone(new Date(arrivedAt), 'America/Chicago', { zone: false })).toBe(moved.arrival.time);
  });

  it('a stored zone is never moved by a new state or ZIP', () => {
    const stop = formOf([{ state: 'IL', apptTz: 'America/Denver' }]).stops[0]!;
    const moved = patchStop(patchStop(stop, { state: 'ND' }), { zip: '58854' });
    expect(moved.appointment.tz).toBe('America/Denver');
    expect(tzErrors(moved)).toEqual([]);
  });

  it('a new stop follows the state, with no error in a one-zone state', () => {
    for (const [state, zone] of [['IL', 'America/Chicago'], ['MN', 'America/Chicago'], ['CO', 'America/Denver']]) {
      const stop = patchStop(blank(), { state: state! });
      expect(stop.appointment.tz).toBe(zone);
      expect(tzErrors(stop)).toEqual([]);
    }
  });

  it('in a two-zone state, waits for a ZIP or a confirmation', () => {
    const nd = patchStop(blank(), { state: 'ND' });
    expect(tzErrors(nd)).toHaveLength(1);
    expect(tzErrors(confirmZone(nd))).toEqual([]);
    expect(tzErrors(patchStop(nd, { zip: '58102' }))).toEqual([]);
    // A confirmation is for the address it was given.
    expect(tzErrors(patchStop(confirmZone(nd), { zip: '58854' }))).toHaveLength(1);
  });

  it('a zone picked by hand is kept, and settles the question', () => {
    const nd = patchStop(blank(), { state: 'ND' });
    const picked = patchStop(nd, { appointment: { ...nd.appointment, tz: 'America/Denver' } });
    expect(picked.zone.mode).toBe('chosen');
    expect(tzErrors(picked)).toEqual([]);
    const moved = patchStop(patchStop(picked, { state: 'IL' }), { zip: '60018' });
    expect(moved.appointment.tz).toBe('America/Denver');
  });

  it('an unticked appointment is never asked about', () => {
    const stop = stopFormFrom(null, OPENED);
    expect(tzErrors(patchStop(stop, { state: 'ND' }))).toEqual([]);
  });

  it('Add stop carries the last stop’s zone until the new stop has a state', () => {
    const form = formOf([{ apptTz: 'America/Denver', state: 'CO' }]);
    const added = addStop(form, OPENED).form.stops[1]!;
    expect(added.appointment.tz).toBe('America/Denver');
    expect(tzErrors(added)).toEqual([]);
    expect(patchStop(added, { state: 'IL' }).appointment.tz).toBe('America/Chicago');
  });
});

/** §12.121. An address pasted into Street, as pure rules. Invented addresses. */
describe('pasting an address', () => {
  const pasted = (text: string) => splitPastedAddress(text)!;
  const fresh = () => {
    const stop = stopFormFrom(null, OPENED);
    return patchStop(stop, { appointment: { ...stop.appointment, enabled: true } });
  };

  it('fills all four fields together, and the zone follows the ZIP', () => {
    const stop = pasteAddress(fresh(), pasted('4001 Main St\nDickinson, ND 58601'));
    expect([stop.addressLine, stop.city, stop.state, stop.zip]).toEqual(['4001 Main St', 'Dickinson', 'ND', '58601']);
    expect(stop.appointment.tz).toBe('America/Denver');
    expect(stop.paste?.filled).toEqual(['addressLine', 'city', 'state', 'zip']);
    expect(zoneSource(stop)).toBe('Set from ZIP 58601.');
  });

  it('says the zone came from the state in a one-zone state', () => {
    const stop = pasteAddress(fresh(), pasted('1900 Oak Ave, Melrose Park, IL 60160'));
    expect(zoneSource(stop)).toBe('Set from the state, IL.');
  });

  it('never overwrites a city, state or ZIP already there: keeps it and says what the paste said', () => {
    const typed = patchStop(patchStop(fresh(), { city: 'West Fargo' }), { zip: '58078' });
    const stop = pasteAddress(typed, pasted('4001 Main St\nFargo, ND 58102'));
    expect([stop.addressLine, stop.city, stop.state, stop.zip]).toEqual(['4001 Main St', 'West Fargo', 'ND', '58078']);
    expect(stop.paste?.kept).toEqual({ city: 'Fargo', zip: '58102' });
    expect(stop.paste?.filled).toEqual(['addressLine', 'state']);
  });

  it('counts the same value written differently as the same, not as a conflict', () => {
    const typed = patchStop(patchStop(fresh(), { city: 'fargo' }), { zip: '58102-0001' });
    const stop = pasteAddress(typed, pasted('4001 Main St\nFARGO, ND 58102'));
    expect(stop.paste?.kept).toEqual({});
  });

  it('"Use the pasted ones" takes what was kept, and undo still undoes the whole paste', () => {
    const typed = patchStop(fresh(), { city: 'West Fargo' });
    const taken = takePasted(pasteAddress(typed, pasted('4001 Main St\nFargo, ND 58102')));
    expect(taken.city).toBe('Fargo');
    expect(taken.paste?.kept).toEqual({});
    expect(undoPaste(taken).city).toBe('West Fargo');
  });

  it('undo restores the four fields and the zone in one step', () => {
    const before = patchStop(fresh(), { state: 'IL' });
    const after = pasteAddress(before, pasted('4001 Main St\nDickinson, ND 58601'));
    const undone = undoPaste(after);
    expect([undone.addressLine, undone.city, undone.state, undone.zip]).toEqual(['', '', 'IL', '']);
    expect(undone.appointment.tz).toBe('America/Chicago');
    expect(undone.zone).toEqual(before.zone);
    expect(undone.paste).toBeNull();
  });

  it('a field typed in after the paste ends the undo, and answers that field’s check', () => {
    const after = pasteAddress(fresh(), pasted('4001 Main St\nFargo ND'));
    expect(after.paste?.checks.zip).toBeDefined();
    const typed = patchStop(after, { zip: '58102' });
    expect(typed.paste?.before ?? null).toBeNull();
    expect(typed.paste?.checks.zip).toBeUndefined();
    expect(undoPaste(typed)).toBe(typed);
  });

  it('never moves a saved stop’s stored zone', () => {
    const saved = formOf([{ state: 'IL', zip: '60160', apptTz: 'America/Chicago' }]).stops[0]!;
    const stop = pasteAddress(saved, pasted('4001 Main St\nDickinson, ND 58601'));
    // The saved city, state and ZIP are the dispatcher's: kept, and said.
    expect(stop.paste?.kept).toEqual({ city: 'Dickinson', state: 'ND', zip: '58601' });
    const taken = takePasted(stop);
    expect([taken.state, taken.zip]).toEqual(['ND', '58601']);
    expect(taken.appointment.tz).toBe('America/Chicago');
    expect(zoneSource(taken)).toBe('Kept as saved: an address change never moves a saved stop’s zone.');
  });
});
