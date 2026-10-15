import { describe, expect, it } from 'vitest';
import { STREET_TYPE, splitStreetCity } from './street-split';

/** Phase 3ac. A run-together street and city, divided only when exactly one division fits. Invented addresses. */

describe('a street and city that divide one way only', () => {
  it.each([
    ['4001 Main St Fargo', '4001 Main St', 'Fargo'],
    ['77 Depot Ave Bismarck', '77 Depot Ave', 'Bismarck'],
    ['4001 MAIN ST FARGO', '4001 MAIN ST', 'FARGO'],
    ['4001 Main St. Fargo', '4001 Main St.', 'Fargo'],
    ['12B Elm St Fargo', '12B Elm St', 'Fargo'],
    ['10-20 Elm St Fargo', '10-20 Elm St', 'Fargo'],
  ])('%s', (text, street, city) => {
    expect(splitStreetCity(text)).toEqual({ street, city });
  });

  it('takes one unit phrase into the street: a unit word and a token, or "#"', () => {
    expect(splitStreetCity('77 Depot Ave Ste 4 Bismarck')).toEqual({ street: '77 Depot Ave Ste 4', city: 'Bismarck' });
    expect(splitStreetCity('77 Depot Ave Unit 12B Bismarck')).toEqual({ street: '77 Depot Ave Unit 12B', city: 'Bismarck' });
    expect(splitStreetCity('77 Depot Ave #4 Bismarck')).toEqual({ street: '77 Depot Ave #4', city: 'Bismarck' });
    expect(splitStreetCity('77 Depot Ave # 4 Bismarck')).toEqual({ street: '77 Depot Ave # 4', city: 'Bismarck' });
  });

  it('takes a directional after the street type, then a unit phrase', () => {
    expect(splitStreetCity('1907 4th Ave NW Unit 200 West Fargo')).toEqual({ street: '1907 4th Ave NW Unit 200', city: 'West Fargo' });
    expect(splitStreetCity('123 Main St N Fargo')).toEqual({ street: '123 Main St N', city: 'Fargo' });
  });

  it('a city of up to three words, which may begin WEST, EAST, NORTH, SOUTH, NEW, FORT or MOUNT', () => {
    expect(splitStreetCity('9 Mill Rd West Fargo')).toEqual({ street: '9 Mill Rd', city: 'West Fargo' });
    expect(splitStreetCity('9 Mill Rd New Rockford')).toEqual({ street: '9 Mill Rd', city: 'New Rockford' });
    expect(splitStreetCity('9 Elm Dr Fort Worth')).toEqual({ street: '9 Elm Dr', city: 'Fort Worth' });
    expect(splitStreetCity('9 Elm Dr Mount Vernon')).toEqual({ street: '9 Elm Dr', city: 'Mount Vernon' });
    expect(splitStreetCity('9 Elm Dr North Sioux City')).toEqual({ street: '9 Elm Dr', city: 'North Sioux City' });
  });

  it('a street-type word after only a directional is not a street of its own', () => {
    expect(splitStreetCity('123 W Park Ave Fargo')).toEqual({ street: '123 W Park Ave', city: 'Fargo' });
  });
});

describe('nothing is split when no division fits, or more than one does', () => {
  it.each([
    ['a city that begins with a street-type word', '123 Main St St Louis'],
    ['"Park Ridge"-shaped', '123 Main St Park Ridge'],
    ['a one-word city that is a street-type word', '123 Main St Park'],
    ['a street with no street-type word', '123 Broadway Fargo'],
    ['a second unit phrase', '123 Main St Ste 4 Unit 5 Fargo'],
    ['more than three city words', '123 Main St Big Stone Gap City'],
    ['a street-type word inside the name', '9 Lake Park Ave Fargo'],
    ['a street-type word inside the name, again', '123 Grand Forks Hwy Mayville'],
    ['a city with a street-type word before its last word ("Palm Beach Gardens"-shaped)', '1 Ocean Blvd Palm Beach Gardens'],
    ['no house number', 'Main St Fargo'],
    ['no city', '123 Main St'],
    ['a city that begins with a number', '123 Main St 4 Fargo'],
    ['a city that begins with an abbreviated directional and nothing else', '123 Main St Ne'],
    ['a unit word with no token', '123 Main St Unit'],
    ['a name of directionals only', '123 N Ave Fargo'],
  ])('%s', (_why, text) => {
    expect(splitStreetCity(text)).toBeNull();
  });
});

describe('the street types', () => {
  it('are USPS Publication 28 suffixes and their standard abbreviations, without FORT and MOUNT', () => {
    for (const word of ['STREET', 'ST', 'AVENUE', 'AVE', 'PARK', 'RIDGE', 'RDG', 'LAKE', 'LK', 'FT', 'MT']) expect(STREET_TYPE.has(word), word).toBe(true);
    for (const word of ['FORT', 'MOUNT', 'WEST', 'NEW', 'NORTH', 'CITY']) expect(STREET_TYPE.has(word), word).toBe(false);
  });
});
