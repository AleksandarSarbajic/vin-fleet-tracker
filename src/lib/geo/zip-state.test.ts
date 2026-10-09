import { describe, expect, it } from 'vitest';
import { zipStateCheck } from './zip-state';

/** §12.122. A ZIP whose first three digits are never in the state beside it. */
describe('a ZIP and its state', () => {
  it('agree: nothing to say', () => {
    expect(zipStateCheck('ND', '58102')).toBeNull();
    expect(zipStateCheck('il', '60160-0001')).toBeNull();
    // 581 is North Dakota only; 561 has land in two states.
    expect(zipStateCheck('SD', '56101')).toBeNull();
  });

  it('disagree: says where the ZIP is', () => {
    expect(zipStateCheck('IL', '58102')).toBe('ZIP 58102 is in ND, not IL.');
  });

  it('nothing to go on: no claim', () => {
    expect(zipStateCheck('', '58102')).toBeNull();
    expect(zipStateCheck('ND', '581')).toBeNull();
    expect(zipStateCheck('ON', '58102')).toBeNull();
  });
});
