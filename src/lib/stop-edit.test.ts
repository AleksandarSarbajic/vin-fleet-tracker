import { describe, expect, it } from 'vitest';
import { StopEdit } from './stop-edit';

/**
 * §12.21. The wire contract for the fields the edit modal patches optimistically.
 *
 * These exist because the cache and the database disagreed about what a value
 * is. The modal wrote its own form shape into the query cache — `''` where the
 * server writes `null`, `'il'` where the server writes `'IL'` — and both
 * renderers of the load number use `??`, which does not catch `''`.
 *
 * The rule the fix rests on: **the cache must never hold a shape the server
 * cannot produce.** Which means the schema has to be the single answer to
 * "what does this value become", and this file is what pins that answer.
 */

const base = {
  stopId: null,
  truckId: '00000000-0000-4000-8000-000000000000',
  loadStatus: 'AVAILABLE' as const,
  stopType: 'DEL' as const,
  addressLine: null,
  city: null,
  state: null,
  zip: null,
  appointment: null,
  dispatcherNote: null,
};

const parse = (over: Record<string, unknown>) => StopEdit.safeParse({ ...base, ...over });
const valueOf = (field: string, raw: unknown) => {
  const result = parse({ [field]: raw });
  return result.success ? (result.data as Record<string, unknown>)[field] : 'REJECTED';
};

/**
 * Every field the optimistic patch writes where blank means null, with a
 * sample that field actually accepts.
 *
 * `state` and `zip` joined this list in §12.44. They normalise as well as
 * blank-to-null, so they cannot share `'hello'` as a valid value — but the
 * `'' -> null` rule is the same one, and one rule for "clear this field"
 * across every text field is the whole point.
 */
const BLANK_IS_NULL: [field: string, sample: string, kept: string][] = [
  ['loadNumber', '  hello  ', 'hello'],
  ['addressLine', '  hello  ', 'hello'],
  ['city', '  hello  ', 'hello'],
  ['dispatcherNote', '  hello  ', 'hello'],
  ['state', '  il  ', 'IL'],
  ['zip', '  60601  ', '60601'],
];

describe('blank means null, in every field that has one', () => {
  for (const [field, sample, kept] of BLANK_IS_NULL) {
    it(`${field}: '' and whitespace both become null`, () => {
      expect(valueOf(field, '')).toBeNull();
      expect(valueOf(field, '   ')).toBeNull();
      expect(valueOf(field, '\t\n ')).toBeNull();
    });

    it(`${field}: a real value is trimmed and kept`, () => {
      expect(valueOf(field, sample)).toBe(kept);
    });

    it(`${field}: explicit null stays null`, () => {
      expect(valueOf(field, null)).toBeNull();
    });
  }

  /**
   * The audit that found the above. `loadNumber` had the transform and the
   * other four did not, so the same empty box produced NULL in one column and
   * `''` in the rest. The modal could not see it — its own `trimmed()` nulls a
   * blank before validating — but an API client posting {"city": ""} could.
   */
  it('leaves NO free-text field able to store an empty string', () => {
    const stored = BLANK_IS_NULL.map(([field]) => [field, valueOf(field, '')] as const);
    expect(stored.filter(([, value]) => value === '')).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
 * §12.44 — state and ZIP normalise in the schema, not in the modal
 * ---------------------------------------------------------------------- */

/**
 * CONTRACT CHANGE. This block used to be titled "state is the one field where
 * blank is not null", and asserted that `''` was rejected.
 *
 * It was rejected only as a side effect: `.length(2)` has no opinion about
 * blankness, it just fails on a zero-length string. That left two rules for
 * one intent — clearing the state meant `null`, clearing the city meant
 * `null` OR `''` — and two rules for one intent is how layers drift apart.
 *
 * The same `.length(2)` also accepted `'i1'` and `'1!'`, so the old rule did
 * not say what its name claimed either.
 */
describe('state is exactly two letters, uppercased (§12.44)', () => {
  it('upper-cases, which the optimistic patch reads straight out of parsed.data', () => {
    // 'il' in the cache and 'IL' in the database is the same class of bug as
    // '' versus null: the row changed under the dispatcher on refetch.
    expect(valueOf('state', 'il')).toBe('IL');
    expect(valueOf('state', '  il  ')).toBe('IL');
    expect(valueOf('state', 'IL')).toBe('IL');
    expect(valueOf('state', 'Il')).toBe('IL');
  });

  it('rejects anything that is not two LETTERS', () => {
    // The old `.length(2)` accepted every one of these but the last two.
    for (const raw of ['i1', '1!', '12', 'I', 'ILL', 'illinois', 'I.L', 'I L']) {
      expect(valueOf('state', raw)).toBe('REJECTED');
    }
  });

  it('names what is wrong rather than counting characters', () => {
    const result = parse({ state: 'illinois' });
    const message = result.success ? '' : (result.error.issues[0]?.message ?? '');
    expect(message).toContain('two-letter code');
    // The old message was "String must contain exactly 2 character(s)", which
    // tells a dispatcher nothing about what to type.
    expect(message).not.toContain('character(s)');
  });

  it('puts the issue on the state field, so the modal can point at the box', () => {
    const result = parse({ state: 'illinois' });
    expect(result.success).toBe(false);
    expect(result.success || result.error.issues[0]?.path).toEqual(['state']);
  });
});

describe('ZIP is exactly five digits, and keeps only those (§12.44)', () => {
  it('keeps a plain five', () => {
    expect(valueOf('zip', '60601')).toBe('60601');
    expect(valueOf('zip', '  60601  ')).toBe('60601');
    // A leading zero is a ZIP, not a number. Never parse these as integers.
    expect(valueOf('zip', '01890')).toBe('01890');
  });

  /**
   * Dispatchers paste this off rate confirmations. Census matches the 5-digit
   * code and ignores the +4, so storing it adds a field that can disagree
   * with itself and buys nothing.
   */
  it('accepts ZIP+4 and discards the +4', () => {
    expect(valueOf('zip', '60601-1234')).toBe('60601');
    expect(valueOf('zip', '606011234')).toBe('60601');
    expect(valueOf('zip', '60601 - 1234')).toBe('60601');
    expect(valueOf('zip', '  60601-1234  ')).toBe('60601');
  });

  it('rejects anything else', () => {
    for (const raw of ['6060', '123', 'abcde', '60601-12', '6060112345', 'IL 60601', '60601x']) {
      expect(valueOf('zip', raw)).toBe('REJECTED');
    }
  });

  it('names what is wrong, differently for the two ways to be wrong', () => {
    const shape = (raw: string) => {
      const result = parse({ zip: raw });
      return result.success ? '' : (result.error.issues[0]?.message ?? '');
    };
    expect(shape('abcde')).toContain('digits only');
    expect(shape('6060')).toContain('5 digits');
    expect(shape('60601-12')).toContain('+4');
  });

  it('stores nothing longer than five, ever', () => {
    // The column allowed 12 characters and the rule allowed anything that fit.
    for (const raw of ['60601', '60601-1234', '606011234']) {
      const stored = valueOf('zip', raw);
      expect(typeof stored === 'string' && stored.length).toBe(5);
    }
  });
});

describe('loadNumber is permanently optional (§12.21)', () => {
  it('accepts the key being absent, which is NOT the same as null', () => {
    const { loadNumber: _omitted, ...withoutKey } = { ...base, loadNumber: 'x' };
    const result = StopEdit.safeParse(withoutKey);
    expect(result.success).toBe(true);
    // Absent means "leave it alone"; null means "clear it". Collapsing them
    // would write a column the caller never mentioned — §12.23's broker wipe.
    expect(result.success && result.data.loadNumber).toBeUndefined();
  });

  it('never rejects a load number for its format — brokers number loads freely', () => {
    for (const raw of ['LD-4417', '4417', 'a/b#c 9', '///', '4417-REV-2']) {
      expect(valueOf('loadNumber', raw)).toBe(raw);
    }
  });

  it('caps length, which is the only rule it has', () => {
    expect(valueOf('loadNumber', 'x'.repeat(64))).toBe('x'.repeat(64));
    expect(valueOf('loadNumber', 'x'.repeat(65))).toBe('REJECTED');
  });
});
