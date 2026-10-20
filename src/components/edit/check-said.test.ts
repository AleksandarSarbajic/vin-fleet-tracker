import { describe, expect, it } from 'vitest';
import { checkSaid } from './check-said';
import { AI_APPOINTMENT_CHECK, SCAN_CHECK, ZIP_NOT_REAL } from './ratecon-fill';

/** §12.122. "Check: …" under a field, once (found in 3aj: a placeholder ZIP said it twice). */

describe('a check, said once', () => {
  it('a message without the word gets it', () => {
    expect(checkSaid('Not found in the PDF.')).toBe('Check: Not found in the PDF.');
    expect(checkSaid(SCAN_CHECK)).toBe(`Check: ${SCAN_CHECK}`);
  });

  it('a message that carries it already is said as it is', () => {
    expect(checkSaid(ZIP_NOT_REAL)).toBe("Check: the PDF's ZIP is not a real US ZIP. Enter it by hand.");
    expect(checkSaid(AI_APPOINTMENT_CHECK)).toBe(AI_APPOINTMENT_CHECK);
  });

  it('only the word itself counts, at the start', () => {
    expect(checkSaid('Checked by the broker: no.')).toBe('Check: Checked by the broker: no.');
    expect(checkSaid('Duluth — Check: later')).toBe('Check: Duluth — Check: later');
  });
});
