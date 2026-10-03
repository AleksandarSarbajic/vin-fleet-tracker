import { describe, expect, it } from 'vitest';
import { dialableTel, formatPhone, maskPhone, normalizePhone } from './dial';

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

/**
 * §12.106. What a dispatcher may save. Made-up 555 numbers only, and no
 * assertion prints one whole: a failure names the case by its masked form and
 * compares by equality, so the report never carries a full number.
 */
describe('normalizePhone', () => {
  const stored = (typed: string) => {
    const result = normalizePhone(typed);
    return result.ok ? result.phone : null;
  };

  it('takes the ways people type a US number, and stores one form', () => {
    for (const typed of [
      '708-555-0123',
      '(708) 555 0123',
      '+1 708 555 0123',
      '708.555.0123',
      '7085550123',
      '1 (708) 555-0123',
      '  708 555 0123  ',
    ]) {
      expect(stored(typed) === '7085550123', maskPhone(typed)).toBe(true);
    }
  });

  it('blank clears the number', () => {
    expect(normalizePhone('')).toEqual({ ok: true, phone: null });
    expect(normalizePhone('   ')).toEqual({ ok: true, phone: null });
  });

  it('refuses what is not a dialable US number, with a reason', () => {
    const cases: [string, RegExp][] = [
      ['555-0123', /all 10 digits/], // no area code
      ['708-555-012', /all 10 digits/], // nine digits
      ['708-555-01234', /all 10 digits/], // eleven, not a country code
      ['058-555-0123', /all 10 digits/], // area code starting 0
      ['708-155-0123', /all 10 digits/], // exchange starting 1
      ['911-555-0123', /all 10 digits/], // N11 area code
      ['708-411-0123', /all 10 digits/], // N11 exchange
      ['+44 20 7946 0958', /Only US numbers/],
      ['+52 55 5555 0123', /Only US numbers/],
      ['708-555-0123 ext 12', /Digits only/],
      ['cell', /Digits only/],
      ['708/555/0123', /digits, spaces, dashes/],
      ['708-555-0123 #2', /digits, spaces, dashes/],
      ['70+8-555-0123', /digits, spaces, dashes/],
    ];
    for (const [typed, reason] of cases) {
      const result = normalizePhone(typed);
      expect(result.ok, maskPhone(typed)).toBe(false);
      if (!result.ok) expect(reason.test(result.message), maskPhone(typed)).toBe(true);
    }
  });

  it('never repeats what was typed in the refusal', () => {
    for (const typed of ['708-555-01234', '+44 20 7946 0958', '708-555-0123 ext 12']) {
      const result = normalizePhone(typed);
      const message = result.ok ? '' : result.message;
      // The only digits a message carries are the example's.
      expect(message.replace('708-555-0123', '').match(/\d{3,}/), maskPhone(typed)).toBeNull();
    }
  });

  it('accepts exactly what dialableTel dials', () => {
    for (const typed of ['708-555-0123', '+1 708 555 0123', '555-0123', '911-555-0123', '+44 20 7946 0958']) {
      expect(normalizePhone(typed).ok === (dialableTel(typed) !== null), maskPhone(typed)).toBe(true);
    }
  });
});

describe('formatPhone', () => {
  it('reads a stored number with dashes, and leaves anything else as it is', () => {
    expect(formatPhone('7085550123') === '708-555-0123').toBe(true);
    expect(formatPhone('not a number')).toBe('not a number');
  });
});
