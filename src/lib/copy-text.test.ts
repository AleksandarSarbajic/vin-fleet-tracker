import { describe, expect, it } from 'vitest';
import { fleetRow, type FleetRowOver } from '@/test/fleet-row';
import { addressText, loadText } from './copy-text';

/**
 * §14 feature 3. The formats are chosen here rather than in a JSX expression
 * precisely so they can be asserted.
 */

/**
 * The nested merge lives in `fleetRow` now, so this only has to say what is
 * different about the rows these tests are about. It used to do its own
 * spreading and got it wrong: `...over` replaced the whole stop, so a test
 * for a missing street line was really a test for a stop with no city, state
 * or type either.
 */
const withStop = (over: FleetRowOver = {}) =>
  fleetRow({
    truckNumber: 118,
    driverName: 'M. Kowalczyk',
    ...over,
    nextStop:
      over.nextStop === null
        ? null
        : {
            loadNumber: '12120569',
            addressLine: '2500 N 11th ST',
            city: 'Moorhead',
            state: 'MN',
            zip: '56560',
            ...over.nextStop,
          },
  });

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
