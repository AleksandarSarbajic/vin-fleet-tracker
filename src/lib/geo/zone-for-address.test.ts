import { describe, expect, it } from 'vitest';
import { ZONE_BY_STATE, ZONES } from './zone-by-state';
import { isSplitState, tableZones, zoneForAddress } from './zone-for-address';

/**
 * §12.120. The ZIP table and the resolver. The places are public geography,
 * each on the side 49 CFR Part 71 puts its county.
 */

describe('a state with one zone', () => {
  it('answers from the state, ZIP or none', () => {
    expect(zoneForAddress('IL', '')).toEqual({ kind: 'state', zone: 'America/Chicago' });
    expect(zoneForAddress('mn', '56560')).toEqual({ kind: 'state', zone: 'America/Chicago' });
    expect(zoneForAddress('CO', '80216')).toEqual({ kind: 'state', zone: 'America/Denver' });
  });
});

describe('a state with two zones, settled by the ZIP', () => {
  it.each([
    ['ND', '58102', 'America/Chicago'], // Fargo, Cass
    ['ND', '58601', 'America/Denver'], // Dickinson, Stark — §71.7(a)
    ['ND', '58554', 'America/Chicago'], // Mandan, Morton
    ['SD', '57701', 'America/Denver'], // Rapid City, Pennington — §71.7(b)
    ['SD', '57501', 'America/Chicago'], // Pierre, Hughes
    ['NE', '69361', 'America/Denver'], // Scottsbluff — §71.7(c)
    ['NE', '69101', 'America/Chicago'], // North Platte, Lincoln
    ['TX', '79901', 'America/Denver'], // El Paso — §71.7(e)
    ['TX', '75201', 'America/Chicago'], // Dallas
    ['IN', '46320', 'America/Chicago'], // Hammond, Lake — §71.5(b)
    ['IN', '46204', 'America/Indiana/Indianapolis'],
    ['MI', '49801', 'America/Chicago'], // Iron Mountain, Dickinson — §71.5(a)
    ['MI', '48201', 'America/Detroit'],
    ['KY', '42101', 'America/Chicago'], // Bowling Green, Warren — §71.5(c)
    ['KY', '40202', 'America/New_York'], // Louisville
    ['TN', '37203', 'America/Chicago'], // Nashville — §71.5(d)
    ['TN', '37902', 'America/New_York'], // Knoxville
    ['FL', '32401', 'America/Chicago'], // Panama City, Bay — §71.5(f)
    ['FL', '33101', 'America/New_York'], // Miami
    ['ID', '83814', 'America/Los_Angeles'], // Coeur d'Alene, Kootenai — §71.9(a)
    ['ID', '83702', 'America/Boise'],
    ['AZ', '85004', 'America/Phoenix'],
  ])('%s %s → %s', (state, zip, zone) => {
    expect(zoneForAddress(state, zip)).toEqual({ kind: 'zip', zone });
  });

  it('reads the first five digits of a ZIP+4', () => {
    expect(zoneForAddress('ND', '58601-1234')).toEqual({ kind: 'zip', zone: 'America/Denver' });
  });
});

describe('uncertain, never guessed', () => {
  it.each([
    ['ND', '58854'], // Watford City, McKenzie: township lines cross the county
    ['FL', '32456'], // Port St. Joe, Gulf: the Intracoastal Waterway
    ['SD', '57532'], // Fort Pierre, Stanley
    ['OR', '97914'], // Ontario, Malheur
    ['AZ', '86001'], // Flagstaff, Coconino: Navajo Nation daylight time
  ])('a ZIP that touches a county a line cuts: %s %s', (state, zip) => {
    expect(zoneForAddress(state, zip)).toMatchObject({ kind: 'uncertain', reason: 'zip-crosses' });
  });

  it('offers the state’s usual zone while it asks', () => {
    expect(zoneForAddress('ND', '58854')).toEqual({
      kind: 'uncertain',
      zone: 'America/Chicago',
      reason: 'zip-crosses',
    });
  });

  it('a two-zone state with no ZIP', () => {
    expect(zoneForAddress('ND', '')).toMatchObject({ kind: 'uncertain', reason: 'no-zip' });
    expect(zoneForAddress('ND', '  ')).toMatchObject({ kind: 'uncertain', reason: 'no-zip' });
  });

  it('a ZIP the table does not carry for that state: a typo, a part, another state’s', () => {
    expect(zoneForAddress('ND', '99999')).toMatchObject({ reason: 'zip-unknown' });
    expect(zoneForAddress('ND', '581')).toMatchObject({ reason: 'zip-unknown' });
    expect(zoneForAddress('ND', '60018')).toMatchObject({ reason: 'zip-unknown' });
  });

  it('two letters that are not a US state', () => {
    expect(zoneForAddress('ON', '')).toMatchObject({ kind: 'uncertain', reason: 'not-a-state' });
  });
});

describe('nothing to go on', () => {
  it('is null for a blank state, or anything but two letters', () => {
    expect(zoneForAddress('', '58102')).toBeNull();
    expect(zoneForAddress('N', '')).toBeNull();
    expect(zoneForAddress('Illinois', '')).toBeNull();
  });
});

describe('the table', () => {
  it('answers only with zones the modal offers', () => {
    for (const zone of tableZones()) expect(ZONES).toContain(zone);
  });

  it('carries the fifteen states with more than one zone, and no other', () => {
    const split = Object.keys(ZONE_BY_STATE).filter(isSplitState).sort();
    expect(split).toEqual(
      ['AK', 'AZ', 'FL', 'ID', 'IN', 'KS', 'KY', 'MI', 'ND', 'NE', 'NV', 'OR', 'SD', 'TN', 'TX'],
    );
  });

  it('ignores a digitising sliver, and only that (0.2% and 0.3% of the ZIP’s land)', () => {
    expect(zoneForAddress('IN', '46996')).toEqual({ kind: 'zip', zone: 'America/Indiana/Indianapolis' });
    expect(zoneForAddress('KS', '67861')).toEqual({ kind: 'zip', zone: 'America/Chicago' });
  });
});
