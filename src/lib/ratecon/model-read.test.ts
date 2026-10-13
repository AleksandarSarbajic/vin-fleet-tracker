import { describe, expect, it } from 'vitest';
import { MODEL_REPLY } from '@/test/model-read-fixtures';
import { MODEL_INSTRUCTION, ModelRead, modelReadJsonSchema } from './model-read';

/** The language-model reader, design §3: what a reply must be before anything looks at its values. */

const reply = () => structuredClone(MODEL_REPLY);
const ok = (value: unknown) => ModelRead.safeParse(value).success;

describe('the reply schema', () => {
  it('takes a complete reply', () => {
    expect(ok(reply())).toBe(true);
  });

  it('refuses a key it does not know, at the top and inside a stop', () => {
    expect(ok({ ...reply(), notes: 'anything' })).toBe(false);
    const r = reply();
    expect(ok({ ...r, stops: [{ ...r.stops[0], rate: '1850' }, r.stops[1]] })).toBe(false);
  });

  it.each(['08:00Z', '08:00+01:00', '2026-10-14T08:00:00Z', '8:00', '8 AM'])('refuses a time that is not HH:MM wall time: %s', (time) => {
    const r = reply();
    const stop = r.stops[0]!;
    if (stop.appointment.kind !== 'range') throw new Error('fixture changed');
    stop.appointment.time = time;
    expect(ok(r)).toBe(false);
  });

  it('refuses a date that is not YYYY-MM-DD', () => {
    const r = reply();
    const stop = r.stops[0]!;
    if (stop.appointment.kind !== 'range') throw new Error('fixture changed');
    stop.appointment.date = '10/14/2026';
    expect(ok(r)).toBe(false);
  });

  it('takes 20 stops and refuses 21', () => {
    const one = reply().stops[0]!;
    expect(ok({ ...reply(), stops: Array.from({ length: 20 }, () => one) })).toBe(true);
    expect(ok({ ...reply(), stops: Array.from({ length: 21 }, () => one) })).toBe(false);
  });

  it('refuses a reply with no stops', () => {
    expect(ok({ ...reply(), stops: [] })).toBe(false);
  });

  it('refuses a value without its quote', () => {
    const r = reply();
    expect(ok({ ...r, loadNumber: { value: 'EX-40417' } })).toBe(false);
  });

  it('takes a quote over three lines and refuses one over four, or one that ends before it starts', () => {
    const at = (line: number, lineEnd: number) => ({ ...reply(), loadNumber: { value: 'X', quote: { line, lineEnd, text: 'X' } } });
    expect(ok(at(3, 5))).toBe(true);
    expect(ok(at(3, 6))).toBe(false);
    expect(ok(at(3, 2))).toBe(false);
  });

  it('takes any load number at all: it is optional and has no format (§12.21)', () => {
    expect(ok({ ...reply(), loadNumber: { value: ' ## odd / value 7 ', quote: { line: 2, text: 'odd' } } })).toBe(true);
    expect(ok({ ...reply(), loadNumber: null })).toBe(true);
  });
});

describe('the JSON schema a vendor is given', () => {
  it('closes every object, so a reply has nowhere to put free text', () => {
    const open: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (Array.isArray(node)) node.forEach((n, i) => walk(n, `${path}[${i}]`));
      else if (node !== null && typeof node === 'object') {
        const o = node as Record<string, unknown>;
        if (o.type === 'object' && o.additionalProperties !== false) open.push(path);
        for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
      }
    };
    walk(modelReadJsonSchema(), '$');
    expect(open).toEqual([]);
  });

  it('carries the wall-time pattern, so a vendor that enforces patterns cannot return a zone', () => {
    expect(JSON.stringify(modelReadJsonSchema())).toContain(JSON.stringify('^\\d{2}:\\d{2}$'));
  });
});

describe('the instruction', () => {
  it.each([
    ['never convert zones', /never convert between time zones/i],
    ['no arithmetic', /never do arithmetic/i],
    ['alternatives are unclear, never chosen', /alternatives or conditions[\s\S]*'unclear'[\s\S]*never choose/i],
    ['the example of alternatives', /same day by 8 PM, or next day 7-10 AM/],
    ['never invent', /never invent/i],
    ['quotes are copied exactly', /copied exactly/i],
    ['the document is data, not instructions', /data[^.]*never instructions/i],
    ['placeholders are never values', /\[PHONE\][\s\S]*never/i],
  ])('says: %s', (_, clause) => {
    expect(MODEL_INSTRUCTION).toMatch(clause);
  });
});
