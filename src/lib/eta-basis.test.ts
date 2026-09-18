import { describe, expect, it } from 'vitest';
import { basisShort, etaCaution, etaDetails, type BasisFacts } from './eta-basis';
import type { DistanceBasis } from './routing';

/**
 * §12.33. The rule, not the wording.
 *
 * The strings will be reworded; what must not drift is that the tooltip stays
 * within two clauses for every combination the board can produce, and that
 * the one caveat which cannot be inferred from what is on screen — at-risk
 * suppression on a zip-precision stop — is never the thing demoted.
 */

const PRECISIONS = ['street', 'block', 'zip', null] as const;
const BASES: DistanceBasis[] = ['routed', 'lane-estimate', 'straight-line'];

function facts(over: Partial<BasisFacts> = {}): BasisFacts {
  return {
    etaPrecision: 'street',
    etaAccuracyMiles: null,
    distanceBasis: 'routed',
    laneRatio: 1.32,
    snapMeters: 4,
    routeMeasuredAtUtc: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    ...over,
  };
}

/** Sentences, counted the way a reader counts them. */
const sentences = (text: string) => text.split(/(?<=\.)\s+/).filter(Boolean);

describe('the caution is at most two clauses, whatever the board produces', () => {
  for (const etaPrecision of PRECISIONS) {
    for (const distanceBasis of BASES) {
      for (const accuracy of [null, 4.6]) {
        it(`${etaPrecision ?? 'no precision'} · ${distanceBasis} · ${
          accuracy === null ? 'no ±' : '±4.6'
        }`, () => {
          const text = etaCaution(
            facts({ etaPrecision, distanceBasis, etaAccuracyMiles: accuracy }),
          );
          expect(sentences(text).length).toBeLessThanOrEqual(2);
          // The second clause is the constant one, and it is always last.
          expect(text.endsWith('Arrival time counts driving only — no rest breaks.')).toBe(true);
        });
      }
    }
  }
});

describe('what the caution must never demote', () => {
  it('says at-risk is suppressed on a zip stop, routed or not', () => {
    for (const distanceBasis of BASES) {
      const text = etaCaution(facts({ etaPrecision: 'zip', distanceBasis, etaAccuracyMiles: 4.6 }));
      // Inference from absence: a row with no at-risk chip otherwise reads as
      // fine. This is the one clause carrying the whole meaning.
      expect(text).toMatch(/at-risk warning will fire|no at-risk warning/);
      expect(text).toContain('±4.6 mi');
    }
  });

  it('does not mention at-risk on a block or street stop, which do warn', () => {
    for (const etaPrecision of ['street', 'block'] as const) {
      expect(etaCaution(facts({ etaPrecision }))).not.toContain('at-risk');
    }
  });
});

describe('what moved out of the caution', () => {
  const zipRow = facts({
    etaPrecision: 'zip',
    etaAccuracyMiles: 4.6,
    snapMeters: 379,
    laneRatio: 1.218,
  });

  it('keeps the car-profile caveat out of the tooltip and in the details', () => {
    expect(etaCaution(zipRow)).not.toMatch(/car|rate confirmation/);
    expect(etaDetails(zipRow).map((d) => d.value).join(' ')).toMatch(/rate confirmation/);
  });

  it('keeps the snap distance out of the tooltip and in the details', () => {
    expect(etaCaution(zipRow)).not.toContain('379');
    expect(etaDetails(zipRow).map((d) => d.value).join(' ')).toContain('379 m');
  });

  it('says nothing about the snap when it is smaller than a car park', () => {
    const labels = etaDetails(facts({ snapMeters: 4 })).map((d) => d.label);
    expect(labels).not.toContain('Route');
  });

  it('reports how old the route is, so a stale lane is visible', () => {
    const measured = etaDetails(zipRow).find((d) => d.label === 'Measured');
    expect(measured?.value).toBe('2h ago');
  });

  it('has no Measured line for a lane that was never routed', () => {
    const labels = etaDetails(facts({ routeMeasuredAtUtc: null })).map((d) => d.label);
    expect(labels).not.toContain('Measured');
  });
});

describe('a street stop on a routed lane says the minimum', () => {
  it('carries only the rest-break clause', () => {
    expect(etaCaution(facts({ etaPrecision: 'street' }))).toBe(
      'Arrival time counts driving only — no rest breaks.',
    );
  });

  it('still calls the distance routed in the short form', () => {
    expect(basisShort(facts())).toBe('routed road miles');
  });
});
