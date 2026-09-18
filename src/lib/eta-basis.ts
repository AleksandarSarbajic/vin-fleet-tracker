import { elapsed } from './format';
import type { DistanceBasis } from './routing';
import type { EtaAbsence } from './status';

/**
 * The words a dispatcher reads next to an ETA (§12.30, §12.31, §12.33).
 *
 * Its own module, free of JSX, because these strings are the product of the
 * whole geocoding and routing chain and deserve to be readable — and testable
 * — without rendering a table row. The row, the map popup and the edit modal
 * import them, and so does the command-line check that verifies a real truck.
 */

export interface BasisFacts {
  etaPrecision: 'street' | 'block' | 'zip' | null;
  etaAccuracyMiles: number | null;
  distanceBasis: DistanceBasis;
  laneRatio: number | null;
  snapMeters: number | null;
  /** When this lane was last routed. Null when it never has been. */
  routeMeasuredAtUtc?: string | null;
}

/** The short form, for the popup line. `routed` says nothing — it is normal. */
export function basisShort(row: BasisFacts): string {
  switch (row.distanceBasis) {
    case 'routed':
      return 'routed road miles';
    case 'lane-estimate':
      return row.laneRatio
        ? `estimated from last route (×${row.laneRatio.toFixed(2)})`
        : 'estimated from last route';
    case 'straight-line':
      return 'straight-line estimate';
  }
}

/** ` ±4.6 mi`, or nothing when the accuracy is unknown or exact. */
function plusMinus(row: BasisFacts): string {
  return row.etaAccuracyMiles !== null && row.etaAccuracyMiles > 0
    ? ` ±${row.etaAccuracyMiles.toFixed(1)} mi`
    : '';
}

const ratio = (row: BasisFacts) => (row.laneRatio ? `×${row.laneRatio.toFixed(2)}` : null);

/** True when the distance is not a measured route for this truck's position. */
const degraded = (row: BasisFacts) => row.distanceBasis !== 'routed';

/**
 * TWO CLAUSES, never more (§12.33).
 *
 * This used to emit four: basis, precision, snap, rest breaks. Four is more
 * than anyone parses at 4am, and a label that does not get finished is worse
 * than a shorter one that does. Ranked by what changes a decision, only two
 * earn a place in something you must read past:
 *
 *   1. how far the destination might actually be — it decides whether to
 *      trust the ETA at all;
 *   2. that the time counts driving only — it moves the number by hours on a
 *      long lane.
 *
 * The rest is true and worth having, so it moved to `etaDetails()`, which a
 * dispatcher opens on purpose rather than reads by accident.
 *
 * Only ONE trust clause fires. Coarse coordinates beat a degraded distance,
 * because being three miles from the right place outranks the miles being
 * measured differently — and when both are true they combine into one
 * sentence rather than queueing.
 */
export function etaCaution(row: BasisFacts): string {
  const parts: string[] = [];
  const pm = plusMinus(row);

  if (row.etaPrecision === 'zip' && degraded(row)) {
    parts.push(
      `The destination is a ZIP-code centre${pm} and the distance is not a measured route — treat the time as a rough guide, and note that no at-risk warning will fire.`,
    );
  } else if (row.etaPrecision === 'zip') {
    /**
     * The four trailing words are the one demotion that would have been
     * wrong. Every other detail moved to `etaDetails` makes the board say
     * less about a number that is on screen; suppression makes the board
     * WITHHOLD a warning it would otherwise show, and a dispatcher reading a
     * row with no at-risk chip concludes the stop is fine. Inference from
     * absence is the one case where the label carries the whole meaning.
     */
    parts.push(
      `The destination is a ZIP-code centre${pm}, not a street address, so no at-risk warning will fire.`,
    );
  } else if (row.etaPrecision === 'block' && degraded(row)) {
    parts.push(
      `The destination is the nearest block on the right street${pm} and the distance is not a measured route — treat the time as a rough guide.`,
    );
  } else if (row.etaPrecision === 'block') {
    parts.push(
      `The destination is the nearest block on the right street${pm}, not the exact house number.`,
    );
  } else if (row.distanceBasis === 'straight-line') {
    parts.push('Distance is a straight line, not a road route, so the miles read short.');
  } else if (row.distanceBasis === 'lane-estimate') {
    const r = ratio(row);
    parts.push(
      r
        ? `Distance is estimated from this lane's last route (${r}), not routed again yet.`
        : 'Distance is estimated from this lane’s last route, not routed again yet.',
    );
  }

  parts.push('Arrival time counts driving only — no rest breaks.');
  return parts.join(' ');
}

export interface BasisDetail {
  label: string;
  value: string;
}

/**
 * Everything the caution does not say, for a surface someone opens
 * deliberately — the popup's collapsed detail block and the edit modal.
 *
 * The car-profile caveat lives here rather than in the tooltip because it
 * matters when reconciling against a rate confirmation, which is not what
 * anyone is doing while hovering a row. The snap distance lives here because
 * it is already inside the ± above it, and it is the one line answering a
 * question nobody asks.
 */
export function etaDetails(row: BasisFacts, now: Date = new Date()): BasisDetail[] {
  const details: BasisDetail[] = [];
  const pm = plusMinus(row).trim();

  switch (row.etaPrecision) {
    case 'zip':
      details.push({
        label: 'Accuracy',
        value: `ZIP-code centre, ${pm || 'radius unknown'} — Census has no record of this street`,
      });
      break;
    case 'block':
      details.push({
        label: 'Accuracy',
        value: `Nearest block on the right street, ${pm || 'distance unknown'} — the house number is outside the range Census carries`,
      });
      break;
    case 'street':
      details.push({
        label: 'Accuracy',
        value: 'Street address, interpolated along the block — not a rooftop',
      });
      break;
    case null:
      break;
  }

  switch (row.distanceBasis) {
    case 'routed':
      details.push({
        label: 'Distance',
        value:
          'Routed road miles for a car; a truck-mile figure on a rate confirmation will read longer',
      });
      break;
    case 'lane-estimate':
      details.push({
        label: 'Distance',
        value: `Straight line scaled by this lane's last measured route${
          ratio(row) ? ` (${ratio(row)})` : ''
        }`,
      });
      break;
    case 'straight-line':
      details.push({
        label: 'Distance',
        value: 'Straight line — no route has been measured for this lane yet',
      });
      break;
  }

  // Only worth saying once the snap is bigger than a car park.
  if (row.snapMeters !== null && row.snapMeters > 100) {
    details.push({
      label: 'Route',
      value: `Starts ${Math.round(row.snapMeters)} m from the destination point, at the nearest road`,
    });
  }

  if (row.laneRatio) {
    details.push({
      label: 'Lane',
      value: `${ratio(row)} measured straight-line-to-road on this lane`,
    });
  }

  const age = elapsed(row.routeMeasuredAtUtc ?? null, now);
  if (age) details.push({ label: 'Measured', value: `${age} ago` });

  return details;
}

/* --------------------------- the row's miles line ------------------------ */

/**
 * What the second line of the ETA cell says, or null for no second line
 * (§12.47).
 *
 * Miles used to live only in the tooltip, because the ETA column is 100px and
 * `14:18 CDT` measures 64 of them. Measured in Chromium against the real
 * Barlow: `~1204 mi` at `text-small` is 44.8px, so it fits under the time
 * without moving a single column.
 *
 * TWO states, not three (contract change — see below):
 *
 *     routed          412 mi     measured for THIS position
 *     not routed     ~412 mi     not measured for where the truck is now
 *
 * This shipped with three, splitting `lane-estimate` from `straight-line` by
 * colour. That split does not survive the weight this line has to sit at.
 *
 * The miles must be QUIETER than the time — the time is the decision, the
 * miles are supporting detail, and at `text-text-secondary` the eye landed on
 * the number underneath on a LATE row. Dropping them to `text-text-muted`
 * leaves nothing below muted for the third state, and a fourth level was
 * measured in Chromium and rejected: #6f777e against muted #858d94 is
 * indistinguishable at 10.5px, and #656d74 is distinguishable only by being
 * hard to read.
 *
 * So the split is made where it changes a decision, which is §12.33's rule.
 * Both non-routed bases mean the same thing to a dispatcher — trust it less,
 * open the popup — and `basisShort` keeps all three apart there, where there
 * is room for words.
 */
export interface MilesFacts extends BasisFacts {
  milesRemaining: number | null;
  etaAbsence: EtaAbsence;
}

export function etaMilesLine(
  row: MilesFacts,
  feedStale: boolean,
  milesText: (miles: number | null) => string | null,
): string | null {
  /**
   * The feed is down, so the distance is computed from a position nobody
   * trusts. The time already reads `stale`; a precise-looking mileage under
   * it would undo that in the same glance (§5.9).
   */
  if (feedStale) return null;

  /**
   * An arrived truck has no miles left worth printing, and a struck-through
   * ETA must not have live miles under it — the strike says "this number is
   * not being maintained", and a second number would contradict it.
   */
  if (row.etaAbsence === 'arrived' || row.etaAbsence === 'suppressed-unassigned') return null;

  const base = milesText(row.milesRemaining);
  /**
   * `null` is no distance at all. `arriving` is what milesText says under ten
   * miles — a word, not a number, and the second line exists to carry the
   * number. It is also the only string here with a descender, which is what
   * would have touched the row's bottom border.
   */
  if (base === null || base === 'arriving') return null;

  return row.distanceBasis === 'routed' ? base : `~${base}`;
}
