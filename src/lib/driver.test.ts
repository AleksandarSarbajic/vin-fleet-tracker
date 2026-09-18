import { describe, expect, it } from 'vitest';
import { DriverCreate, NO_ELD_LABEL, isEldBacked, namesMatch, normalizeDriverName } from './driver';

/**
 * §12.35. Name matching is the ONLY signal Samsara gives us for a merge, so
 * what it does and does not match is the whole safety margin.
 */

describe('name matching is deliberately crude', () => {
  it('ignores case, punctuation, accents and whitespace runs', () => {
    expect(namesMatch('J Martinez', 'J.  Martinez')).toBe(true);
    expect(namesMatch('José Ruiz', 'Jose Ruiz')).toBe(true);
    expect(namesMatch("O'Brien, Pat", 'OBrien Pat')).toBe(true);
    expect(namesMatch('  ADA  LOVELACE ', 'ada lovelace')).toBe(true);
  });

  it('does NOT try to be clever about different people', () => {
    // Two J Martinezes in a 24-driver fleet is not hypothetical, and a
    // cleverer matcher raises the rate of confident wrong matches — the one
    // outcome that silently rewrites assignment history.
    expect(namesMatch('J Martinez', 'Jo Martinez')).toBe(false);
    expect(namesMatch('Jose Ruiz', 'Jose Ruis')).toBe(false);
    expect(namesMatch('Pat Smith', 'Smith Pat')).toBe(false);
  });

  it('never matches on nothing', () => {
    expect(namesMatch('', '')).toBe(false);
    expect(namesMatch('   ', '')).toBe(false);
    expect(normalizeDriverName('  ')).toBe('');
  });
});

describe('what a dispatcher must supply', () => {
  it('takes a name alone', () => {
    const parsed = DriverCreate.safeParse({ name: 'Ada Lovelace' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.phone).toBeUndefined();
  });

  it('trims the name and refuses a blank one', () => {
    expect(DriverCreate.parse({ name: '  Ada  ' }).name).toBe('Ada');
    expect(DriverCreate.safeParse({ name: '   ' }).success).toBe(false);
    expect(DriverCreate.safeParse({}).success).toBe(false);
  });

  it('treats a blank phone as null, like every other free-text field (§12.21)', () => {
    expect(DriverCreate.parse({ name: 'Ada', phone: '' }).phone).toBeNull();
    expect(DriverCreate.parse({ name: 'Ada', phone: '  ' }).phone).toBeNull();
    expect(DriverCreate.parse({ name: 'Ada', phone: ' 555-0100 ' }).phone).toBe('555-0100');
  });

  it('accepts nothing else — a field with no consumer goes stale', () => {
    expect(DriverCreate.safeParse({ name: 'Ada', licenseNumber: 'X1' }).success).toBe(false);
    expect(DriverCreate.safeParse({ name: 'Ada', employeeId: '7' }).success).toBe(false);
  });
});

describe('telling the two apart in the UI', () => {
  it('knows which drivers have an ELD behind them', () => {
    expect(isEldBacked({ source: 'samsara', samsaraDriverId: 'sam-1' })).toBe(true);
    expect(isEldBacked({ source: 'app', samsaraDriverId: null })).toBe(false);
    // After a merge the row carries Samsara's id and IS ELD-backed, whatever
    // its source says about where it started.
    expect(isEldBacked({ source: 'app', samsaraDriverId: 'sam-9' })).toBe(true);
  });

  it('labels provenance, not status', () => {
    expect(NO_ELD_LABEL).toBe('No ELD');
  });
});
