/**
 * REAL position data, recorded by the worker from Samsara (§12.36).
 *
 * Arrival detection shipped in phase 5 with 24 tests against synthetic
 * fixtures and, a week later, zero real events — because the watched stops
 * were seeded demo destinations that bear no relation to where this fleet
 * actually drives. The detector had never been given a chance to fire, which
 * is not the same as working.
 *
 * These are unedited fixes: real coordinates, real 11-30 s poll cadence, real
 * GPS jitter, real speed values. Only the STOP's coordinates are chosen, and
 * that is the one thing a dispatcher types anyway.
 *
 * Captured 2026-09-18 from the production feed.
 */

export interface RealFix {
  lat: number;
  lng: number;
  speedMph: number;
  recordedAtUtc: string;
}

/**
 * Truck 133 near Alexandria, MN — a TRAFFIC STOP, not an arrival.
 *
 * 69 mph, decelerating to 21, then 0 for THIRTY-SIX SECONDS, then away again
 * at 11, 15, 35, 53, 67, 69. A light or a junction.
 *
 * This is the false positive the two-poll confirmation exists to prevent, and
 * the exact failure the board cannot afford: a moving truck parked on the
 * screen, with a dispatcher told it has arrived somewhere it drove straight
 * past.
 */
export const TRUCK_133_TRAFFIC_STOP: RealFix[] = [
  { lat: 45.764092, lng: -95.02904, speedMph: 69.591, recordedAtUtc: '2026-09-18T08:19:36.535Z' },
  { lat: 45.765655, lng: -95.032827, speedMph: 69.591, recordedAtUtc: '2026-09-18T08:19:47.514Z' },
  { lat: 45.768287, lng: -95.038448, speedMph: 69.591, recordedAtUtc: '2026-09-18T08:20:04.501Z' },
  { lat: 45.771061, lng: -95.043906, speedMph: 69.591, recordedAtUtc: '2026-09-18T08:20:21.518Z' },
  { lat: 45.77237, lng: -95.046411, speedMph: 21.116, recordedAtUtc: '2026-09-18T08:20:33.503Z' },
  { lat: 45.772478, lng: -95.046626, speedMph: 0, recordedAtUtc: '2026-09-18T08:20:44.511Z' },
  { lat: 45.772468, lng: -95.04663, speedMph: 0, recordedAtUtc: '2026-09-18T08:21:05.503Z' },
  { lat: 45.772679, lng: -95.047042, speedMph: 11.184, recordedAtUtc: '2026-09-18T08:21:20.507Z' },
  { lat: 45.77298, lng: -95.047658, speedMph: 15.524, recordedAtUtc: '2026-09-18T08:21:33.509Z' },
  { lat: 45.773659, lng: -95.049023, speedMph: 35.411, recordedAtUtc: '2026-09-18T08:21:44.504Z' },
  { lat: 45.775469, lng: -95.052598, speedMph: 53.44, recordedAtUtc: '2026-09-18T08:22:01.512Z' },
  { lat: 45.777898, lng: -95.057911, speedMph: 67.734, recordedAtUtc: '2026-09-18T08:22:19.504Z' },
];

/** Where it briefly halted — a stop placed at the worst possible spot. */
export const TRUCK_133_HALT_POINT = { lat: 45.772478, lng: -95.046626 };

/**
 * Truck 142 near Wisconsin Dells — genuinely parked.
 *
 * Seventeen consecutive fixes at speed 0 across five minutes, with GPS
 * wander of 3.5e-5 degrees of latitude (about 12 ft) and 1.2e-4 of longitude
 * (about 30 ft). That jitter is the reason the radius is 0.25 mi and not
 * something tighter: a stationary truck's coordinates move.
 */
export const TRUCK_142_PARKED: RealFix[] = [
  { lat: 43.751331, lng: -89.94847, speedMph: 0, recordedAtUtc: '2026-09-18T08:01:52.514Z' },
  { lat: 43.75132, lng: -89.948478, speedMph: 0, recordedAtUtc: '2026-09-18T08:02:18.526Z' },
  { lat: 43.751312, lng: -89.948464, speedMph: 0, recordedAtUtc: '2026-09-18T08:02:30.526Z' },
  { lat: 43.751313, lng: -89.948444, speedMph: 0, recordedAtUtc: '2026-09-18T08:02:48.512Z' },
  { lat: 43.751319, lng: -89.948425, speedMph: 0, recordedAtUtc: '2026-09-18T08:03:03.546Z' },
  { lat: 43.751325, lng: -89.94843, speedMph: 0, recordedAtUtc: '2026-09-18T08:03:09.518Z' },
  { lat: 43.751329, lng: -89.948441, speedMph: 0, recordedAtUtc: '2026-09-18T08:03:30.560Z' },
  { lat: 43.751304, lng: -89.948446, speedMph: 0, recordedAtUtc: '2026-09-18T08:03:49.538Z' },
  { lat: 43.751296, lng: -89.948458, speedMph: 0, recordedAtUtc: '2026-09-18T08:04:04.528Z' },
  { lat: 43.751306, lng: -89.948445, speedMph: 0, recordedAtUtc: '2026-09-18T08:04:10.553Z' },
  { lat: 43.751316, lng: -89.948378, speedMph: 0, recordedAtUtc: '2026-09-18T08:04:34.513Z' },
  { lat: 43.751309, lng: -89.948425, speedMph: 0, recordedAtUtc: '2026-09-18T08:04:47.520Z' },
  { lat: 43.751311, lng: -89.948435, speedMph: 0, recordedAtUtc: '2026-09-18T08:04:53.503Z' },
  { lat: 43.751316, lng: -89.948415, speedMph: 0, recordedAtUtc: '2026-09-18T08:05:15.513Z' },
  { lat: 43.751321, lng: -89.948444, speedMph: 0, recordedAtUtc: '2026-09-18T08:05:26.507Z' },
  { lat: 43.751324, lng: -89.948358, speedMph: 0, recordedAtUtc: '2026-09-18T08:06:18.503Z' },
  { lat: 43.751311, lng: -89.948378, speedMph: 0, recordedAtUtc: '2026-09-18T08:06:45.538Z' },
];

/** The centre of that park, as a dispatcher would have typed the address. */
export const TRUCK_142_PARK_POINT = { lat: 43.751320, lng: -89.948470 };
