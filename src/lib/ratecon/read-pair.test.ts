import { describe, expect, it } from 'vitest';
import { MODEL_REPLY, UNKNOWN_LAYOUT } from '@/test/model-read-fixtures';
import type { ModelRead } from './model-read';
import { prepareForReading, type PreparedLine } from './redact';
import { readPair, type PairSide } from './read-pair';

/**
 * The pair, from two replies to the fill's input: verify each read against
 * exactly the lines sent, `agreePair`, then the cue, notices and `differed`.
 * The browser strip and `ratecon:eval-ai` both call this, so what is
 * measured is what runs. Invented documents only.
 */

const NOW = new Date('2026-10-13T15:00:00Z');
const sent = (): PreparedLine[] => {
  const out = prepareForReading(UNKNOWN_LAYOUT);
  if (!out.ok) throw new Error(out.reason);
  return out.lines;
};
const ok = (reply: ModelRead): PairSide<string> => ({ ok: true, reply });
const failed = (code: string): PairSide<string> => ({ ok: false, code });
const pair = (a: PairSide<string>, b: PairSide<string>) => readPair(a, b, sent(), NOW);

/** Every quote a made-up citation: nothing in the reply stands. */
const lost: ModelRead = {
  ...MODEL_REPLY,
  loadNumber: { value: 'X', quote: { line: 1, text: 'not in the text' } },
  stops: MODEL_REPLY.stops.map((s) => ({
    type: { value: s.type.value, quote: { line: 1, text: 'not in the text' } },
    street: null,
    city: null,
    state: null,
    zip: null,
    appointment: { kind: 'none' },
  })),
};

describe('two replies that agree', () => {
  it('fill as the one read does: layout model, no notice, nothing differed, the cue silent', () => {
    const out = pair(ok(MODEL_REPLY), ok(structuredClone(MODEL_REPLY)));
    if (!out.ok) throw new Error('expected an agreement');
    expect(out.agreed).toBe(true);
    expect(out.agreement.read.layout).toBe('model');
    expect(out.agreement.read.stops.map((s) => s.street?.value)).toEqual(['4001 Main St', '220 Harbor Rd']);
    expect(out.agreement.notices).toEqual([]);
    expect(out.agreement.differed).toEqual([]);
    expect(out.agreement.stopCounts).toBeNull();
    expect(out.cue).toEqual([]);
  });

  it('carries each read on its own, with its counts, for a caller that scores them apart', () => {
    const out = pair(ok(MODEL_REPLY), ok(MODEL_REPLY));
    if (!out.ok) throw new Error('expected an agreement');
    expect(out.reads).toHaveLength(2);
    for (const r of out.reads) {
      expect(r.verified.read.layout).toBe('model');
      expect(r.verified.confirmed).toBeGreaterThan(0);
      expect(r.verified.unconfirmed).toBe(0);
    }
  });
});

describe('two replies that differ', () => {
  it('on a field: it is blank and marked, and named', () => {
    const b: ModelRead = structuredClone(MODEL_REPLY);
    b.stops[0]!.zip = { value: '58103', quote: { line: 13, text: 'Fargo, ND 58102' } };
    const out = pair(ok(MODEL_REPLY), ok(b));
    if (!out.ok) throw new Error('expected an agreement');
    expect(out.agreed).toBe(false);
    expect(out.agreement.differed).toEqual([{ stop: 1, field: 'zip' }]);
    expect(out.agreement.read.stops[0]!.zip).toBeNull();
    expect(out.agreement.notices).toEqual(['The two AI reads differed on 1 field; each is left blank and marked.']);
  });

  it('on the stop count: the read with more gives the stops, and both counts are said', () => {
    const one: ModelRead = { ...MODEL_REPLY, stops: [MODEL_REPLY.stops[0]!] };
    for (const [a, b] of [[MODEL_REPLY, one], [one, MODEL_REPLY]] as const) {
      const out = pair(ok(a), ok(b));
      if (!out.ok) throw new Error('expected an agreement');
      expect(out.agreed).toBe(false);
      expect(out.agreement.stopCounts).toEqual({ a: a.stops.length, b: b.stops.length });
      expect(out.agreement.read.stops).toHaveLength(2);
      expect(out.agreement.notices[0]).toBe(
        `The two AI reads found ${a.stops.length} and ${b.stops.length} stops. The 2 shown are the read with more; check each against the document.`,
      );
    }
  });
});

describe('a pair fails as a whole', () => {
  it('one read confirmed nothing: the pair fails with nothing_confirmed and fills nothing — never the read that stood', () => {
    const out = pair(ok(MODEL_REPLY), ok(lost));
    expect(out).toEqual({ ok: false, code: 'nothing_confirmed', codes: ['ok', 'nothing_confirmed'] });
    expect(Object.keys(out)).not.toContain('agreement');
    expect(Object.keys(out)).not.toContain('reads');
  });

  it.each([
    ['A failed', failed('timeout'), ok(MODEL_REPLY), 'timeout', ['timeout', 'ok']],
    ['B failed', ok(MODEL_REPLY), failed('unavailable'), 'unavailable', ['ok', 'unavailable']],
    ['both failed: A\'s code', failed('refused'), failed('timeout'), 'refused', ['refused', 'timeout']],
    ['A failed and B confirmed nothing: A\'s code', failed('invalid_output'), ok(lost), 'invalid_output', ['invalid_output', 'nothing_confirmed']],
    ['A confirmed nothing and B failed: A\'s code', ok(lost), failed('timeout'), 'nothing_confirmed', ['nothing_confirmed', 'timeout']],
  ] as const)('%s', (_, a, b, code, codes) => {
    const out = pair(a, b);
    expect(out).toEqual({ ok: false, code, codes });
  });
});

describe('the dropped-stop cue, for a pair', () => {
  const dropped: ModelRead = { ...MODEL_REPLY, stops: [MODEL_REPLY.stops[0]!] };

  it('a line either read cited is used: only a line neither cited is named', () => {
    const out = pair(ok(MODEL_REPLY), ok(dropped));
    if (!out.ok) throw new Error('expected an agreement');
    expect(out.cue).toEqual([]);
  });

  it('a line neither read cited is named', () => {
    const out = pair(ok(dropped), ok(structuredClone(dropped)));
    if (!out.ok) throw new Error('expected an agreement');
    expect(out.cue).toEqual([18]);
  });
});

describe('nothing is changed', () => {
  it('neither reply is touched', () => {
    const a = structuredClone(MODEL_REPLY);
    const b = structuredClone(MODEL_REPLY);
    b.stops[1]!.city = null;
    const [a0, b0] = [structuredClone(a), structuredClone(b)];
    pair(ok(a), ok(b));
    expect([a, b]).toEqual([a0, b0]);
  });
});
