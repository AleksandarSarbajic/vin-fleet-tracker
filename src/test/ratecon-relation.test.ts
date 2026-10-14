import { describe, expect, it } from 'vitest';
import { relationOf, relationSaid } from '../../scripts/ratecon-relation.mjs';

/**
 * How a wrong street or city differs from the ground truth, by CODE and
 * COUNTS only (phase 3o). Invented values; no sample is read.
 *
 * Each pair of strings gets exactly one code. The order of the tests is the
 * precedence, and each case below that sits on a boundary says which code
 * wins and why.
 */

const said = (read: string, truth: string) => relationSaid(relationOf(read, truth));

describe('one code for each way a value can differ', () => {
  it('equal', () => {
    expect(said('4001 Main St', '4001 Main St')).toBe('equal (read 3, truth 3)');
  });

  it('case-only', () => {
    expect(said('4001 MAIN ST', '4001 Main St')).toBe('case-only (read 3, truth 3)');
  });

  it('punctuation-only: commas, periods and hyphens', () => {
    expect(said('4001 Main St.', '4001 Main St')).toBe('punctuation-only (read 3, truth 3)');
    expect(said('4001 Main, St', '4001 Main St')).toBe('punctuation-only (read 3, truth 3)');
    // A hyphen is a word break: "Winston-Salem" is two words, as "Winston Salem" is.
    expect(said('Winston-Salem', 'Winston Salem')).toBe('punctuation-only (read 2, truth 2)');
  });

  it('spacing-only: the same words, a different gap between them', () => {
    expect(said('4001  Main St', '4001 Main St')).toBe('spacing-only (read 3, truth 3)');
  });

  it('read has N extra leading words', () => {
    expect(said('Bldg 2 4001 Main St', '4001 Main St')).toBe('read has 2 extra leading words (read 5, truth 3)');
    expect(said('Bldg 4001 Main St', '4001 Main St')).toBe('read has 1 extra leading word (read 4, truth 3)');
  });

  it('read has N extra trailing words', () => {
    expect(said('4001 Main St Dock 4', '4001 Main St')).toBe('read has 2 extra trailing words (read 5, truth 3)');
    expect(said('4001 Main St Dock', '4001 Main St')).toBe('read has 1 extra trailing word (read 4, truth 3)');
  });

  it('read is missing N leading words', () => {
    expect(said('Main St', '4001 Main St')).toBe('read is missing 1 leading word (read 2, truth 3)');
    expect(said('St', '4001 Main St')).toBe('read is missing 2 leading words (read 1, truth 3)');
  });

  it('read is missing N trailing words', () => {
    expect(said('4001 Main', '4001 Main St')).toBe('read is missing 1 trailing word (read 2, truth 3)');
    expect(said('4001', '4001 Main St')).toBe('read is missing 2 trailing words (read 1, truth 3)');
  });

  it('same words in a different order', () => {
    expect(said('Main 4001 St', '4001 Main St')).toBe('same words in a different order (read 3, truth 3)');
  });

  it('different words (K of M words differ)', () => {
    // K is the words that do not pair up; M is the longer of the two.
    expect(said('4001 Main Street', '4001 Main St')).toBe('different words (1 of 3 words differ; read 3, truth 3)');
    expect(said('9 Elm Ave', '4001 Main St')).toBe('different words (3 of 3 words differ; read 3, truth 3)');
    // An extra word in the middle is neither leading nor trailing.
    expect(said('4001 North Main St', '4001 Main St')).toBe('different words (1 of 4 words differ; read 4, truth 3)');
  });

  it('read is empty', () => {
    expect(said('', '4001 Main St')).toBe('read is empty (read 0, truth 3)');
    expect(said('   ', '4001 Main St')).toBe('read is empty (read 0, truth 3)');
  });

  it('truth is empty: a value where the document gives none (not in the list Alex gave; it would otherwise be "different words (0 of 0)")', () => {
    expect(said('4001 Main St', '')).toBe('truth is empty (read 3, truth 0)');
  });
});

describe('precedence: where two codes could apply, the first of these wins', () => {
  it('case and punctuation together: punctuation-only. Punctuation is compared without regard to case, and case-only needs the punctuation identical', () => {
    expect(said('4001 MAIN ST,', '4001 Main St')).toBe('punctuation-only (read 3, truth 3)');
  });

  it('an extra word and a comma: extra trailing words. Words are compared with the commas, periods and hyphens taken out, so the extra word is the difference that is left, and the comma is not mentioned', () => {
    expect(said('4001 Main St, Dock', '4001 Main St')).toBe('read has 1 extra trailing word (read 4, truth 3)');
    expect(said('4001 MAIN ST DOCK', '4001 Main St')).toBe('read has 1 extra trailing word (read 4, truth 3)');
  });

  it('a leading and a trailing extra word at once is neither: different words', () => {
    expect(said('Bldg 4001 Main St Dock', '4001 Main St')).toBe('different words (2 of 5 words differ; read 5, truth 3)');
  });

  it('when the extra words could be leading or trailing (a repeated word), trailing wins, because it is tested first', () => {
    expect(said('Main Main Main', 'Main Main')).toBe('read has 1 extra trailing word (read 3, truth 2)');
  });

  it('a read that is only punctuation has no words: read is empty', () => {
    expect(said('-', '4001 Main St')).toBe('read is empty (read 0, truth 3)');
  });

  it('two values that are blank after trimming are equal', () => {
    expect(said('', '')).toBe('equal (read 0, truth 0)');
    expect(said(' ', '')).toBe('equal (read 0, truth 0)');
  });

  it('exactly one code each, over a spread of pairs', () => {
    const pairs: [string, string][] = [
      ['a', 'a'], ['A', 'a'], ['a.', 'a'], ['a  b', 'a b'], ['x a', 'a'], ['a x', 'a'], ['b', 'a b'], ['a', 'a b'],
      ['b a', 'a b'], ['c', 'a b'], ['', 'a'], ['a', ''],
    ];
    const kinds = pairs.map(([r, t]) => relationOf(r, t).kind);
    expect(kinds).toEqual([
      'equal', 'case-only', 'punctuation-only', 'spacing-only', 'extra-leading', 'extra-trailing',
      'missing-leading', 'missing-trailing', 'same-words-different-order', 'different-words', 'read-empty', 'truth-empty',
    ]);
  });
});

describe('it says nothing of the values', () => {
  it('counts and codes only, whatever the words are', () => {
    const SENTINEL = 'qqsentinelqq';
    const lines = [
      said(`4001 Main St ${SENTINEL}`, '4001 Main St'),
      said(`${SENTINEL} Elm`, `Harbor ${SENTINEL}`),
      said(SENTINEL, ''),
      said('', SENTINEL),
      said(`${SENTINEL.toUpperCase()}`, SENTINEL),
    ];
    for (const line of lines) {
      expect(line).not.toContain(SENTINEL);
      expect(line.toLowerCase()).not.toContain('main');
      expect(line.toLowerCase()).not.toContain('elm');
      expect(line.toLowerCase()).not.toContain('harbor');
      expect(line).toMatch(/^[a-z-]+( [a-z]+)*( \(\d+ of \d+ words differ; read \d+, truth \d+\)| \(read \d+, truth \d+\))$|^read (has|is missing) \d+ (extra )?(leading|trailing) words? \(read \d+, truth \d+\)$/);
    }
  });
});
