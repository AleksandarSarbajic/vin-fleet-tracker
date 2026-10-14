import { describe, expect, it } from 'vitest';
import { isRealUsZip } from './us-zip';

/** A placeholder ZIP is not a ZIP. Invented values only. */

describe('isRealUsZip', () => {
  it('rejects every ZIP below 00501, the lowest assigned', () => {
    for (const zip of ['00000', '00001', '00099', '00500']) expect(isRealUsZip(zip), zip).toBe(false);
  });

  it('accepts 00501 and up', () => {
    for (const zip of ['00501', '00601', '10001', '58102', '60450', '99950']) expect(isRealUsZip(zip), zip).toBe(true);
  });

  it('a ZIP+4 follows its first five digits', () => {
    expect(isRealUsZip('00001-1234')).toBe(false);
    expect(isRealUsZip('000011234')).toBe(false);
    expect(isRealUsZip('00500-0001')).toBe(false);
    expect(isRealUsZip('00501-0001')).toBe(true);
    expect(isRealUsZip('60450-1234')).toBe(true);
    expect(isRealUsZip('604501234')).toBe(true);
  });

  it('the cut is numeric, on the first five digits only', () => {
    expect(isRealUsZip('00500')).toBe(false);
    expect(isRealUsZip('00501')).toBe(true);
    // The +4 never lifts a placeholder over the line.
    expect(isRealUsZip('00001-9999')).toBe(false);
  });

  it('an empty string is not a ZIP', () => {
    expect(isRealUsZip('')).toBe(false);
    expect(isRealUsZip('   ')).toBe(false);
  });

  it('what is not five digits (or ZIP+4) is not a ZIP either', () => {
    for (const zip of ['1234', '123456', 'ABCDE', '58 102', '5810A']) expect(isRealUsZip(zip), zip).toBe(false);
  });
});
