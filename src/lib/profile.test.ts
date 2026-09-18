import { describe, expect, it } from 'vitest';
import { DisplayName, initials } from './profile';

/** §12.45. The account's own two rules. */

describe('initials', () => {
  it('takes the first and the LAST name, not the first two words', () => {
    expect(initials('Mary Anne Fitzgerald')).toBe('MF');
    expect(initials('Sam Leasar')).toBe('SL');
  });

  it('gives a single name its first two letters', () => {
    expect(initials('Prince')).toBe('PR');
    expect(initials('Ada')).toBe('AD');
  });

  it('survives the shapes a text column actually holds', () => {
    expect(initials('  Sam   Leasar  ')).toBe('SL');
    expect(initials('a')).toBe('A');
    // Never throws and never renders as empty space — the circle has to
    // contain something or it reads as a broken asset.
    expect(initials('')).toBe('??');
    expect(initials('   ')).toBe('??');
  });

  it('upper-cases whatever it found', () => {
    expect(initials('sam leasar')).toBe('SL');
  });
});

describe('DisplayName', () => {
  it('trims, and that is the only thing it changes', () => {
    expect(DisplayName.parse('  Sam Leasar  ')).toBe('Sam Leasar');
  });

  /**
   * A name is not a format — the same argument as the load number (§12.21).
   * Rejecting a name someone actually has is worse than storing an odd one.
   */
  it('never rejects a name for its shape', () => {
    for (const name of ["O'Brien", 'Ann-Marie', 'Núñez', '李雷', 'de la Cruz', 'X Æ A-12']) {
      expect(DisplayName.parse(name)).toBe(name);
    }
  });

  it('refuses a blank, naming what to do rather than counting characters', () => {
    const result = DisplayName.safeParse('   ');
    expect(result.success).toBe(false);
    expect(result.success || result.error.issues[0]?.message).toBe('Enter a name.');
  });

  it('caps a paste accident', () => {
    expect(DisplayName.safeParse('x'.repeat(120)).success).toBe(true);
    expect(DisplayName.safeParse('x'.repeat(121)).success).toBe(false);
  });
});
