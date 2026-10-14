import { describe, expect, it } from 'vitest';
import { normalCase } from './normal-case';

/**
 * Street and city in normal capitalization when a rate confirmation is
 * filled. Invented addresses only.
 */

const table = (rows: [string, string][]) => rows.forEach(([input, want]) => expect(normalCase(input), input).toBe(want));

describe('normalCase: an all-caps word becomes Title case', () => {
  it('plain words', () => {
    table([
      ['DALLAS', 'Dallas'],
      ['FORT WORTH', 'Fort Worth'],
      ['4001 MAIN STREET', '4001 Main Street'],
      ['WEST FARGO', 'West Fargo'],
    ]);
  });

  it('accented letters', () => {
    table([['SAN JOSÉ', 'San José']]);
  });
});

describe('normalCase: a word with any lowercase letter is left exactly as is', () => {
  it('mixed-case words stand, even beside all-caps ones', () => {
    table([
      ['McAllen', 'McAllen'],
      ['DeKalb', 'DeKalb'],
      ['4001 Main St', '4001 Main St'],
      ['123 main ST', '123 main St'],
      ['Winston-SALEM', 'Winston-SALEM'],
      ['stOP', 'stOP'],
    ]);
  });

  it('already mixed case: a no-op', () => {
    table([
      ['4001 Main St', '4001 Main St'],
      ['St. Louis', 'St. Louis'],
      ['220 Harbor Rd NE', '220 Harbor Rd NE'],
      ["O'Fallon", "O'Fallon"],
      ['21st St', '21st St'],
    ]);
  });
});

describe('normalCase: hyphens and apostrophes split a word, each part cased', () => {
  it('hyphen', () => {
    table([
      ['WINSTON-SALEM', 'Winston-Salem'],
      ['WILKES-BARRE', 'Wilkes-Barre'],
    ]);
  });

  it('apostrophe, straight or curly', () => {
    table([
      ["O'FALLON", "O'Fallon"],
      ['O’FALLON', 'O’Fallon'],
      ["D'IBERVILLE", "D'Iberville"],
    ]);
  });

  it('a possessive or contraction ending is not a new word', () => {
    table([
      ["JOHN'S CREEK", "John's Creek"],
      ["DON'T", "Don't"],
    ]);
  });
});

describe('normalCase: Mc followed by a letter', () => {
  it('capitalizes the letter after Mc', () => {
    table([
      ['MCALLEN', 'McAllen'],
      ['100 MCDONALD DR', '100 McDonald Dr'],
      ['MCKINNEY', 'McKinney'],
    ]);
  });
});

describe('normalCase: what stays upper-case', () => {
  it('directionals', () => {
    table([
      ['120 N MAIN ST', '120 N Main St'],
      ['120 S MAIN ST', '120 S Main St'],
      ['120 E MAIN ST', '120 E Main St'],
      ['120 W MAIN ST', '120 W Main St'],
      ['55 NE HARBOR AVE', '55 NE Harbor Ave'],
      ['55 NW HARBOR AVE', '55 NW Harbor Ave'],
      ['55 SE HARBOR AVE', '55 SE Harbor Ave'],
      ['55 SW HARBOR AVE', '55 SW Harbor Ave'],
      ['900 HARBOR RD NE', '900 Harbor Rd NE'],
      ['W. MAIN ST', 'W. Main St'],
    ]);
  });

  it('PO', () => {
    table([
      ['PO BOX 12', 'PO Box 12'],
      ['P.O. BOX 12', 'P.O. Box 12'],
    ]);
  });

  it('highway prefixes and numbers', () => {
    table([
      ['2200 I-35 SERVICE RD', '2200 I-35 Service Rd'],
      ['1400 I-35E', '1400 I-35E'],
      ['US-90 FRONTAGE RD', 'US-90 Frontage Rd'],
      ['900 FM 1960 W', '900 FM 1960 W'],
      ['SH 121', 'SH 121'],
      ['CR 12', 'CR 12'],
      ['RR 3', 'RR 3'],
      ['US 90', 'US 90'],
      ['I 35 NORTH', 'I 35 North'],
    ]);
  });
});

describe('normalCase: ordinals, digits and #', () => {
  it('the ordinal suffix goes lower case', () => {
    table([
      ['1ST', '1st'],
      ['2ND', '2nd'],
      ['3RD', '3rd'],
      ['4TH', '4th'],
      ['21ST ST', '21st St'],
      ['E 5TH AVE', 'E 5th Ave'],
    ]);
  });

  it('digits and # are untouched', () => {
    table([
      ['1200 OAK BLVD STE #4B', '1200 Oak Blvd Ste #4B'],
      ['UNIT 2A', 'Unit 2A'],
      ['#12', '#12'],
    ]);
  });
});

describe('normalCase: St. and the street suffixes', () => {
  it('ST. in a city', () => {
    table([
      ['ST. LOUIS', 'St. Louis'],
      ['ST. PAUL', 'St. Paul'],
    ]);
  });

  it('street suffixes', () => {
    table([
      ['1 MAIN ST', '1 Main St'],
      ['1 MAIN AVE', '1 Main Ave'],
      ['1 MAIN BLVD', '1 Main Blvd'],
      ['1 STATE HWY', '1 State Hwy'],
      ['1 MAIN RD', '1 Main Rd'],
      ['1 MAIN DR', '1 Main Dr'],
      ['1 MAIN LN', '1 Main Ln'],
      ['1 MAIN PKWY', '1 Main Pkwy'],
      ['1 MAIN STE 5', '1 Main Ste 5'],
    ]);
  });
});

describe('normalCase: only the case changes', () => {
  it('whitespace, punctuation and digits are kept as they are', () => {
    table([
      ['  DALLAS  ', '  Dallas  '],
      ['FORT  WORTH', 'Fort  Worth'],
      ['(DALLAS)', '(Dallas)'],
      ['MAIN ST, STE 5', 'Main St, Ste 5'],
      ['', ''],
    ]);
  });

  it('never changes the characters, only their case', () => {
    const input = "4001 MAIN ST. N.E. #4B O'FALLON-MCALLEN 21ST";
    expect(normalCase(input).toLowerCase()).toBe(input.toLowerCase());
  });
});

describe('normalCase: idempotent', () => {
  it('a second pass changes nothing', () => {
    const inputs = [
      'DALLAS', 'WINSTON-SALEM', "O'FALLON", "JOHN'S CREEK", 'MCALLEN', 'ST. LOUIS', '120 N MAIN ST',
      '55 NE HARBOR AVE', 'PO BOX 12', 'P.O. BOX 12', '2200 I-35 SERVICE RD', '900 FM 1960 W', 'SH 121',
      'US-90 FRONTAGE RD', '21ST ST', '1200 OAK BLVD STE #4B', 'SAN JOSÉ', '123 main ST', '  FORT  WORTH ',
    ];
    for (const input of inputs) {
      const once = normalCase(input);
      expect(normalCase(once), input).toBe(once);
    }
  });
});
