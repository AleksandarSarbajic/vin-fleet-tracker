import type { Feature, FeatureCollection, Point } from 'geojson';
import type { FleetRow } from '@/server/fleet-query';
import { isProblem } from '@/lib/status';

export interface TruckFeatureProps extends Record<string, unknown> {
  id: string;
  truckNumber: number | null;
  label: string;
  status: string;
}

export type TruckFeature = Feature<Point, TruckFeatureProps>;
export type TruckCollection = FeatureCollection<Point, TruckFeatureProps>;

const EMPTY: TruckCollection = { type: 'FeatureCollection', features: [] };

export function toFeature(row: FleetRow, feedStale = false): TruckFeature | null {
  if (row.lat === null || row.lng === null) return null;
  return {
    type: 'Feature',
    id: row.id,
    geometry: { type: 'Point', coordinates: [row.lng, row.lat] },
    properties: {
      id: row.id,
      truckNumber: row.truckNumber,
      label: row.truckNumber === null ? row.samsaraName : String(row.truckNumber),
      // §5.9: with the feed down every marker drops to the stale shape. A
      // green dot on a position nobody trusts is the same lie as a green row.
      status: feedStale ? 'STALE_GPS' : row.status,
    },
  };
}

/**
 * Splits the fleet into two collections so the clustering rule is STRUCTURAL
 * rather than something to remember (design-spec §12.5):
 *
 *   problem   LATE, STALE_GPS, UNASSIGNED, AT_RISK, NO_APPT — never clusters,
 *             because they are not in the source that clusters.
 *   clustered everything else, ARRIVED included.
 *
 * A late truck therefore cannot be hidden inside a cluster bubble. Not by
 * policy — by construction.
 *
 * ONE feature per truck, built from the LATEST position. The feed returns
 * several readings per vehicle per poll (one truck carried five, five seconds
 * apart); those are history rows, not markers.
 */
export function splitForMap(
  rows: FleetRow[],
  feedStale = false,
): {
  problem: TruckCollection;
  clustered: TruckCollection;
} {
  const problem: TruckFeature[] = [];
  const clustered: TruckFeature[] = [];

  for (const row of rows) {
    const feature = toFeature(row, feedStale);
    if (!feature) continue;
    // STALE_GPS is in the problem set, so a stale feed also stops everything
    // clustering — which is right: nothing should be summarised into a
    // bubble while the positions behind it are frozen.
    (isProblem(feedStale ? 'STALE_GPS' : row.status) ? problem : clustered).push(feature);
  }

  return {
    problem: { type: 'FeatureCollection', features: problem },
    clustered: { type: 'FeatureCollection', features: clustered },
  };
}

export function selectionCollection(row: FleetRow | null): TruckCollection {
  if (!row) return EMPTY;
  const feature = toFeature(row);
  return feature ? { type: 'FeatureCollection', features: [feature] } : EMPTY;
}

/** Continental US. Used when no active truck has a position yet. */
export const US_FALLBACK = { longitude: -98.6, latitude: 39.8, zoom: 3.6 } as const;

/**
 * Zoom floor for the initial fit. Without it a single truck — or a fleet
 * parked in one yard — drops the dispatcher to street level looking at a
 * rooftop.
 */
export const MAX_INITIAL_ZOOM = 9;

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function boundsOf(rows: FleetRow[]): Bounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  let seen = 0;

  for (const r of rows) {
    if (r.lat === null || r.lng === null) continue;
    seen += 1;
    west = Math.min(west, r.lng);
    east = Math.max(east, r.lng);
    south = Math.min(south, r.lat);
    north = Math.max(north, r.lat);
  }

  if (seen === 0) return null;
  return { west, south, east, north };
}
