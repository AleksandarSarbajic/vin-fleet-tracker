/**
 * Phase 3bh (§12.150): the two candidate driving ETAs, the rule that chooses
 * between them, and the LATE replay. Pure: rows in, numbers out, so the rule
 * can be tested on invented rows and `eta:score` only prints.
 *
 *   A  the route's own speed (routed miles ÷ HERE's duration) under the sanity
 *      ceiling, nothing added. The scorer's `route-speed` row.
 *   B  A plus ONE fixed number of minutes on every routed or lane-estimate
 *      ETA. Fitted leave-one-truck-out, as 3au fitted its allowance: a row is
 *      never scored with a constant its own truck helped to fit.
 *
 * THE RULE WAS SET BEFORE THE NUMBERS WERE SEEN (the 3bh brief, 2026-11-10):
 * B ships only if, on driving-only rows, it beats A on med|e| by
 * `MIN_GAIN_MINUTES` or more at EVERY distance and raises worst10% at none.
 * Otherwise A. Do not tune it to a result.
 *
 * Nothing here models a stop, a rest or hours driven. The constant is one
 * number for every trip, whatever came before it.
 */
import { median, summarise, type ErrorSummary } from '../src/lib/eta-marks';
import { errorOf, type Scored } from './eta-trips.mjs';

export const MIN_GAIN_MINUTES = 3;

type Truck = number | null;

/** B changes a row only where the ETA came from a route. */
const fromRoute = (s: Scored) => s.basisShown !== 'straight-line';

export interface ConstantFit {
  /** Every truck's rows. For reading, and the value B would ship with. */
  all: number | null;
  /** By truck: the constant fitted WITHOUT that truck. Null when no other truck has a row. */
  without: Map<Truck, number | null>;
  /** Rows the fit is made of: from a route, with driving-only known. */
  rows: number;
}

/**
 * The constant is the median driving-only error of A, in whole minutes: the
 * number that, added to A, puts half the trips each side of the ETA.
 */
export function fitConstant(scored: readonly Scored[]): ConstantFit {
  const usable = scored
    .filter(fromRoute)
    .map((s) => ({ truck: s.stop.truck_number, e: errorOf(s, 'route-speed', true) }))
    .filter((r): r is { truck: Truck; e: number } => r.e !== null);
  const fit = (rows: readonly { e: number }[]) =>
    rows.length === 0 ? null : Math.round(median(rows.map((r) => r.e)));
  const without = new Map<Truck, number | null>();
  for (const truck of new Set(scored.map((s) => s.stop.truck_number))) {
    without.set(truck, fit(usable.filter((r) => r.truck !== truck)));
  }
  return { all: fit(usable), without, rows: usable.length };
}

export interface CandidateErrors {
  a: number[];
  b: number[];
  /** Rows left out of BOTH: no other truck to fit a constant from. */
  noFit: number;
}

/** A and B on the same rows, each B row with its own truck left out of the fit. */
export function candidateErrors(
  scored: readonly Scored[],
  fit: ConstantFit,
  drivingOnly: boolean,
): CandidateErrors {
  const out: CandidateErrors = { a: [], b: [], noFit: 0 };
  for (const s of scored) {
    const e = errorOf(s, 'route-speed', drivingOnly);
    if (e === null) continue;
    if (!fromRoute(s)) {
      out.a.push(e);
      out.b.push(e);
      continue;
    }
    const constant = fit.without.get(s.stop.truck_number) ?? null;
    if (constant === null) {
      out.noFit += 1;
      continue;
    }
    out.a.push(e);
    // The ETA moves LATER by the constant, so actual − predicted falls by it.
    out.b.push(e - constant);
  }
  return out;
}

export interface MarkVerdict {
  mark: number;
  a: ErrorSummary;
  b: ErrorSummary;
  /** med|e| of A minus med|e| of B: what B gains. */
  gain: number;
  gainEnough: boolean;
  worstRaised: boolean;
}

/** The rule, on driving-only errors by distance. */
export function judge(
  perMark: readonly { mark: number; a: readonly number[]; b: readonly number[] }[],
): { shipB: boolean; marks: MarkVerdict[] } {
  const marks = perMark.map(({ mark, a, b }) => {
    const sa = summarise(a);
    const sb = summarise(b);
    const gain = sa.medianAbs - sb.medianAbs;
    return {
      mark,
      a: sa,
      b: sb,
      gain,
      // NaN (no rows) is not a gain.
      gainEnough: gain >= MIN_GAIN_MINUTES,
      worstRaised: !(sb.p90Abs <= sa.p90Abs),
    };
  });
  return {
    shipB: marks.length > 0 && marks.every((m) => m.gainEnough && !m.worstRaised),
    marks,
  };
}

/* ------------------------------ LATE at the mark ------------------------- */

export interface LateCell {
  n: number;
  /** LATE under the 52 mph cap. */
  before: number;
  /** LATE at the route's own speed. */
  after: number;
  /** LATE before and not after: the warning the cap gave and the route's speed does not. */
  lost: number;
  /** LATE after and not before. */
  gained: number;
}

export interface LateAtMark {
  mark: number;
  actuallyLate: LateCell;
  onTime: LateCell;
  /** Of all replayed rows: the deadline had already passed at the mark. */
  pastAtMark: number;
  /** Rows with no deadline stored at the mark (`pos`, `rec`, or a log row without one). */
  notReplayable: number;
}

/**
 * Would the engine's LATE rule have fired at the mark: the ETA after the
 * deadline (`projected > deadline`, `computeStatus` step 5), under the cap and
 * at the route's speed.
 *
 * Only rows whose deadline was stored AT the mark, which is the log. A `pos`
 * or `rec` row has only the stop's deadline as it is today, and a deadline
 * edited since would be a guess.
 */
export function lateAtMarks(scored: readonly Scored[], marks: readonly number[]): LateAtMark[] {
  const cell = (): LateCell => ({ n: 0, before: 0, after: 0, lost: 0, gained: 0 });
  return marks.map((mark) => {
    const out: LateAtMark = { mark, actuallyLate: cell(), onTime: cell(), pastAtMark: 0, notReplayable: 0 };
    for (const s of scored) {
      if (s.mark !== mark) continue;
      const capped = s.eta.capped;
      const routeSpeed = s.eta['route-speed'];
      if (s.deadlineMs === null || capped === null || routeSpeed === null) {
        out.notReplayable += 1;
        continue;
      }
      const c = s.stop.arrived_at!.getTime() > s.deadlineMs ? out.actuallyLate : out.onTime;
      const before = capped > s.deadlineMs;
      const after = routeSpeed > s.deadlineMs;
      c.n += 1;
      if (before) c.before += 1;
      if (after) c.after += 1;
      if (before && !after) c.lost += 1;
      if (after && !before) c.gained += 1;
      if (s.anchorMs > s.deadlineMs) out.pastAtMark += 1;
    }
    return out;
  });
}
