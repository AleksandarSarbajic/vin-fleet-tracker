import { describe, expect, it } from 'vitest';
import { AREA_CODES, isAssignedAreaCode } from './nanp-area-codes';

/** The static set of assigned North American area codes the bare-phone rule reads (redact.ts, rule A). */

describe('the assigned area codes', () => {
  it.each(['201', '212', '218', '312', '404', '612', '701', '701', '832', '907', '204', '416', '868'])('%s is assigned', (code) => {
    expect(isAssignedAreaCode(code)).toBe(true);
  });

  it.each(['800', '833', '844', '855', '866', '877', '888'])('toll-free %s is a phone too', (code) => {
    expect(isAssignedAreaCode(code)).toBe(true);
  });

  it.each(['200', '111', '000', '555', '911', '211', '122', '999', '61', '6120', '6l2', ''])('%j is not', (code) => {
    expect(isAssignedAreaCode(code)).toBe(false);
  });

  it('is only well-formed codes: three digits, the first 2-9, the second and third not both 1', () => {
    expect(AREA_CODES.size).toBeGreaterThan(350);
    for (const code of AREA_CODES) {
      expect(code).toMatch(/^[2-9]\d\d$/);
      expect(code.slice(1)).not.toBe('11');
    }
  });
});
