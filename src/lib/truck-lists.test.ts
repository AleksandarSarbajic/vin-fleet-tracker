import { describe, expect, it } from 'vitest';
import {
  CreateListRequest,
  normalizeListName,
  parseTruckNumbers,
  resolveNumbers,
  sameListName,
  scopeToList,
} from './truck-lists';

/** §12.90 — the rules behind shared truck lists. */

describe('reading pasted truck numbers', () => {
  it('takes commas, spaces, periods, semicolons and new lines, in any mix', () => {
    expect(
      parseTruckNumbers('113, 116. 124 128;133\n135\t137,,  138..139').numbers,
    ).toEqual([113, 116, 124, 128, 133, 135, 137, 138, 139]);
  });

  it('reads the dispatcher’s twelve exactly as typed', () => {
    const parsed = parseTruckNumbers(
      '113, 116, 124, 128, 133, 135, 137, 138, 139, 141, 143, 145',
    );
    expect(parsed).toEqual({
      numbers: [113, 116, 124, 128, 133, 135, 137, 138, 139, 141, 143, 145],
      duplicates: [],
      junk: [],
    });
  });

  it('treats a period as a separator, never a decimal point', () => {
    expect(parseTruckNumbers('113.116.124').numbers).toEqual([113, 116, 124]);
  });

  it('collapses duplicates and says which', () => {
    expect(parseTruckNumbers('113 116 113, 116 113')).toEqual({
      numbers: [113, 116],
      duplicates: [113, 116],
      junk: [],
    });
  });

  it('reports junk rather than guessing at it', () => {
    expect(parseTruckNumbers('113, #116, abc, 12a, -5, 124')).toEqual({
      numbers: [113, 124],
      duplicates: [],
      junk: ['#116', 'abc', '12a', '-5'],
    });
  });

  it('reads leading zeros as the same truck, and ignores empty input', () => {
    expect(parseTruckNumbers('0137 137').numbers).toEqual([137]);
    expect(parseTruckNumbers('  , . ;\n')).toEqual({
      numbers: [],
      duplicates: [],
      junk: [],
    });
  });
});

describe('matching numbers to the fleet', () => {
  const fleet = [
    { id: 'a', truckNumber: 113, samsaraName: 'Truck #113', active: true },
    { id: 'b', truckNumber: 116, samsaraName: 'Truck #116', active: false },
    { id: 'c', truckNumber: null, samsaraName: 'Yard spare', active: true },
  ];

  it('keeps trucks by id and names the numbers that are not in the fleet', () => {
    expect(resolveNumbers([113, 999, 116, 404], fleet)).toEqual({
      ids: ['a', 'b'],
      unknown: [999, 404],
    });
  });
});

describe('the list filter', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

  it('keeps only the list’s trucks, in the order the board had them', () => {
    expect(scopeToList(rows, new Set(['c', 'a'])).map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('is the whole fleet when no list is chosen', () => {
    expect(scopeToList(rows, null)).toEqual(rows);
  });

  it('is empty — not the whole fleet — for a list with no trucks', () => {
    expect(scopeToList(rows, new Set())).toEqual([]);
  });

  it('ignores members that are not on the board', () => {
    expect(scopeToList(rows, new Set(['a', 'zzz'])).map((r) => r.id)).toEqual(['a']);
  });
});

describe('list names', () => {
  it('are one list when they differ only in case or spacing', () => {
    expect(sameListName("Bob's trucks", "  bob's   TRUCKS ")).toBe(true);
    expect(sameListName("Bob's trucks", "Bob's truck")).toBe(false);
  });

  it('are refused past 40 characters, never cut short', () => {
    expect(normalizeListName('x'.repeat(45))).toHaveLength(45);
    const parsed = CreateListRequest.safeParse({ name: 'x'.repeat(41), truckIds: [] });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe(
      'A list name is at most 40 characters.',
    );
  });

  it('are refused when blank', () => {
    expect(
      CreateListRequest.safeParse({ name: '   ', truckIds: [] }).error?.issues[0]
        ?.message,
    ).toBe('Give the list a name.');
  });
});
