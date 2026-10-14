import { describe, expect, it } from 'vitest';
import { SENTINEL, UNKNOWN_LAYOUT, pastedLine, pdfLine } from '@/test/model-read-fixtures';
import type { Line } from './lines';
import { REDACTION_VERSION, identifierLabelBefore, prepareForReading, redactDocument, redactLine, redactedForReview, residue } from './redact';

/**
 * Two gaps found in the redacted text "Show what is sent" displays
 * (2026-10-14): a bare phone with no separators and no phone word, and a
 * person's name in the row below a header row that names a person. Every
 * name and number here is invented.
 */

const S = SENTINEL;
const joined = (...cells: string[]) => redactLine(pdfLine(1, ...cells)).text;

/** A line with no sentinel, so a row can be exactly its cells. A page is 1 unless said. */
const row = (...cells: string[]): Line => ({ page: 1, cells: cells.map((text, i) => ({ x: 40 + i * 220, text })), text: cells.join('  ') });
const rowOn = (page: number, ...cells: string[]): Line => ({ ...row(...cells), page });
const doc = (...lines: Line[]) => redactDocument(lines).map((l) => l.text);

describe('the version', () => {
  it('moved on: a server on the old rules refuses, and approvals that named a hash are void', () => {
    expect(REDACTION_VERSION).toBe('redact-2026-10-14.4');
  });
});

describe('A. a bare phone: ten digits, or eleven starting with 1, with an assigned area code', () => {
  it.each([
    ['ten digits in a cell of their own', ['6125550147'], `[PHONE] ${S}`],
    ['eleven digits starting with 1, in a cell of their own', ['16125550147'], `[PHONE] ${S}`],
    ['ten digits after an address cell', ['220 Harbor Rd', '6125550147'], `220 Harbor Rd  [PHONE] ${S}`],
    ['ten digits after a city line', ['Duluth, MN 55802', '2185550123'], `Duluth, MN 55802  [PHONE] ${S}`],
    ['eleven digits in a driver row', ['Sam', '16125550147', '5301'], `Sam  [PHONE]  5301 ${S}`],
    ['a toll-free number', ['8885550147'], `[PHONE] ${S}`],
    ['ten digits among words, in a joined line', ['Dock office 6125550147 open'], `Dock office [PHONE] open ${S}`],
    ['ten digits before a full stop', ['Dock: 6125550147.'], `Dock: [PHONE]. ${S}`],
    ['two bare phones in one line', ['6125550147', '2185550123'], `[PHONE]  [PHONE] ${S}`],
  ])('%s', (_, cells, want) => {
    expect(joined(...cells)).toBe(want);
  });

  it('a pasted line, one cell', () => {
    expect(redactLine(pastedLine('Gate 6125550147 after hours')).text).toBe(`Gate [PHONE] after hours ${S}`);
  });

  it.each([
    ['an area code nobody has been assigned', ['2005550147']],
    ['eleven digits, a 1 and then an unassigned area code', ['12005550147']],
    ['a 10-digit number that starts with 1', ['1234567890']],
    ['eleven digits that do not start with 1', ['26125550147']],
    ['twelve digits', ['161255501471']],
    ['nine digits', ['612555014']],
    ['digits with a letter before', ['EX6125550147']],
    ['digits with a letter after', ['6125550147A']],
    ['digits that are the tail of a hyphenated id', ['EX-6125550147']],
    ['digits with a decimal part', ['6125550147.50']],
  ])('keeps %s', (_, cells) => {
    expect(joined(...cells)).toBe(`${cells.join('  ')} ${S}`);
  });

  const LABELS = [
    'Load', 'Load #', 'Load No.', 'Load Number', 'Order', 'Order #', 'PRO', 'Pro #', 'BOL', 'BOL #', 'PO', 'PO #', 'SO', 'SI',
    'Ref', 'Ref #', 'Reference', 'Reference #', 'Shipment', 'Shipment ID', 'Pickup', 'Pickup #', 'Delivery', 'Delivery #',
    'Confirmation', 'Confirmation #', 'Tracking', 'Tracking #', 'Trip', 'Trip #', 'Stop #',
  ];

  it.each(LABELS)('keeps a number after the label "%s" in the same cell', (label) => {
    expect(joined(`${label}: 6125550147`)).toBe(`${label}: 6125550147 ${S}`);
    expect(joined(`${label} 16125550147`)).toBe(`${label} 16125550147 ${S}`);
  });

  it.each(LABELS)('keeps a number after the label "%s" in the previous cell', (label) => {
    expect(joined(label, '6125550147')).toBe(`${label}  6125550147 ${S}`);
    expect(joined(`${label}:`, '16125550147')).toBe(`${label}:  16125550147 ${S}`);
  });

  it('the label is not case-sensitive', () => {
    expect(joined('load #', '6125550147')).toBe(`load #  6125550147 ${S}`);
    expect(joined('LOAD NUMBER:', '6125550147')).toBe(`LOAD NUMBER:  6125550147 ${S}`);
  });

  it.each([
    ['a label two cells back', ['Load #', 'Origin', '6125550147'], `Load #  Origin  [PHONE] ${S}`],
    ['a label that is the end of a longer word', ['Unloader', '6125550147'], `Unloader  [PHONE] ${S}`],
    ['a label with another number between', ['Load 4417', '6125550147'], `Load 4417  [PHONE] ${S}`],
    ['a label that is not an identifier label', ['Dock', '6125550147'], `Dock  [PHONE] ${S}`],
    ['a number before the label, not after', ['6125550147', 'Load #'], `[PHONE]  Load # ${S}`],
  ])('does not take %s as a guard', (_, cells, want) => {
    expect(joined(...cells)).toBe(want);
  });

  it('keeps the phone-word rule: a phone word still masks ten digits, and eleven', () => {
    expect(joined('Tel 6125550147')).toBe(`Tel [PHONE] ${S}`);
    expect(joined('Cell: 12005550147')).toBe(`Cell: [PHONE] ${S}`);
  });

  it('counts what it masks, in phone and in bare', () => {
    const out = redactLine(pdfLine(1, '220 Harbor Rd', '6125550147'));
    expect(out.masks.phone).toBe(1);
    expect(out.bare).toBe(1);
    const kept = redactLine(pdfLine(1, 'Load #', '6125550147'));
    expect(kept.masks.phone).toBe(0);
    expect(kept.bare).toBe(0);
    expect(redactLine(pdfLine(1, 'Tel 6125550147')).bare).toBe(0);
  });

  it('is idempotent: the masked line, redacted again, is unchanged', () => {
    for (const cells of [['220 Harbor Rd', '6125550147'], ['16125550147'], ['Load #', '6125550147']]) {
      const once = joined(...cells);
      expect(redactLine(pastedLine(once)).text).toBe(`${once} ${S}`);
    }
  });

  it('a masked line is clean to the re-scan, and a kept load number is not a hit', () => {
    expect(residue(joined('220 Harbor Rd', '6125550147'))).toEqual([]);
    expect(residue(joined('Load #', '6125550147'))).toEqual([]);
  });
});

describe('A. the re-scan fails closed on a bare phone left behind', () => {
  it.each([
    ['ten digits alone', '6125550147'],
    ['eleven digits alone', '16125550147'],
    ['ten digits after an address cell', '220 Harbor Rd  6125550147'],
    ['ten digits among words', 'Dock office 6125550147 open'],
    ['a label that is not an identifier label', 'Dock  6125550147'],
    ['a label two cells back', 'Load #  Origin  6125550147'],
  ])('%s is a hit', (_, text) => {
    expect(residue(text)).toContain('phone');
  });

  it.each([
    ['an unassigned area code', '2005550147'],
    ['twelve digits', '161255501471'],
    ['after a load label, in the cell before', 'Load #  6125550147'],
    ['after a load label, in the same cell', 'Pro # 6125550147'],
    ['a placeholder', 'Dock  [PHONE]'],
  ])('%s is not', (_, text) => {
    expect(residue(text)).toEqual([]);
  });

  it('a document with a bare phone planted in its sent line is refused, not sent', () => {
    const out = prepareForReading([pdfLine(1, 'Fargo, ND 58102'), pdfLine(1, 'Dock', '6125550147')]);
    if (!out.ok) throw new Error(out.reason);
    expect(out.lines[1]!.text).toBe(`Dock  [PHONE] ${S}`);
    expect(residue('Dock  6125550147')).toEqual(['phone']);
  });
});

describe('B. a name in the row below a header row that names a person', () => {
  it('a header row, then a contact row: the names, the phone and the email go', () => {
    const [, below] = doc(row('Contact', 'Phone', 'Email'), row('Dana Example', '612-555-0147', 'dana@example.com'));
    expect(below).toBe('[REMOVED]  [PHONE]  [EMAIL]');
  });

  it('a driver row: a first name alone goes, the bare phone goes, a truck number stays', () => {
    const [, below] = doc(row('Driver Name', 'Driver Cell', 'Truck #'), row('Sam', '16125550147', '5301'));
    expect(below).toBe('[REMOVED]  [PHONE]  5301');
  });

  it('a header with its label alone on the line, the name on the next', () => {
    expect(doc(row('Dispatcher:'), row('Dana Example'))[1]).toBe('[REMOVED]');
  });

  it('a header of person labels with others beside them: the company cell stays, the name goes', () => {
    const [, below] = doc(row('Carrier', 'Carrier Contact', 'Phone'), row('EXAMPLE FREIGHT LLC', 'Dana Example', '612-555-0147'));
    expect(below).toBe('EXAMPLE FREIGHT LLC  [REMOVED]  [PHONE]');
  });

  it('two header rows: the second is not a row of values, and masks the row below it', () => {
    const header2 = row('Driver Name', 'Driver Cell');
    const out = doc(row('Carrier Contact', 'Phone'), header2, row('Sam Placeholder', '16125550147'));
    expect(out[1]).toBe(redactLine(header2).text);
    expect(out[2]).toBe('[REMOVED]  [PHONE]');
  });

  it('a blank line between the header and the values: the line after the blank is masked', () => {
    expect(doc(row('Contact'), row(), row('Dana Example'))[2]).toBe('[REMOVED]');
  });

  it('a line of placeholders only between the header and the values counts as blank', () => {
    expect(doc(row('Contact', 'Phone'), row('612-555-0147'), row('Dana Example'))[2]).toBe('[REMOVED]');
  });

  it('looks no further than the next line, and the one after it when the next is blank', () => {
    const out = doc(row('Contact'), row('Dana Example'), row('Riley Quill'));
    expect(out[1]).toBe('[REMOVED]');
    expect(out[2]).toBe('Riley Quill');
    const blank = doc(row('Contact'), row(), row('Dana Example'), row('Riley Quill'));
    expect(blank[2]).toBe('[REMOVED]');
    expect(blank[3]).toBe('Riley Quill');
    const two = doc(row('Contact'), row(), row(), row('Dana Example'));
    expect(two[3]).toBe('Dana Example');
  });

  it('a row with content, then another: the second is not under the header', () => {
    expect(doc(row('Contact'), row('Fargo, ND 58102'), row('Dana Example'))[2]).toBe('Dana Example');
  });

  it.each([
    ['one word', 'Sam', true],
    ['two words', 'Dana Example', true],
    ['four words', 'Dana Q. Example Smith', true],
    ['five words', 'Dana Q. Example Smith Quill', false],
    ['apostrophes, hyphens and periods', "D'Arcy O'Neil-Example Jr.", true],
    ['letters outside ASCII', 'José Ejemplo', true],
    ['lower case', 'dana example', true],
    ['all caps with no company word', 'DANA EXAMPLE', true],
    ['a facility name in mixed case: in doubt, masked', 'Prairie Cold Storage', true],
    ['a company name in mixed case: in doubt, masked', 'Example Logistics Inc', true],
    ['a street name with no number: in doubt, masked (a surname can be Lane or Court)', 'Pat Lane', true],
  ])('a cell of %s', (_, cell, masked) => {
    const [, below] = doc(row('Contact'), row(cell));
    expect(below).toBe(masked ? '[REMOVED]' : cell);
  });

  it.each([
    'EXAMPLE LOGISTICS INC',
    'EXAMPLE LOGISTICS',
    'PRAIRIE FREIGHT',
    'LAKESIDE DC',
    'NORTH WAREHOUSE',
    'EXAMPLE TRANSPORT CO',
    'EXAMPLE TRUCKING LTD',
    'EXAMPLE EXPRESS',
    'EXAMPLE GROUP',
    'EXAMPLE SERVICES',
    'EXAMPLE SOLUTIONS',
    'EXAMPLE DISTRIBUTION',
    'EXAMPLE CORP.',
    'EXAMPLE LLC',
  ])('keeps the company cell %s', (cell) => {
    expect(doc(row('Contact'), row(cell))[1]).toBe(cell);
  });

  it.each([
    ['a city line', 'Fargo, ND 58102'],
    ['a street', '4001 Main St'],
    ['a state', 'ND'],
    ['a ZIP', '58102'],
    ['a date', '10/14/2026'],
    ['a time', '08:00'],
    ['a time range', '0800-1000'],
    ['a weekday range', 'Mon-Fri'],
    ['a load number', 'EX-40417'],
    ['a truck number', '5301'],
    ['a placeholder', '[REMOVED]'],
  ])('keeps %s', (_, cell) => {
    expect(doc(row('Contact'), row(cell))[1]).toBe(cell);
  });

  it('a name beside a phone in one cell: the placeholders stay, the name goes', () => {
    expect(doc(row('Contact'), row('Dana Example 612-555-0147'))[1]).toBe('[REMOVED] [PHONE]');
    expect(doc(row('Contact'), row('612-555-0147 Dana Example'))[1]).toBe('[PHONE] [REMOVED]');
  });

  it('a person label cell with a value beside it: that line as before; the row below is masked too (the cost of "whatever follows")', () => {
    const same = row('Contact:', 'Dana Example');
    const out = doc(same, row('Prairie Cold Storage'), row('Riley Quill'));
    expect(out[0]).toBe(redactLine(same).text);
    expect(out[0]).toBe('Contact:  [REMOVED]');
    expect(out[1]).toBe('[REMOVED]');
    expect(out[2]).toBe('Riley Quill');
    expect(doc(row('Dispatcher:', 'Dana', 'Example'), row('Riley Quill'))[1]).toBe('[REMOVED]');
  });

  it('a label inside a longer cell is not a header: "Contact: Dana Example" in one cell, a sentence ending in "contact"', () => {
    expect(doc(row('Contact: Dana Example'), row('Prairie Cold Storage'))[1]).toBe('Prairie Cold Storage');
    expect(doc(row('For questions please contact'), row('Riley Quill'))[1]).toBe('Riley Quill');
    expect(doc(row('Sales Rep'), row('Riley Quill'))[1]).toBe('Riley Quill');
  });

  it('a row that is not under a header is untouched: names, facilities, cities', () => {
    const rows = [row('Dana Example'), row('Prairie Cold Storage', 'Pick Up 1'), row('Duluth, MN 55802')];
    expect(doc(...rows)).toEqual(rows.map((r) => redactLine(r).text));
  });

  it('only a PERSON header: phone, email, shipper, receiver and truck headers do not mask the row below', () => {
    expect(doc(row('Phone', 'Email'), row('Dana Example'))[1]).toBe('Dana Example');
    expect(doc(row('Shipper', 'Receiver'), row('Prairie Cold Storage', 'Lakeside Distribution'))[1]).toBe(
      'Prairie Cold Storage  Lakeside Distribution',
    );
    expect(doc(row('Truck #', 'Trailer #'), row('Dana'))[1]).toBe('Dana');
  });

  it('a header on one page does not mask the first row of the next', () => {
    const out = redactDocument([rowOn(1, 'Contact'), rowOn(2, 'Dana Example')]);
    expect(out[1]!.text).toBe('Dana Example');
  });

  it('a label masked here no longer guards its number: the number is masked, and the document is not refused', () => {
    // "Load" alone under a person header is taken for a name; its number then has no label.
    const lines = [pdfLine(1, 'Fargo, ND 58102'), row('Contact'), row('Load', '6125550147')];
    expect(doc(row('Contact'), row('Load', '6125550147'))[1]).toBe('[REMOVED]  [PHONE]');
    const out = prepareForReading(lines);
    expect(out.ok).toBe(true);
    expect(redactedForReview(lines).lines[2]).toMatchObject({ bare: 1, below: 1, residue: [] });
  });

  it('counts what it masks: below on the line, in labelled too', () => {
    const out = redactDocument([row('Contact', 'Phone', 'Email'), row('Dana Example', 'Riley', '612-555-0147')]);
    expect(out[0]!.below).toBe(0);
    expect(out[1]!.below).toBe(2);
    expect(out[1]!.masks.labelled).toBe(2);
    expect(out[1]!.masks.phone).toBe(1);
    expect(redactDocument([row('Fargo, ND 58102')])[0]!.below).toBe(0);
  });

  it('is idempotent: the masked document, redacted again, is unchanged', () => {
    const once = doc(row('Contact', 'Phone'), row('Dana Example', '612-555-0147'), row('Driver Name'), row(), row('Sam'));
    const again = doc(...once.map((t) => row(t)));
    expect(again).toEqual(once);
  });
});

describe('B, finished: a header row is any row with a cell that is exactly a person label, whatever follows', () => {
  // Invented, in the shape of a carrier table seen on a real sample: a title row, a header row whose
  // cells after the label are not header words (and are consumed by the label rule), a row of values.
  const title = row('CARRIER INFORMATION', 'CONTACT INFORMATION');
  const header = row('Carrier', 'Contact', 'Office, Direct', 'Mailbox Addr');
  const values = row('ACME HAULING INC', 'ZORBLAT QUENBY', 'Fennimore Wexcombe', '612-555-0147');

  it('the exact shape: both person cells go, the company cell stays, the phone is masked', () => {
    const out = doc(title, header, values);
    expect(out[1]).toBe('Carrier  Contact  [REMOVED]  [REMOVED]');
    expect(out[2]).toBe('ACME HAULING INC  [REMOVED]  [REMOVED]  [PHONE]');
  });

  it('the title row is not a header; the header row is', () => {
    const out = redactDocument([title, header, values]);
    expect(out.map((l) => l.header)).toEqual([false, true, false]);
    expect(out.map((l) => l.below)).toEqual([0, 0, 2]);
  });

  it('an ALL-CAPS cell with no company word under a person header is a name: masked', () => {
    expect(doc(header, row('ZORBLAT QUENBY'))[1]).toBe('[REMOVED]');
    expect(doc(header, row('ZORBLAT'))[1]).toBe('[REMOVED]');
    expect(doc(header, row('ZORBLAT Q. QUENBY JR'))[1]).toBe('[REMOVED]');
  });

  it('an ALL-CAPS cell with a company word stays, whatever else it holds', () => {
    for (const company of ['ACME HAULING INC', 'ZORBLAT QUENBY TRUCKING', 'QUENBY & SONS LLC', 'ACME DC', 'ACME EXPRESS']) {
      expect(doc(header, row(company))[1]).toBe(company);
    }
  });

  it('a company word does not keep a cell in mixed case: only an ALL-CAPS cell is a company', () => {
    expect(doc(header, row('Zorblat Trucking'))[1]).toBe('[REMOVED]');
  });

  it('the cells that stay stay: a digit, a comma, a state, a weekday run, a city line', () => {
    const out = doc(header, row('4001 Main St', 'ACME, INC', 'ND', 'MON-FRI', 'Fargo, ND 58102'));
    expect(out[1]).toBe('4001 Main St  ACME, INC  ND  MON-FRI  Fargo, ND 58102');
  });

  it('a label followed by cells the first pass already masked: it fires', () => {
    expect(doc(row('Contact', '[REMOVED]', '[REMOVED]'), row('Dana Example'))[1]).toBe('[REMOVED]');
  });

  it('a label followed only by placeholders in its own cell fires: "Contact 612-555-0147"', () => {
    expect(doc(row('Contact 612-555-0147'), row('Dana Example'))[1]).toBe('[REMOVED]');
    expect(doc(row('Contact: dana@example.com'), row('Dana Example'))[1]).toBe('[REMOVED]');
  });

  it('a label with placeholders after it, in the middle of the line, fires without the vocabulary', () => {
    expect(doc(row('Contact 612-555-0147', 'Office, Direct'), row('Dana Example'))[1]).toBe('[REMOVED]');
    expect(doc(row('Office, Direct', 'Dispatcher: dana@example.com', 'Mailbox Addr'), row('Dana Example'))[1]).toBe('[REMOVED]');
  });

  it('a person label inside a longer cell is no header, even with placeholders after it', () => {
    expect(doc(row('For questions please contact 612-555-0147'), row('Riley Quill'))[1]).toBe('Riley Quill');
  });

  it('only a whole company WORD keeps an ALL-CAPS cell: a name that merely contains one is a name', () => {
    for (const name of ['COLE QUENBY', 'INCA QUENBY', 'GROUPER ZORBLAT', 'DCARTER WEXCOMBE', 'ZORBLAT INC']) {
      expect(doc(header, row(name))[1], name).toBe(name === 'ZORBLAT INC' ? name : '[REMOVED]');
    }
  });

  it('a company word alone in an otherwise mixed-case cell keeps nothing: "Zorblat INC" is a name and a word', () => {
    expect(doc(header, row('Zorblat INC'))[1]).toBe('[REMOVED]');
  });

  it('the row after a blank line, as before', () => {
    expect(doc(header, row(), row('ZORBLAT QUENBY'))[2]).toBe('[REMOVED]');
    expect(doc(header, row('612-555-0147'), row('ZORBLAT QUENBY'))[2]).toBe('[REMOVED]');
  });

  it('rows under no person header are untouched, and so is a name with no header above it (the known limit)', () => {
    const rows = [row('Carrier', 'Office, Direct', 'Mailbox Addr'), row('ZORBLAT QUENBY', 'Fennimore Wexcombe')];
    expect(doc(...rows)).toEqual(rows.map((r) => redactLine(r).text));
    expect(doc(...rows)[1]).toBe('ZORBLAT QUENBY  Fennimore Wexcombe');
  });

  it('is idempotent', () => {
    const once = doc(title, header, values);
    expect(doc(...once.map((t) => row(t)))).toEqual(once);
  });
});

describe('B. what is sent', () => {
  const NAMES = /Zorblat|Quenby|Fennimore|Wexcombe|Quillfeather/;

  it('a name planted in the row below a person header never survives in the sent text', () => {
    const planted = [
      pdfLine(1, 'Fargo, ND 58102'),
      row('Carrier Contact', 'Phone'),
      row('Zorblat Quenby', '16125550147'),
      row('Driver Name', 'Driver Cell'),
      row('Fennimore', '(612) 555-0147'),
      row('Dispatcher:'),
      row(),
      row('Wexcombe Quillfeather'),
    ];
    const out = prepareForReading(planted);
    if (!out.ok) throw new Error(out.reason);
    expect(out.text).not.toMatch(NAMES);
    expect(out.text).not.toMatch(/\d{7}/);
    expect(out.masks.labelled).toBeGreaterThanOrEqual(3);
  });

  it('the review copy is the same lines, with the same counts', () => {
    const lines = [pdfLine(1, 'Fargo, ND 58102'), row('Contact', 'Phone'), row('Zorblat Quenby', '16125550147')];
    const sent = prepareForReading(lines);
    if (!sent.ok) throw new Error(sent.reason);
    const review = redactedForReview(lines);
    expect(review.lines.map(({ n, page, text }) => ({ n, page, text }))).toEqual(sent.lines);
    expect(review.masks).toEqual(sent.masks);
    expect(review.lines.map((l) => [l.bare, l.below])).toEqual([[0, 0], [0, 0], [1, 1]]);
  });

  it('a planted name that the rules do not recognise (no header above it) goes through: the known limit, pinned', () => {
    const out = prepareForReading([pdfLine(1, 'Fargo, ND 58102'), row('Zorblat Quenby')]);
    if (!out.ok) throw new Error(out.reason);
    expect(out.text).toContain('Zorblat Quenby');
  });
});

describe('the masks that were there are unchanged', () => {
  it('the invented document sends the same text, line for line, with the new rules on', () => {
    const out = prepareForReading(UNKNOWN_LAYOUT);
    if (!out.ok) throw new Error(out.reason);
    const byLine = redactedForReview(UNKNOWN_LAYOUT).lines;
    expect(byLine.every((l) => l.bare === 0 && l.below === 0)).toBe(true);
    expect(out.masks).toEqual({ email: 1, phone: 3, amount: 3, labelled: 2, id: 2, url: 1 });
    expect(out.text.split('\n')[2]).toBe(`L3 Booked by: [REMOVED]  Phone: [PHONE] ${S}`);
  });

  it('a lone label alone in its cell masks the next cell, as before', () => {
    expect(joined('Contact:', 'Jane Example')).toBe('Contact:  [REMOVED]');
  });
});

describe('identifierLabelBefore', () => {
  it.each(['Load #', 'load:', 'Order No.', 'PRO #:', 'BOL', 'Ref  ', 'x  Stop #', 'Pickup #:'])('%j ends in an identifier label', (t) => {
    expect(identifierLabelBefore(t)).toBe(true);
  });

  it.each(['', 'Dock', 'Origin', 'Load 4417', 'Unloader', 'Contact:', 'Load #  Origin'])('%j does not', (t) => {
    expect(identifierLabelBefore(t)).toBe(false);
  });
});
