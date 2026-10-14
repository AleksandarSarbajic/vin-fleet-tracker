import { describe, expect, it } from 'vitest';
import { MAX_STOPS_PER_LOAD } from '@/lib/load-edit';
import { OUTCOME_BODY_LIMIT_BYTES, OUTCOME_FIELDS, OutcomeBody, maxCount } from './outcome-codes';
import { MAX_LAYOUT_LABELS } from './layout';

/**
 * The wire contract for what the dispatcher did with an AI read (Alex,
 * 2026-10-14): a read id and, per field NAME, five small counts. The server
 * parses this and stores it; nothing in it can carry a value.
 */

const READ = '5b1e2c0a-7f3d-4c58-9a60-0e3f6d1b2a44';
const good = { readId: READ, fields: [{ field: 'street', kept: 2, changed: 0, cleared: 0, blankFilled: 0, blankLeft: 0 }] };

describe('the fixed list of field names', () => {
  it('is the seven fields a read can fill, and matches the database type', () => {
    expect([...OUTCOME_FIELDS]).toEqual(['load_number', 'stop_type', 'street', 'city', 'state', 'zip', 'appointment']);
  });

  it('bounds a count by what a read can fill: one load number, at most ten of any other', () => {
    expect(maxCount('load_number')).toBe(1);
    for (const f of OUTCOME_FIELDS.filter((f) => f !== 'load_number')) expect(maxCount(f), f).toBe(MAX_STOPS_PER_LOAD);
  });
});

describe('OutcomeBody accepts', () => {
  it('a read id and counts for a field name', () => {
    expect(OutcomeBody.safeParse(good).success).toBe(true);
  });

  it('every field at once, at the bounds', () => {
    const fields = OUTCOME_FIELDS.map((field) => ({ field, kept: maxCount(field), changed: 0, cleared: 0, blankFilled: 0, blankLeft: 0 }));
    expect(OutcomeBody.safeParse({ readId: READ, fields }).success).toBe(true);
  });

  it('counts that add up to the bound across the five', () => {
    expect(
      OutcomeBody.safeParse({ readId: READ, fields: [{ field: 'zip', kept: 4, changed: 3, cleared: 1, blankFilled: 1, blankLeft: 1 }] }).success,
    ).toBe(true);
  });
});

describe('OutcomeBody refuses', () => {
  const field = (over: Record<string, unknown>) => ({ readId: READ, fields: [{ ...good.fields[0], ...over }] });

  it.each([
    ['a field name that is not on the list', field({ field: 'dock' })],
    ['a field name that is a value', field({ field: '4001 Main St' })],
    ['a negative count', field({ kept: -1 })],
    ['a fraction', field({ kept: 1.5 })],
    ['a count above what a read can fill', field({ kept: 11 })],
    ['counts that add up to more than ten', field({ kept: 6, changed: 5 })],
    ['a second load number', { readId: READ, fields: [{ field: 'load_number', kept: 1, changed: 1, cleared: 0, blankFilled: 0, blankLeft: 0 }] }],
    ['a count that is not a number', field({ kept: '2' })],
    ['a missing count', { readId: READ, fields: [{ field: 'street', kept: 1 }] }],
    ['a field twice', { readId: READ, fields: [good.fields[0], good.fields[0]] }],
    ['no fields at all', { readId: READ, fields: [] }],
    ['more fields than there are', { readId: READ, fields: [...good.fields, ...good.fields, ...good.fields, ...good.fields, ...good.fields, ...good.fields, ...good.fields, ...good.fields] }],
    ['a read id that is not a uuid', { ...good, readId: 'not-an-id' }],
    ['a read id that is text with a value in it', { ...good, readId: '4001 Main St' }],
    ['no read id', { fields: good.fields }],
    ['an extra key on the body', { ...good, value: '4001 Main St' }],
    ['an extra key on a field', field({ value: '4001 Main St' })],
    ['an extra key that carries text under a count name', field({ note: 'x' })],
    ['nothing at all', null],
    ['a string', '{"readId":"x"}'],
  ])('%s', (_, body) => {
    expect(OutcomeBody.safeParse(body).success).toBe(false);
  });
});

/** `n` distinct 8-hex hashes in ascending order. */
const hashes = (n: number) => Array.from({ length: n }, (_, i) => i.toString(16).padStart(8, '0'));

describe('the layout fingerprint on the body (2026-10-15)', () => {
  it.each([
    ['none: an older page', undefined],
    ['an empty one: a document with no label', []],
    ['one hash', ['0a1b2c3d']],
    ['several, in ascending order', ['00000001', '0a1b2c3d', 'ffffffff']],
    ['the most: 64', hashes(MAX_LAYOUT_LABELS)],
  ])('accepts %s', (_, layout) => {
    const body = layout === undefined ? good : { ...good, layout };
    expect(OutcomeBody.safeParse(body).success).toBe(true);
  });

  it('keeps what it was given, and nothing when it was not', () => {
    const parsed = OutcomeBody.parse({ ...good, layout: ['0a1b2c3d'] });
    expect(parsed.layout).toEqual(['0a1b2c3d']);
    expect(OutcomeBody.parse(good).layout).toBeUndefined();
  });

  it.each([
    ['65 hashes', hashes(MAX_LAYOUT_LABELS + 1)],
    ['an upper-case hash', ['0A1B2C3D']],
    ['a hash of 7 characters', ['0a1b2c3']],
    ['a hash of 9 characters', ['0a1b2c3d4']],
    ['a hash that is not hex', ['0a1b2c3g']],
    ['a label instead of a hash', ['pick up date']],
    ['a value instead of a hash', ['4001 Main St']],
    ['a hash with a space', ['0a1b2c3 ']],
    ['a hash with a newline', ['0a1b2c3d\n']],
    ['the same hash twice', ['0a1b2c3d', '0a1b2c3d']],
    ['hashes out of order', ['ffffffff', '00000001']],
    ['a number', [12345678]],
    ['null in the array', [null]],
    ['a nested array', [['0a1b2c3d']]],
    ['an object', [{ hash: '0a1b2c3d' }]],
    ['a string, not an array', '0a1b2c3d'],
    ['an object, not an array', { 0: '0a1b2c3d' }],
    ['null', null],
  ])('refuses %s', (_, layout) => {
    expect(OutcomeBody.safeParse({ ...good, layout }).success).toBe(false);
  });

  it('the largest body that is valid fits in the limit', () => {
    const fields = OUTCOME_FIELDS.map((field) => ({ field, kept: 1, changed: 0, cleared: 0, blankFilled: 0, blankLeft: 0 }));
    const body = { readId: READ, fields, layout: hashes(MAX_LAYOUT_LABELS) };
    expect(OutcomeBody.safeParse(body).success).toBe(true);
    expect(JSON.stringify(body).length).toBeLessThan(OUTCOME_BODY_LIMIT_BYTES);
    expect(OUTCOME_BODY_LIMIT_BYTES).toBe(4 * 1024);
  });
});
