import { describe, expect, it } from 'vitest';
import { sleepLine, sleptMs } from '../../e2e/run-clock';

/** The end-of-run sleep check's arithmetic, with invented readings. */

const at = (wallMs: number, awakeMs: number) => ({ wallMs, awakeMs });
const MIN = 60_000;

describe('time asleep during a run', () => {
  it('is the wall time the awake clock did not see', () => {
    // 40 minutes passed on the wall; the awake clock moved 12.
    expect(sleptMs(at(1_000_000, 500_000), at(1_000_000 + 40 * MIN, 500_000 + 12 * MIN))).toBe(28 * MIN);
  });

  it('is zero when both clocks agree', () => {
    expect(sleptMs(at(0, 0), at(18 * MIN, 18 * MIN))).toBe(0);
  });

  it('is never negative, whatever the clocks drift by', () => {
    expect(sleptMs(at(0, 0), at(10 * MIN, 10 * MIN + 250))).toBe(0);
  });
});

describe('the line at the end of a run', () => {
  it('names the minutes asleep, and that failures may come from it', () => {
    expect(sleepLine(at(0, 0), at(37 * MIN, 9 * MIN))).toBe(
      'e2e: the Mac slept 28 minutes during this run; failures may be from that.',
    );
    expect(sleepLine(at(0, 0), at(5 * MIN, 4 * MIN))).toBe(
      'e2e: the Mac slept 1 minute during this run; failures may be from that.',
    );
  });

  it('treats under a minute as awake: a clock read is not sleep', () => {
    expect(sleepLine(at(0, 0), at(18 * MIN, 18 * MIN - 25_000))).toBe('e2e: the machine stayed awake for the whole run.');
  });
});
