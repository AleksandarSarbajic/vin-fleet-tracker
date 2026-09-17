import { z } from 'zod';

/**
 * Zod on every boundary. Shapes verified against org 45975 on 2026-09-17 —
 * see docs/samsara.md. Unknown keys are stripped, so a field Samsara adds
 * later cannot reach the database without us deciding to take it.
 */

/** A single GPS reading. Identical inside /stats and /stats/feed. */
export const GpsReading = z.object({
  time: z.string().datetime({ offset: true }),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  /**
   * 0 on a stationary vehicle — that is "no heading", not "north".
   * Do not rotate the marker when speedMilesPerHour is 0.
   */
  headingDegrees: z.number().optional(),
  speedMilesPerHour: z.number().optional(),
  reverseGeo: z.object({ formattedLocation: z.string().optional() }).optional(),
  isEcuSpeed: z.boolean().optional(),
});
export type GpsReading = z.infer<typeof GpsReading>;

/**
 * THE SHAPE TRAP (docs/samsara.md §4).
 *
 *   /fleet/vehicles/stats       → gps is an OBJECT
 *   /fleet/vehicles/stats/feed  → gps is an ARRAY
 *
 * They are modelled separately on purpose. Code that reads `row.gps.latitude`
 * against a feed row yields undefined at runtime; here it will not compile.
 */

/** Row from GET /fleet/vehicles/stats — seeding only. */
export const VehicleStatsRow = z.object({
  id: z.string(),
  name: z.string(),
  gps: GpsReading.optional(),
  engineState: z.object({ time: z.string(), value: z.string() }).optional(),
  obdOdometerMeters: z.object({ time: z.string(), value: z.number() }).optional(),
});
export type VehicleStatsRow = z.infer<typeof VehicleStatsRow>;

/** Row from GET /fleet/vehicles/stats/feed — the 30s poll. */
export const VehicleFeedRow = z.object({
  id: z.string(),
  name: z.string(),
  /** Every reading since the cursor. Iterate it; never take [0]. */
  gps: z.array(GpsReading).default([]),
});
export type VehicleFeedRow = z.infer<typeof VehicleFeedRow>;

/** Row from GET /fleet/vehicles. */
export const VehicleRow = z.object({
  id: z.string(),
  /** "Truck #147", never 147. Tags disagree with this — never use tags. */
  name: z.string(),
  vin: z.string().optional(),
  serial: z.string().optional(),
  notes: z.string().optional(),
  createdAtTime: z.string().optional(),
  updatedAtTime: z.string().optional(),
});
export type VehicleRow = z.infer<typeof VehicleRow>;

/**
 * Row from GET /fleet/drivers.
 *
 * The payload also carries licenseNumber, licenseState, eldSettings,
 * hosSetting, carrierSettings and username. They are deliberately absent
 * here: licence data is liability with no use, and the ELD/HOS fields are
 * the Hours of Service data this project cut. Zod strips them, so they
 * cannot reach the database by accident.
 */
export const DriverRow = z.object({
  id: z.string(),
  name: z.string(),
  driverActivationStatus: z.string().optional(),
  timezone: z.string().optional(),
});
export type DriverRow = z.infer<typeof DriverRow>;

/**
 * Envelope. `data` is null — not [] — when a collection is empty; observed
 * on /fleet/driver-vehicle-assignments. `data.map(...)` on that throws, so
 * null is coerced to [] here, once, at the boundary.
 */
export function envelope<T extends z.ZodTypeAny>(row: T) {
  return z.object({
    data: z
      .array(row)
      .nullable()
      .transform((d) => d ?? []),
    pagination: z
      .object({
        endCursor: z.string().default(''),
        hasNextPage: z.boolean().default(false),
      })
      .default({ endCursor: '', hasNextPage: false }),
  });
}

/**
 * Parses "Truck #147" → 147.
 *
 * Returns null when the name carries no digits. That is not hypothetical:
 * one vehicle in org 45975 is named exactly "Truck". The row renders the raw
 * samsara_name when truck_number is null rather than showing a blank cell.
 */
export function parseTruckNumber(samsaraName: string): number | null {
  const match = /(\d+)/.exec(samsaraName);
  if (!match?.[1]) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(n) ? n : null;
}

/** US ZIP, five digits with an optional +4. */
const ZIP = /^\d{5}(-\d{4})?$/;

/**
 * Extracts "City, ST" from Samsara's formattedLocation for the Position
 * column. The detail panel and tooltip get the whole string.
 *
 * Measured over 301 real readings from org 45975 (docs/samsara.md §2), the
 * value takes at least four shapes and THE ZIP IS OPTIONAL — 105 of 301 had
 * none:
 *
 *   "Hodgkins, IL, 60480"                          city, state, zip
 *   "1250 171st Street, East Hazel Crest, IL, …"   street, city, state, zip
 *   "I-94 W, Douglas County, MN"                   street, place, state
 *   "I 39;I 90, Town of Pleasant Springs, WI"      street, place, state
 *
 * So the component COUNT does not identify the shape — a 3-part value is
 * "city, state, zip" or "street, place, state" depending on the zip. Reading
 * a fixed offset from either end gets 35% of rows wrong: it would render
 * "I 39;I 90, Town of Pleasant Springs" as the city.
 *
 * Detect the zip, drop it, then take the last two. Returns the whole string
 * when it cannot, because a long cell is better than a wrong place.
 */
export function cityState(formattedLocation: string | null): string | null {
  if (!formattedLocation) return null;
  const parts = formattedLocation
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length > 0 && ZIP.test(parts[parts.length - 1] ?? '')) parts.pop();
  if (parts.length < 2) return formattedLocation;

  const state = parts[parts.length - 1];
  const city = parts[parts.length - 2];
  if (!city || !state) return formattedLocation;
  return `${city}, ${state}`;
}
