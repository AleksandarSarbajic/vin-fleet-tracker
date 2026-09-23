import { describe, expect, it } from 'vitest';
import { fleetRow } from './fleet-row';

/**
 * A test for a test fixture, which is unusual and earns its place: this
 * fixture is used by most of the component suite, and the defect it had was
 * the invisible kind. A nested override that replaces its siblings does not
 * fail — it passes, about something other than what the test says it is about.
 *
 * Every assertion here is "the sibling survived".
 */
describe('the fleet row fixture', () => {
  it('merges a partial stop into the default rather than replacing it', () => {
    const row = fleetRow({ nextStop: { city: null } });
    expect(row.nextStop?.city).toBeNull();
    // The three the old shape silently dropped.
    expect(row.nextStop?.state).toBe('IL');
    expect(row.nextStop?.addressLine).toBe('1 Broadway');
    expect(row.nextStop?.type).toBe('DEL');
  });

  it('takes null for a truck holding no load', () => {
    expect(fleetRow({ nextStop: null }).nextStop).toBeNull();
  });

  it('keeps the default stop when the override says nothing about it', () => {
    expect(fleetRow({ truckNumber: 402 }).nextStop?.city).toBe('Chicago');
  });

  /**
   * The stop is assigned AFTER the spread of the rest. Were it before, a
   * `nextStop` that survived into `rest` would overwrite the merged one and
   * the bug would be back with the comment still in place.
   */
  it('does not let the outer spread reach past the merge', () => {
    const row = fleetRow({ nextStop: { loadNumber: 'LD-9' }, truckNumber: 402 });
    expect(row.nextStop?.loadNumber).toBe('LD-9');
    expect(row.nextStop?.city).toBe('Chicago');
    expect(row.truckNumber).toBe(402);
  });
});
