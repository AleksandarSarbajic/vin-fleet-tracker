import { describe, expect, it } from 'vitest';
import {
  basisShort,
  etaCaution,
  etaDetails,
  etaMilesLine,
  type BasisFacts,
  type MilesFacts,
} from './eta-basis';
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

/* -------------------------------------------------------------------------
 * §12.47 — the miles line under the ETA
 * ---------------------------------------------------------------------- */

/** The real one from TruckRow: `arriving` under ten, whole miles above. */
const miles = (m: number | null): string | null =>
  m === null ? null : m < 10 ? 'arriving' : `${Math.round(m)} mi`;

function milesFacts(over: Partial<MilesFacts> = {}): MilesFacts {
  return { ...facts(), milesRemaining: 412, etaAbsence: 'has-eta', ...over };
}

describe('the miles line under the ETA (§12.47)', () => {
  /**
   * CONTRACT CHANGE. This asserted three distinct renderings, splitting
   * `lane-estimate` from `straight-line` by colour.
   *
   * That split did not survive the weight this line has to sit at. The miles
   * must be quieter than the time, which puts them at `text-text-muted` —
   * and there is nothing below muted. A fourth level was measured in
   * Chromium: #6f777e is indistinguishable from muted at 10.5px, and #656d74
   * is distinguishable only by being hard to read.
   *
   * The split is now where it changes a decision (§12.33): routed, or not.
   * `basisShort` keeps all three apart in the popup, where words fit.
   */
  it('marks whether the distance was measured for THIS position', () => {
    const routed = etaMilesLine(milesFacts({ distanceBasis: 'routed' }), false, miles);
    const lane = etaMilesLine(milesFacts({ distanceBasis: 'lane-estimate' }), false, miles);
    const straight = etaMilesLine(milesFacts({ distanceBasis: 'straight-line' }), false, miles);

    expect(routed).toBe('412 mi');
    expect(lane).toBe('~412 mi');
    expect(straight).toBe('~412 mi');

    // The distinction that survives, and the one that does not.
    expect(routed).not.toBe(lane);
    expect(lane).toBe(straight);
  });

  /** The popup still tells all three apart, which is where the loss lands. */
  it('leaves basisShort carrying the full three-way distinction', () => {
    const words = (['routed', 'lane-estimate', 'straight-line'] as const).map((b) =>
      basisShort(facts({ distanceBasis: b })),
    );
    expect(new Set(words).size).toBe(3);
  });

  it('shows no miles while the feed is stale', () => {
    // The time already reads `stale`; a precise mileage under it would undo
    // that in the same glance (§5.9).
    expect(etaMilesLine(milesFacts(), true, miles)).toBeNull();
  });

  it('shows no miles for a truck that has arrived', () => {
    expect(etaMilesLine(milesFacts({ etaAbsence: 'arrived' }), false, miles)).toBeNull();
  });

  it('shows no miles under a struck-through ETA', () => {
    // The strike says "this number is not being maintained". Live miles under
    // it would contradict it.
    const suppressed = milesFacts({ etaAbsence: 'suppressed-unassigned' });
    expect(etaMilesLine(suppressed, false, miles)).toBeNull();
  });

  it('shows no miles when there is no distance at all', () => {
    for (const absence of ['address-not-located', 'no-address'] as const) {
      const none = milesFacts({ milesRemaining: null, etaAbsence: absence });
      expect(etaMilesLine(none, false, miles)).toBeNull();
    }
  });

  /**
   * `arriving` is a word, and the second line exists to carry a number. It is
   * also the only string here with a descender, which is what would have
   * touched the row's bottom border at 42.6px of a 44px row.
   */
  it('shows no miles when milesText has no number to give', () => {
    expect(etaMilesLine(milesFacts({ milesRemaining: 4 }), false, miles)).toBeNull();
    expect(etaMilesLine(milesFacts({ milesRemaining: 9.9 }), false, miles)).toBeNull();
    expect(etaMilesLine(milesFacts({ milesRemaining: 10 }), false, miles)).toBe('10 mi');
  });

  it('carries a four-figure distance, which our own lanes reach', () => {
    // route_samples holds a real 2207-mile measurement.
    expect(etaMilesLine(milesFacts({ milesRemaining: 2207 }), false, miles)).toBe('2207 mi');
  });

  it('keeps the miles even with no appointment, because distance is not a deadline', () => {
    const noAppt = milesFacts({ etaAbsence: 'no-appointment' });
    expect(etaMilesLine(noAppt, false, miles)).toBe('412 mi');
  });
});
