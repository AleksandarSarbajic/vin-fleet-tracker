import { describe, expect, it } from 'vitest';
import { SENTINEL, UNKNOWN_LAYOUT, pastedLine, pdfLine } from '@/test/model-read-fixtures';
import { REDACTION_VERSION, maskJoined, prepareForReading, redactDocument, redactLine, redactedForReview, residue } from './redact';

/**
 * Rule C (2026-10-15): "<First Last> at <COMPANY>", seen on the first page of
 * a carrier load confirmation, where it names the carrier's rep. Every name
 * and company here is invented.
 */

const S = SENTINEL;
const joined = (...cells: string[]) => redactLine(pdfLine(1, ...cells)).text;
const pasted = (text: string) => redactLine(pastedLine(text)).text;

describe('the version', () => {
  it('moved on: approvals that named a sent-text hash are void', () => {
    expect(REDACTION_VERSION).toBe('redact-2026-10-14.5');
  });
});

describe('C. a name before " at <COMPANY>" is masked, and " at <rest>" stays', () => {
  it.each([
    ['at the start of a cell', 'Dana Example at ACME FREIGHT INC - T1234567', `[REMOVED] at ACME FREIGHT INC - T1234567 ${S}`],
    ['in the middle of a cell', 'Questions go to Dana Example at ACME FREIGHT INC', `Questions go to [REMOVED] at ACME FREIGHT INC ${S}`],
    ['at the end of a cell, with a trailing company', 'Booked with Riley Quill at QUILL HAULING LLC', `Booked with [REMOVED] at QUILL HAULING LLC ${S}`],
    ['an apostrophe', "D'Arcy O'Neil at ACME FREIGHT INC", `[REMOVED] at ACME FREIGHT INC ${S}`],
    ['a hyphen', 'Mary-Jo Example-Smith at ACME FREIGHT INC', `[REMOVED] at ACME FREIGHT INC ${S}`],
    ['a middle initial', 'Dana Q. Example at ACME FREIGHT INC', `[REMOVED] at ACME FREIGHT INC ${S}`],
    ['four words', 'Dana Q. Example Jr. at ACME FREIGHT INC', `[REMOVED] at ACME FREIGHT INC ${S}`],
    ['letters outside ASCII', 'José Ejemplo at ACME FREIGHT INC', `[REMOVED] at ACME FREIGHT INC ${S}`],
    ['an ALL-CAPS name', 'DANA EXAMPLE at ACME FREIGHT INC', `[REMOVED] at ACME FREIGHT INC ${S}`],
    ['an ID after at', 'Dana Example at T1234567', `[REMOVED] at T1234567 ${S}`],
    ['an MC number after at, which the id rule has already turned into a placeholder', 'Dana Example at MC 123456', `[REMOVED] at [ID] ${S}`],
    ['a name that begins inside a word: masked from the capital (in doubt, mask)', "d'Arcy Example at ACME FREIGHT INC", `d'[REMOVED] at ACME FREIGHT INC ${S}`],
    ['a long number after at', 'Dana Example at 1234567', `[REMOVED] at 1234567 ${S}`],
    ['a company of one all-caps word', 'Dana Example at ACME', `[REMOVED] at ACME ${S}`],
    ['a company word with a comma after it', 'Dana Example at ACME, INC', `[REMOVED] at ACME, INC ${S}`],
    ['more than one space around the connector (the spaces stay)', 'Dana Example  at   ACME FREIGHT INC', `[REMOVED]  at   ACME FREIGHT INC ${S}`],
    ['two of them in one cell', 'Dana Example at ACME FREIGHT INC / Riley Quill at QUILL HAULING LLC', `[REMOVED] at ACME FREIGHT INC / [REMOVED] at QUILL HAULING LLC ${S}`],
  ])('%s', (_, text, want) => {
    expect(pasted(text)).toBe(want);
  });

  it('a stop word before the name stays; only the name goes', () => {
    expect(pasted('Call Dana Example at ACME FREIGHT INC')).toBe(`Call [REMOVED] at ACME FREIGHT INC ${S}`);
    expect(pasted('Pickup Dana Example at ACME FREIGHT INC')).toBe(`Pickup [REMOVED] at ACME FREIGHT INC ${S}`);
    expect(pasted('Ask Dana Q. Example at ACME FREIGHT INC')).toBe(`Ask [REMOVED] at ACME FREIGHT INC ${S}`);
  });

  it('five capitalised words: the last four go (the known limit: the first stays)', () => {
    expect(pasted('Alpha Beta Gamma Delta Epsilon at ACME FREIGHT INC')).toBe(`Alpha [REMOVED] at ACME FREIGHT INC ${S}`);
  });

  it('counts what it masks, in labelled and in company', () => {
    const out = redactLine(pastedLine('Dana Example at ACME FREIGHT INC'));
    expect(out.company).toBe(1);
    expect(out.masks.labelled).toBe(1);
    expect(redactLine(pastedLine('Arrive at Dock 4')).company).toBe(0);
  });
});

describe('C. joined across cells', () => {
  it('the connector in one cell and the company in the next', () => {
    expect(joined('Dana Example at', 'ACME FREIGHT INC - T1234567')).toBe(`[REMOVED] at  ACME FREIGHT INC - T1234567 ${S}`);
  });

  it('the name split over two cells', () => {
    expect(joined('Dana', 'Example at ACME FREIGHT INC')).toBe(`[REMOVED] at ACME FREIGHT INC ${S}`);
  });

  it('the name, the connector and the company each in a cell', () => {
    expect(joined('Dana Example', 'at', 'ACME FREIGHT INC')).toBe(`[REMOVED]  at  ACME FREIGHT INC ${S}`);
  });

  it('the joined pass alone does it, as the first pass does', () => {
    const counts = { email: 0, phone: 0, amount: 0, labelled: 0, id: 0, url: 0 };
    expect(maskJoined('Dana Example at  ACME FREIGHT INC', counts)).toBe('[REMOVED] at  ACME FREIGHT INC');
    expect(counts.labelled).toBe(1);
  });
});

describe('C. " with <COMPANY>" and "<Name>, <Role> at <COMPANY>"', () => {
  it.each([
    ['with an all-caps company', 'Dana Example with ACME FREIGHT INC', `[REMOVED] with ACME FREIGHT INC ${S}`],
    ['a role after a comma', 'Dana Example, Account Manager at ACME FREIGHT INC', `[REMOVED], Account Manager at ACME FREIGHT INC ${S}`],
    ['a lower-case role', 'Dana Example, sales director at ACME FREIGHT INC', `[REMOVED], sales director at ACME FREIGHT INC ${S}`],
    ['a role of several words', 'Dana Q. Example, Senior Account Manager of Logistics at ACME FREIGHT INC', `[REMOVED], Senior Account Manager of Logistics at ACME FREIGHT INC ${S}`],
    ['a role and with', 'Dana Example, Account Manager with ACME FREIGHT INC', `[REMOVED], Account Manager with ACME FREIGHT INC ${S}`],
  ])('%s', (_, text, want) => {
    expect(pasted(text)).toBe(want);
  });

  it('a comma then a name that is not a role: the second name is the one before "at", and goes', () => {
    expect(pasted('Hello Bob, Dana Example at ACME FREIGHT INC')).toBe(`Hello Bob, [REMOVED] at ACME FREIGHT INC ${S}`);
    expect(pasted('Call us, Dana Example at ACME FREIGHT INC')).toBe(`Call us, [REMOVED] at ACME FREIGHT INC ${S}`);
  });

  it('with needs a company of letters: an ID or a number after it is not enough', () => {
    expect(pasted('Loaded Trailer with ABC123')).toBe(`Loaded Trailer with ABC123 ${S}`);
    expect(pasted('Sealed Container with 1234567')).toBe(`Sealed Container with 1234567 ${S}`);
  });
});

describe('C. what is left untouched', () => {
  it.each([
    ['arrive at a dock', 'Arrive at Dock 4'],
    ['check in at a gate', 'Check in at Gate B'],
    ['pick up at a time', 'Pick up at 08:00'],
    ['Pick Up at ALL-CAPS: a facility word before it', 'Pick Up at DOCK 4'],
    ['Check In at ALL-CAPS', 'Check In at GATE B'],
    ['Delivery at a company', 'Delivery at ACME DC'],
    ['Receiving Warehouse at a company', 'Receiving Warehouse at ACME LOGISTICS'],
    ['a single word before it', 'Dana at ACME FREIGHT INC'],
    ['lower case before it', 'dana example at ACME FREIGHT INC'],
    ['a name at a mixed-case place', 'Dana Example at Acme Freight Inc'],
    ['a name at a time', 'Dana Example at 08:00'],
    ['a name at a dock', 'Dana Example at Dock 4'],
    ['a name at an hour word', 'Dana Example at 8 PM'],
    ['a name at a short number', 'Dana Example at 1234'],
    ['a time abbreviation after at', 'Dana Example at PM'],
    ['a stop heading', 'Stop 2 at ACME FREIGHT INC'],
    ['appointment words', 'Appointment Date at ACME FREIGHT INC'],
    ['"at" as the last word', 'Dana Example at'],
    ['a name with nothing but at', 'Dana Example at  '],
    ['at run into the word before', 'Dana Exampleat ACME FREIGHT INC'],
    ['at run into the next word', 'Dana Example atACME FREIGHT INC'],
    ['with run into the next word', 'Dana Example withACME FREIGHT INC'],
  ])('%s', (_, text) => {
    expect(pasted(text)).toBe(`${text} ${S}`);
  });

  it('a name with "with" and a short word is untouched', () => {
    expect(pasted('Dana Example with care')).toBe(`Dana Example with care ${S}`);
  });

  it('a label with a value keeps the label rule\'s mask, whole', () => {
    expect(pasted('Contact: Dana Example at ACME FREIGHT INC')).toBe('Contact: [REMOVED]');
    expect(pasted('Booked by Dana Example at ACME FREIGHT INC')).toBe('Booked by [REMOVED]');
  });

  it('the invented document is unchanged, and no line is touched by the rule', () => {
    const out = prepareForReading(UNKNOWN_LAYOUT);
    if (!out.ok) throw new Error(out.reason);
    expect(redactedForReview(UNKNOWN_LAYOUT).lines.every((l) => l.company === 0)).toBe(true);
    expect(out.masks).toEqual({ email: 1, phone: 3, amount: 3, labelled: 2, id: 2, url: 1 });
  });
});

describe('C. idempotent, and the re-scan fails closed', () => {
  it('the masked line, redacted again, is unchanged', () => {
    for (const text of [
      'Dana Example at ACME FREIGHT INC - T1234567',
      'Dana Example, Account Manager at ACME FREIGHT INC',
      'Dana Example with ACME FREIGHT INC',
      'Call Dana Example at ACME FREIGHT INC',
    ]) {
      const once = pasted(text);
      expect(pasted(once.replace(` ${S}`, ''))).toBe(once);
    }
    const counts = { email: 0, phone: 0, amount: 0, labelled: 0, id: 0, url: 0 };
    const once = maskJoined('Dana Example at  ACME FREIGHT INC', counts);
    expect(maskJoined(once, counts)).toBe(once);
  });

  it.each([
    ['at the start', 'Dana Example at ACME FREIGHT INC'],
    ['in the middle', 'Questions go to Dana Example at ACME FREIGHT INC'],
    ['joined across cells', 'Dana Example at  ACME FREIGHT INC'],
    ['with', 'Dana Example with ACME FREIGHT INC'],
    ['with a role', 'Dana Example, Account Manager at ACME FREIGHT INC'],
    ['an ID', 'Dana Example at T1234567'],
  ])('%s, left in a line, is a hit', (_, text) => {
    expect(residue(text)).toContain('labelled');
  });

  it.each([
    ['the masked shape', '[REMOVED] at ACME FREIGHT INC'],
    ['the masked role shape', '[REMOVED], Account Manager at ACME FREIGHT INC'],
    ['a dock', 'Arrive at Dock 4'],
    ['a gate', 'Check in at Gate B'],
    ['a time', 'Pick up at 08:00'],
    ['a facility word before it', 'Pick Up at DOCK 4'],
  ])('%s is not', (_, text) => {
    expect(residue(text)).toEqual([]);
  });

  it('a name planted in each shape never survives in the sent text', () => {
    const NAMES = /Zorblat|Quenby|Fennimore|Wexcombe|Quillfeather|Brindle|Oswin/;
    const planted = [
      pdfLine(1, 'Fargo, ND 58102'),
      pdfLine(1, 'Zorblat Quenby at ACME FREIGHT INC - T1234567'),
      pdfLine(1, 'Questions go to Fennimore Wexcombe at QUILL HAULING LLC'),
      pdfLine(1, 'Brindle Oswin', 'at', 'ACME FREIGHT INC'),
      pdfLine(1, 'Zorblat', 'Quenby at ACME FREIGHT INC'),
      pdfLine(1, 'Wexcombe Quillfeather, Account Manager at ACME FREIGHT INC'),
      pdfLine(1, 'Fennimore Brindle with ACME FREIGHT INC'),
    ];
    const out = prepareForReading(planted);
    if (!out.ok) throw new Error(out.reason);
    expect(out.text).not.toMatch(NAMES);
    expect(out.text.match(/\[REMOVED\]/g)).toHaveLength(6);
    expect(out.text).toContain('ACME FREIGHT INC');
  });

  it('a name with no company after it goes through: the known limit, pinned', () => {
    const out = prepareForReading([pdfLine(1, 'Fargo, ND 58102'), pdfLine(1, 'Zorblat Quenby of the carrier desk')]);
    if (!out.ok) throw new Error(out.reason);
    expect(out.text).toContain('Zorblat Quenby');
  });

  it('is counted on the line and by document', () => {
    const lines = [pdfLine(1, 'Zorblat Quenby at ACME FREIGHT INC'), pdfLine(1, 'Fargo, ND 58102')];
    expect(redactDocument(lines).map((l) => l.company)).toEqual([1, 0]);
  });
});
