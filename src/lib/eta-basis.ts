import type { DistanceBasis } from './routing';

/**
 * The words a dispatcher reads next to an ETA (§12.30, §12.31).
 *
 * Its own module, free of JSX, because these strings are the product of the
 * whole geocoding and routing chain and deserve to be readable — and testable
 * — without rendering a table row. The row and the map popup both import
 * them, and so does the command-line check that verifies a real truck.
 */

export interface BasisFacts {
  etaPrecision: 'street' | 'block' | 'zip' | null;
  etaAccuracyMiles: number | null;
  distanceBasis: DistanceBasis;
  laneRatio: number | null;
  snapMeters: number | null;
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

/**
 * The full sentence, for a tooltip (§12.30, §12.31).
 *
 * Written to be read by a dispatcher deciding whether to phone a receiver,
 * not by whoever wrote it. It has to answer three things in plain words: how
 * far, how sure, and whether these are the miles a broker would pay.
 */
export function precisionNote(row: BasisFacts): string {
  const parts: string[] = [];

  switch (row.distanceBasis) {
    case 'routed':
      // The caveat that matters commercially: brokers pay truck miles.
      parts.push('Distance is a routed road distance for a car, so it can read short of a truck-mile figure on a rate confirmation.');
      break;
    case 'lane-estimate':
      parts.push(
        row.laneRatio
          ? `Distance is estimated from this lane's last route (×${row.laneRatio.toFixed(2)}), not routed again yet.`
          : 'Distance is estimated from this lane\u2019s last route, not routed again yet.',
      );
      break;
    case 'straight-line':
      parts.push('Distance is a straight-line estimate — no route has been measured for this lane.');
      break;
  }

  const plusMinus =
    row.etaAccuracyMiles !== null && row.etaAccuracyMiles > 0
      ? ` ±${row.etaAccuracyMiles.toFixed(1)} mi`
      : '';

  if (row.etaPrecision === 'zip') {
    parts.push(
      `The destination is a ZIP-code centre${plusMinus}, not a street address — Census has no record of this street. At risk is suppressed here because the area is wider than the warning is worth.`,
    );
  } else if (row.etaPrecision === 'block') {
    parts.push(
      `The destination is the nearest block on the right street${plusMinus}; the house number is outside the range Census carries.`,
    );
  }

  // Only worth saying once the snap is bigger than a car park.
  if (row.snapMeters !== null && row.snapMeters > 100) {
    parts.push(
      `The route starts from the nearest road, about ${Math.round(row.snapMeters)} m from that point.`,
    );
  }

  parts.push('Arrival time counts driving only — no rest breaks.');
  return parts.join(' ');
}
