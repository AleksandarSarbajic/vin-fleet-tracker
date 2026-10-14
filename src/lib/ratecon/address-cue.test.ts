import { describe, expect, it } from 'vitest';
import { MODEL_REPLY, UNKNOWN_LAYOUT, pdfLine } from '@/test/model-read-fixtures';
import type { ModelRead } from './model-read';
import { prepareForReading, type PreparedLine } from './redact';
import { addressCueText, looksLikeAddressLine, uncitedAddressLines } from './address-cue';

/**
 * The dropped-stop cue (2026-10-14, after evaluation run 1 dropped a stop no
 * check could see). Invented documents only.
 */

const sent = (lines = UNKNOWN_LAYOUT): PreparedLine[] => {
  const out = prepareForReading(lines);
  if (!out.ok) throw new Error(out.reason);
  return out.lines;
};

describe('which sent lines look like a US city, state and ZIP', () => {
  it.each([
    ['a city line', 'Fargo, ND 58102', true],
    ['with ZIP+4', 'Duluth, MN 55802-1234', true],
    ['a facility before the city', 'Lakeside Distribution Duluth MN 55802', true],
    ['a city line in a cell of its own', 'Consignee  Duluth, MN 55802  Appt 08:00', true],
    // The whole line's first state-and-ZIP pair is not a US state; only the cell finds the city.
    ['a city cell after a PO number', 'Order PO 44120  Fargo, ND 58102', true],
    ['a street', '4001 Main St', false],
    ['a date and time', 'Pick up 10/14/2026 0800-1000 APPT', false],
    ['not a US state', 'Toronto, ON 12345', false],
    ['a load number', 'Load # EX-40417', false],
  ])('%s: %s', (_, text, looks) => {
    expect(looksLikeAddressLine(text)).toBe(looks);
  });
});

describe('uncitedAddressLines: address-like lines no quote in the text covers, after the first stop', () => {
  it('a full read cites every address line: nothing', () => {
    expect(uncitedAddressLines(MODEL_REPLY, sent())).toEqual([]);
  });

  it('a DROPPED stop: its city line is uncited', () => {
    const dropped: ModelRead = { ...MODEL_REPLY, stops: [MODEL_REPLY.stops[0]!] };
    expect(uncitedAddressLines(dropped, sent())).toEqual([18]);
  });

  /** MODEL_REPLY with every cited line moved down by `by`, for a document with lines put before it. */
  const shifted = (by: number): ModelRead => JSON.parse(JSON.stringify(MODEL_REPLY).replace(/"line":(\d+)/g, (_, n: string) => `"line":${Number(n) + by}`));

  it("the broker's address in a header, BEFORE the first stop: silent (the narrowing, phase 3d)", () => {
    const withBroker = [pdfLine(1, 'EXAMPLE LOGISTICS GROUP', '100 Example Ave', 'Minneapolis, MN 55401'), ...UNKNOWN_LAYOUT];
    expect(uncitedAddressLines(shifted(1), sent(withBroker))).toEqual([]);
  });

  it("a broker's or remit-to address AFTER the first stop still fires: the cue cannot tell it from a stop", () => {
    const withRemit = [...UNKNOWN_LAYOUT, pdfLine(2, 'Remit to: Example Logistics Group, Minneapolis, MN 55401')];
    // Pasted-free PDF lines: page 3 is not sent, the remit line on page 2 is, as L21.
    expect(uncitedAddressLines(MODEL_REPLY, sent(withRemit))).toEqual([21]);
  });

  it('a dropped FIRST stop is NOT caught: its lines come before the first line any stop was read from (known miss)', () => {
    const firstDropped: ModelRead = { ...MODEL_REPLY, stops: [MODEL_REPLY.stops[1]!] };
    expect(uncitedAddressLines(firstDropped, sent())).toEqual([]);
  });

  it('no stop quote in the text at all: no first stop to start from, so every uncited address line counts', () => {
    const lost: ModelRead = {
      ...MODEL_REPLY,
      stops: MODEL_REPLY.stops.map((s) => ({
        ...s,
        type: { value: s.type.value, quote: { line: 1, text: 'not in the text' } },
        street: null,
        city: null,
        state: null,
        zip: null,
        appointment: { kind: 'none' as const },
      })),
    };
    expect(uncitedAddressLines(lost, sent())).toEqual([13, 18]);
  });

  it('a quote that is not in the text covers nothing: a made-up citation does not hide a line', () => {
    const made: ModelRead = {
      ...MODEL_REPLY,
      stops: [MODEL_REPLY.stops[0]!, { ...MODEL_REPLY.stops[1]!, city: { value: 'Duluth', quote: { line: 18, text: 'Superior, WI 54880' } }, state: null, zip: null }],
    };
    // Stop 2's street and type quotes are still real, but none cites L18 truthfully.
    expect(uncitedAddressLines(made, sent())).toEqual([18]);
  });

  it('a quote running over several lines covers each of them', () => {
    const spanning: ModelRead = {
      ...MODEL_REPLY,
      stops: [MODEL_REPLY.stops[0]!, { ...MODEL_REPLY.stops[1]!, city: null, state: null, zip: null, street: { value: '220 Harbor Rd', quote: { line: 17, lineEnd: 18, text: '220 Harbor Rd' } } }],
    };
    expect(uncitedAddressLines(spanning, sent())).toEqual([]);
  });

  it('any quote counts, not only the address fields: an appointment quoting the city line covers it', () => {
    const viaAppt: ModelRead = {
      ...MODEL_REPLY,
      stops: [MODEL_REPLY.stops[0]!, { ...MODEL_REPLY.stops[1]!, city: null, state: null, zip: null, appointment: { kind: 'unclear', quote: { line: 18, text: 'Duluth, MN 55802' } } }],
    };
    expect(uncitedAddressLines(viaAppt, sent())).toEqual([]);
  });

  it('a document with no address-like line: nothing', () => {
    const lines = sent([pdfLine(1, 'Load # EX-40417'), pdfLine(1, 'Pick up 10/14/2026 08:00')]);
    expect(uncitedAddressLines({ ...MODEL_REPLY, stops: [MODEL_REPLY.stops[0]!] }, lines)).toEqual([]);
  });

  it('in line order, each once', () => {
    const none: ModelRead = { ...MODEL_REPLY, loadNumber: null, stops: [{ ...MODEL_REPLY.stops[0]!, city: null, state: null, zip: null }] };
    expect(uncitedAddressLines(none, sent())).toEqual([13, 18]);
  });
});

describe('what the strip says', () => {
  it.each([
    [[], null],
    [[18], '1 line that looks like an address was not used: L18'],
    [[12, 45], '2 lines that look like addresses were not used: L12, L45'],
  ] as const)('%j', (lines, text) => {
    expect(addressCueText(lines)).toBe(text);
  });
});
