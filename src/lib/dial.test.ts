import { describe, expect, it } from 'vitest';
import { dialableTel, maskPhone } from './dial';

/**
 * §12.96, stage 3. A `tel:` link only for a number that dials as it stands.
 * Made-up 555 numbers throughout; no driver's number enters a test.
 */
describe('dialableTel', () => {
  it('a bare ten-digit number', () => {
    expect(dialableTel('3125550101')).toBe('tel:+13125550101');
  });

  it('the same number with punctuation, or a leading 1', () => {
    for (const form of [
      '(312) 555-0101',
      '312.555.0101',
      '+1 312 555 0101',
      '1-312-555-0101',
    ]) {
      expect(dialableTel(form), form).toBe('tel:+13125550101');
    }
  });

  it('nothing for a number that is not one', () => {
    for (const form of [
      null,
      '',
      '555-0101', // seven digits: no area code
      '0125550101', // area code starting 0
      '3121550101', // exchange starting 1
      '31255501011', // eleven digits, not a country code
      '312 555 0101 ext 12', // an extension is not guessed at
      '+44 20 7946 0958', // not North American
    ]) {
      expect(dialableTel(form), String(form)).toBeNull();
    }
  });
});

describe('maskPhone', () => {
  it('shows the last three digits and masks the rest', () => {
    expect(maskPhone('3125550101')).toBe('•••••••101');
    expect(maskPhone('(312) 555-0101')).toBe('•••••••101');
  });
});
