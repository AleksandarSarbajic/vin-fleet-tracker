import { ZIP_CENTROID_DATA, ZIP_CENTROID_VINTAGE } from './zip-centroids.data';

/**
 * ZIP centroid lookup. Pure, offline, no network (§12.30).
 *
 * The last resort in the geocoding chain. It exists because TIGER does not
 * carry new private industrial-park roads — CenterPoint Elwood, Joliet,
 * Willow Springs — which is exactly where this fleet's lanes go. Measured:
 * "Walton Dr, Elwood IL" has no house number at all in TIGER, so the stop
 * projected no ETA and the board could only discover lateness from the clock.
 */

export interface ZipCentroid {
  lat: number;
  lng: number;
  /**
   * The radius of a circle with the same land area as the ZIP. The ± a
   * dispatcher is shown, derived rather than assumed.
   */
  radiusMiles: number;
}

export { ZIP_CENTROID_VINTAGE };

/**
 * Parsed once, on first use, not at import.
 *
 * 33,791 rows is a tenth of a second of parsing. Doing it at module load
 * would put that on the first request to touch this module even when the
 * address geocodes normally — which is the overwhelmingly common case and
 * the one that must not be slowed down for the rare one.
 */
let table: Map<string, ZipCentroid> | null = null;

function load(): Map<string, ZipCentroid> {
  if (table) return table;
  const next = new Map<string, ZipCentroid>();
  for (const line of ZIP_CENTROID_DATA.split('\n')) {
    if (line === '') continue;
    const [zip, lat, lng, radius] = line.split(',');
    if (!zip || !lat || !lng) continue;
    next.set(zip, {
      lat: Number(lat),
      lng: Number(lng),
      radiusMiles: Number(radius ?? 0),
    });
  }
  table = next;
  return next;
}

/** Null for a ZIP the gazetteer does not carry — PO boxes have no area. */
export function zipCentroid(zip: string | null): ZipCentroid | null {
  if (!zip) return null;
  const five = zip.replace(/\D/g, '').slice(0, 5);
  if (five.length !== 5) return null;
  return load().get(five) ?? null;
}
