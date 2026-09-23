import { describe, expect, it } from 'vitest';
import { fleetRow } from '@/test/fleet-row';
import { addressText, loadText } from './copy-text';

/**
 * §14 feature 3. The formats are chosen here rather than in a JSX expression
 * precisely so they can be asserted.
 */

/**
 * `nextStop` is pulled out of `over` before the spread. Leaving it in made
 * the outer `...over` replace the whole stop with the two keys a test wanted
 * to change — so a test for a missing street line was really a test for a
 * stop with no city, state or type either.
 */
const withStop = (over: Record<string, unknown> = {}) => {
  const { nextStop: stopOver, ...rest } = over;
  return fleetRow({
    truckNumber: 118,
    driverName: 'M. Kowalczyk',
    nextStop: {
      stopId: '11111111-1111-4111-8111-111111111111',
      loadId: '22222222-2222-4222-8222-222222222222',
      loadNumber: '12120569',
      loadStatus: 'DISPATCHED',
      type: 'DEL',
      addressLine: '2500 N 11th ST',
      city: 'Moorhead',
      state: 'MN',
      zip: '56560',
      apptStartUtc: null,
      apptEndUtc: null,
      apptTz: 'America/Chicago',
      apptType: 'APPT',
      lat: 46.9,
      lng: -96.76,
      precision: 'street',
      accuracyMiles: 0.1,
      arrivedAt: null,
      arrivedSource: null,
      dispatcherNote: null,
      ...(stopOver as object),
    },
    ...rest,
  } as never);
};

describe('the address format', () => {
  it('is one line, the way an address is written', () => {
    expect(addressText(withStop())).toBe('2500 N 11th ST, Moorhead, MN, 56560');
  });

  it('drops the parts that are missing rather than leaving gaps', () => {
    // A ZIP-precision stop has no street line. "…, , Moorhead" is worse than
    // a shorter address, and a geocoder has to strip it either way.
    const row = withStop({ nextStop: { addressLine: null, zip: null } });
    expect(addressText(row)).toBe('Moorhead, MN');
  });

  it('is null when there is no stop, so the control does not render', () => {
    expect(addressText(fleetRow({ nextStop: null } as never))).toBeNull();
  });
});

describe('the load format', () => {
  it('labels every line, because the paste target has no column headers', () => {
    expect(loadText(withStop())).toBe(
      [
        'Load: 12120569',
        'Truck: 118',
        'Driver: M. Kowalczyk',
        'Deliver: 2500 N 11th ST, Moorhead, MN, 56560',
      ].join('\n'),
    );
  });

  it('says a missing load number is missing rather than omitting the line', () => {
    // §12.21: the load number is permanently optional. A pasted block with a
    // silently absent line is how someone comes to believe a load has a
    // number nobody recorded.
    expect(loadText(withStop({ nextStop: { loadNumber: null } }))).toContain(
      'Load: not given yet',
    );
  });

  it('says unassigned rather than dropping the driver line', () => {
    expect(loadText(withStop({ driverName: null }))).toContain('Driver: unassigned');
  });

  it('names a pickup as a pickup', () => {
    expect(loadText(withStop({ nextStop: { type: 'PU' } }))).toContain('Pick up:');
  });
});
