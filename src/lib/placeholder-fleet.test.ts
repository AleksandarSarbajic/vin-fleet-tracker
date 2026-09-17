import { describe, expect, it } from 'vitest';
import { STATUSES, isProblem, urgencyRank, type Status } from '@/lib/status';
import { compareFleet } from '@/lib/fleet-order';
import { applyPlaceholders, type Placeholdable } from './placeholder-fleet';

const fleet = (n: number): Placeholdable[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `id-${i}`,
    truckNumber: 1100 + i,
    status: 'ON_TIME' as Status,
  }));

/** The real active roster, so these assertions describe what is on screen. */
const ROSTER = [
  113, 116, 122, 124, 126, 128, 130, 132, 133, 135, 136, 137, 138, 139, 140,
  141, 142, 143, 144, 145, 146, 147, 246,
];

const realFleet = (): Placeholdable[] =>
  ROSTER.map((truckNumber, i) => ({
    id: `id-${i}`,
    truckNumber,
    status: 'ON_TIME' as Status,
  }));

describe('applyPlaceholders', () => {
  it('shows every status at least once on a 23-truck fleet', () => {
    // The whole point: see the full palette on real tiles before phase 5.
    const seen = new Set(applyPlaceholders(fleet(23)).map((r) => r.status));
    for (const s of STATUSES) expect(seen).toContain(s);
  });

  it('includes STALE_GPS so the hatched marker is visible', () => {
    // The hatch is the marker most likely to read badly at small sizes.
    const out = applyPlaceholders(fleet(23));
    expect(out.filter((r) => r.status === 'STALE_GPS').length).toBeGreaterThan(0);
  });

  it('is deterministic — a reload does not reshuffle the colours', () => {
    const a = applyPlaceholders(fleet(23)).map((r) => r.status);
    const b = applyPlaceholders(fleet(23)).map((r) => r.status);
    expect(a).toEqual(b);
  });

  it('assigns by truck number, so database order does not change the result', () => {
    const forward = applyPlaceholders(fleet(23));
    const reversed = applyPlaceholders([...fleet(23)].reverse());
    const byId = new Map(reversed.map((r) => [r.id, r.status]));
    for (const row of forward) expect(byId.get(row.id)).toBe(row.status);
  });

  /**
   * The placeholder used to list the statuses in urgency order, which made
   * status a monotonic function of truck number. Urgency order and
   * truck-number order came out identical, so the rendered list looked
   * correct even if the sort did nothing at all. These three hold the
   * scatter in place for as long as the placeholder exists.
   */
  describe('status does not correlate with truck number', () => {
    it('urgency order is not truck-number order', () => {
      const rows = applyPlaceholders(realFleet());
      const urgency = [...rows]
        .sort(compareFleet('urgency'))
        .map((r) => r.truckNumber);

      expect(urgency).not.toEqual([...ROSTER]);
      // Not merely different somewhere down the list: the very first row a
      // dispatcher sees is not the lowest-numbered truck.
      expect(urgency[0]).not.toBe(ROSTER[0]);
    });

    it('urgency rank rises and falls as truck number rises', () => {
      // The failed state is a rank sequence that only ever goes up.
      const ranks = applyPlaceholders(realFleet())
        .sort((a, b) => a.truckNumber! - b.truckNumber!)
        .map((r) => urgencyRank(r.status));

      const rises = ranks.filter((r, i) => i > 0 && r > ranks[i - 1]!).length;
      const falls = ranks.filter((r, i) => i > 0 && r < ranks[i - 1]!).length;
      expect(rises).toBeGreaterThan(3);
      expect(falls).toBeGreaterThan(3);
    });

    it('scatters problem trucks across the whole number range', () => {
      const rows = applyPlaceholders(realFleet()).sort(
        (a, b) => a.truckNumber! - b.truckNumber!,
      );
      const third = Math.ceil(rows.length / 3);
      const problems = (slice: typeof rows) => slice.filter((r) => isProblem(r.status));

      expect(problems(rows.slice(0, third)).length).toBeGreaterThan(0);
      expect(problems(rows.slice(third, third * 2)).length).toBeGreaterThan(0);
      expect(problems(rows.slice(third * 2)).length).toBeGreaterThan(0);

      // The two the ruling named explicitly.
      const status = new Map(rows.map((r) => [r.truckNumber, r.status]));
      expect(status.get(140)).toBe('LATE');
      expect(status.get(113)).toBe('ON_TIME');
    });
  });
});