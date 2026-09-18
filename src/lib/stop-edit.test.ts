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

/** Every free-text field the optimistic patch writes, plus the note. */
const BLANK_IS_NULL = ['loadNumber', 'addressLine', 'city', 'zip', 'dispatcherNote'];

describe('blank means null, in every field that has one', () => {
  for (const field of BLANK_IS_NULL) {
    it(`${field}: '' and whitespace both become null`, () => {
      expect(valueOf(field, '')).toBeNull();
      expect(valueOf(field, '   ')).toBeNull();
      expect(valueOf(field, '\t\n ')).toBeNull();
    });

    it(`${field}: a real value is trimmed and kept`, () => {
      expect(valueOf(field, '  hello  ')).toBe('hello');
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
    const stored = BLANK_IS_NULL.map((field) => [field, valueOf(field, '')] as const);
    expect(stored.filter(([, value]) => value === '')).toEqual([]);
  });
});

describe('state is the one field where blank is not null', () => {
  it('rejects a blank rather than nulling it — .length(2) has no opinion to soften', () => {
    expect(valueOf('state', '')).toBe('REJECTED');
    expect(valueOf('state', '   ')).toBe('REJECTED');
  });

  it('upper-cases, which the optimistic patch used NOT to do', () => {
    // 'il' in the cache and 'IL' in the database is the same class of bug as
    // '' versus null: the row changed under the dispatcher on refetch.
    expect(valueOf('state', 'il')).toBe('IL');
    expect(valueOf('state', '  il  ')).toBe('IL');
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
