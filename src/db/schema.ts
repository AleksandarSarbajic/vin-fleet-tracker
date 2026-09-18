import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSchema,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/* -------------------------------------------------------------------------
 * Conventions
 *
 * - Every instant is `timestamptz`. There are no naive local timestamps
 *   anywhere. Wall-clock intent is carried by a separate IANA zone string
 *   (stops.appointment_tz), never by a stored offset or abbreviation.
 * - Samsara owns position, odometer and engine state. We own all dispatch
 *   data. Nothing is ever written back to Samsara.
 * ---------------------------------------------------------------------- */

const now = sql`now()`;
const newId = sql`gen_random_uuid()`;

/** Supabase's own auth schema — we only reference auth.users.id. */
const authSchema = pgSchema('auth');
const authUsers = authSchema.table('users', { id: uuid('id').primaryKey() });

/* ---------------------------------- enums ------------------------------ */

export const userRole = pgEnum('user_role', ['admin', 'dispatcher', 'viewer']);

/** Emitted by lib/status.ts. This array is also the urgency sort order. */
export const truckStatus = pgEnum('truck_status', [
  'LATE',
  'STALE_GPS',
  'UNASSIGNED',
  'AT_RISK',
  'NO_APPT',
  'ARRIVED',
  'ON_TIME',
  'TOMORROW',
]);

export const stopType = pgEnum('stop_type', ['PU', 'DEL']);

/**
 * APPT = a booked slot with a window.
 * FCFS = a facility cutoff, not a slot. Spec §12.2: an FCFS stop can reach
 * LATE against its cutoff but never AT_RISK — there is no slot to miss,
 * only doors that close. FCFS carries no window, so no end instant.
 */
export const appointmentType = pgEnum('appointment_type', ['APPT', 'FCFS']);

/**
 * How precisely a stop's coordinates are known (§12.24, §12.30).
 *
 * Ordered most precise first, so a comparison reads the way it sounds.
 *
 * `street` — the house number matched inside a TIGER segment's range.
 *            NOT a rooftop: Census interpolates along the street centreline
 *            and never returns a parcel point.
 * `block`  — the street matched but the house number did not, so this is the
 *            nearest probed block on the correct street. Measured at
 *            0.16–0.78 mi from truth, which beats a ZIP centroid three to
 *            thirty times over and is still too coarse for arrival detection.
 * `zip`    — the ZCTA centroid, the last resort. Median 2.14 mi from truth,
 *            p90 5.51 mi, with the ZIP's own radius carried as the ±.
 *
 * Each level changes what the engine is allowed to conclude, which is the
 * whole reason this is stored rather than thrown away:
 *
 *              arrival detection      AT_RISK
 *     street          yes               yes
 *     block           no                yes
 *     zip             no                no
 *
 * `city` used to sit here and was retired in 0007. It was unreachable —
 * Census rejects city-only input outright — and a level nothing can write is
 * worse than no level, because it reads as a case that has been handled.
 */
export const geocodePrecision = pgEnum('geocode_precision', ['street', 'block', 'zip']);

/**
 * Where a driver row came from (§12.35).
 *
 * EXPLICIT, never inferred from `samsara_driver_id IS NULL`. That inference
 * is right until a merge fills the id in, which is precisely when the roster
 * sync most needs to know the row was ours — and by then the only evidence
 * the inference relied on is gone.
 */
export const driverSource = pgEnum('driver_source', ['samsara', 'app']);

export const overrideReason = pgEnum('override_reason', [
  'RECEIVER_CONFIRMED_DETENTION',
  'APPT_RESCHEDULED_BY_BROKER',
  'ELD_POSITION_WRONG',
  'DRIVER_REPORTED_DELAY',
  'OTHER',
]);

/**
 * The dispatcher's vocabulary for where a load is.
 *
 * TONU — "truck ordered not used" — is the broker cancelling AFTER the truck
 * is committed, and we bill for it. It is deliberately distinct from
 * CANCELLED: dispatchers need the two apart, and DISPATCHED can go straight
 * to TONU.
 *
 * Only DELIVERED, TONU and CANCELLED are terminal. **No ordering is enforced
 * between the rest** — real loads skip states constantly, and a state machine
 * that refuses a legitimate jump at 3am is worse than no state machine.
 */
export const loadStatus = pgEnum('load_status', [
  'AVAILABLE',
  'DISPATCHED',
  'AT_SHIPPER',
  'LOADED',
  'AT_RECEIVER',
  'DELIVERED',
  'TONU',
  'CANCELLED',
]);

/* --------------------------------- profiles ---------------------------- */

export const profiles = pgTable('profiles', {
  id: uuid('id')
    .primaryKey()
    .references(() => authUsers.id, { onDelete: 'cascade' }),
  fullName: text('full_name').notNull(),
  role: userRole('role').notNull().default('viewer'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
});

/* ---------------------------------- trucks ----------------------------- */

export const trucks = pgTable(
  'trucks',
  {
    id: uuid('id').primaryKey().default(newId),
    samsaraVehicleId: text('samsara_vehicle_id').notNull(),
    /** Raw Samsara name, e.g. "Truck #147". Source of truth, never `tags`. */
    samsaraName: text('samsara_name').notNull(),
    /** Parsed from samsaraName. Displayed bare in the tabular column. */
    truckNumber: integer('truck_number'),
    /**
     * OURS, not Samsara's. The stats feed returns every vehicle ever
     * registered, including trucks dead since 2019. Seeded from position
     * recency (a fix within 24h = active), flipped by an admin.
     */
    active: boolean('active').notNull().default(true),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  },
  (t) => [uniqueIndex('trucks_samsara_vehicle_id_key').on(t.samsaraVehicleId)],
);

/* --------------------------------- drivers ----------------------------- */

export const drivers = pgTable(
  'drivers',
  {
    id: uuid('id').primaryKey().default(newId),
    /**
     * Null for a driver a dispatcher created: a new hire is on the board
     * before anyone adds them to the ELD. Filled in by a merge (§12.35) once
     * onboarding completes and Samsara starts returning them.
     */
    samsaraDriverId: text('samsara_driver_id'),
    name: text('name').notNull(),
    /**
     * Entered by dispatchers. Samsara returns no driver phone numbers for
     * this org. The detail panel hides "Call driver" when this is null
     * rather than rendering a dead button.
     */
    phone: text('phone'),
    /** Samsara's `driverActivationStatus`. Overwritten every poll — not ours. */
    active: boolean('active').notNull().default(true),
    source: driverSource('source').notNull().default('samsara'),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    /**
     * Ours, and the sync never touches it. `active` could not be reused: it
     * belongs to Samsara and is rewritten on every poll, so after a merge the
     * sync would resurrect a driver an admin had retired.
     */
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
    // Never store licenseNumber, licenseState, eldSettings or hosSetting.
  },
  (t) => [
    // PARTIAL: unique only where there is an id to be unique about.
    uniqueIndex('drivers_samsara_driver_id_key')
      .on(t.samsaraDriverId)
      .where(sql`${t.samsaraDriverId} is not null`),
  ],
);

/**
 * A Samsara driver whose name matches one a dispatcher created (§12.35).
 *
 * Detected by the sync, never acted on by it. Name is the only signal Samsara
 * gives us — no phone, and we do not store licence data — and two drivers
 * called J. Martinez in a 24-driver fleet is not hypothetical. A wrong
 * automatic merge silently rewrites assignment history, so a human confirms.
 *
 * The dismissal is stored because the alternative is re-offering a rejected
 * match every thirty seconds for the rest of that driver's career.
 */
export const driverMergeCandidates = pgTable(
  'driver_merge_candidates',
  {
    id: uuid('id').primaryKey().default(newId),
    appDriverId: uuid('app_driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    samsaraDriverId: uuid('samsara_driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().default(now),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    dismissedBy: uuid('dismissed_by').references(() => profiles.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('driver_merge_candidates_pair_key').on(t.appDriverId, t.samsaraDriverId),
    check('driver_merge_candidates_distinct', sql`${t.appDriverId} <> ${t.samsaraDriverId}`),
  ],
);

/* -------------------------------- assignments -------------------------- */

/**
 * History, never a column on trucks. The two partial unique indexes are what
 * make a reassignment safe: at most one OPEN assignment per truck and per
 * driver. Without them a half-applied two-sided reassignment leaves one truck
 * holding the driver while the other still claims them.
 */
export const assignments = pgTable(
  'assignments',
  {
    id: uuid('id').primaryKey().default(newId),
    truckId: uuid('truck_id')
      .notNull()
      .references(() => trucks.id, { onDelete: 'cascade' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().default(now),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => profiles.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    uniqueIndex('assignments_one_open_per_truck')
      .on(t.truckId)
      .where(sql`ended_at is null`),
    uniqueIndex('assignments_one_open_per_driver')
      .on(t.driverId)
      .where(sql`ended_at is null`),
    index('assignments_truck_started_idx').on(t.truckId, t.startedAt.desc()),
    check(
      'assignments_ends_after_start',
      sql`ended_at is null or ended_at >= started_at`,
    ),
  ],
);

/* -------------------------------- positions ---------------------------- */

export const positions = pgTable(
  'positions',
  {
    id: uuid('id').primaryKey().default(newId),
    truckId: uuid('truck_id')
      .notNull()
      .references(() => trucks.id, { onDelete: 'cascade' }),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    /** 0 on stationary vehicles — do not rotate the marker when speed is 0. */
    heading: smallint('heading'),
    speedMph: doublePrecision('speed_mph'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    /**
     * Samsara's gps.reverseGeo.formattedLocation, stored whole, e.g.
     * "Maple Road, New Lenox, IL, 60451". Never computed here — there is no
     * geocoding service and nothing to cache.
     */
    formattedLocation: text('formatted_location'),
  },
  (t) => [
    /**
     * ONE index on (truck_id, recorded_at), not two.
     *
     * It does both jobs: it dedupes the feed — which returns the same reading
     * again across polls — and it serves the console's
     * `order by recorded_at desc limit 1` lateral seek, because a btree scans
     * backwards just as cheaply as forwards.
     *
     * A second, descending index used to sit beside it. Measured before
     * dropping it: 1008 kB, and `pg_stat_user_indexes.idx_scan = 0` — never
     * chosen once, against 19,940 scans of this one. It cost an index write
     * on every inserted position, and positions take ~26 inserts every 30
     * seconds forever.
     */
    uniqueIndex('positions_truck_recorded_key').on(t.truckId, t.recordedAt),
    check('positions_lat_range', sql`lat between -90 and 90`),
    check('positions_lng_range', sql`lng between -180 and 180`),
  ],
);

/* ---------------------------------- loads ------------------------------ */

export const loads = pgTable(
  'loads',
  {
    id: uuid('id').primaryKey().default(newId),
    truckId: uuid('truck_id').references(() => trucks.id, { onDelete: 'set null' }),
    /**
     * §12.21: optional. Broker paperwork does not always carry a number at
     * the moment the load is entered, and a dispatcher who cannot save
     * without one invents one — an invented number is worse than null,
     * because it looks real.
     *
     * NULL, never ''. Two ways to say "not known yet" is one too many.
     */
    loadNumber: text('load_number'),
    status: loadStatus('status').notNull().default('AVAILABLE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  },
  (t) => [
    index('loads_truck_idx').on(t.truckId),
    /**
     * A blank string is not a load number either — if it is present it has to
     * be something. The not-NULL requirement is what §12.21 removed.
     */
    check(
      'loads_number_not_blank',
      sql`load_number is null or length(btrim(load_number)) > 0`,
    ),
  ],
);

/* ---------------------------------- stops ------------------------------ */

export const stops = pgTable(
  'stops',
  {
    id: uuid('id').primaryKey().default(newId),
    loadId: uuid('load_id')
      .notNull()
      .references(() => loads.id, { onDelete: 'cascade' }),
    type: stopType('type').notNull(),
    sequence: integer('sequence').notNull(),

    addressLine: text('address_line'),
    city: text('city'),
    state: text('state'),
    zip: text('zip'),
    /**
     * §12.24. Written ONLY by the forward geocoder in server/geocode.ts, from
     * the four address fields above, in the same save. Never typed, never
     * accepted from a client.
     */
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    geocodePrecision: geocodePrecision('geocode_precision'),
    /** The ± in miles. Null for a `street` match; set for `block` and `zip`. */
    geocodeAccuracyMiles: doublePrecision('geocode_accuracy_miles'),
    /** Mapbox v6 `properties.match_code.confidence` — exact | high. */
    geocodeConfidence: text('geocode_confidence'),
    /** The address Mapbox says it matched, for eyeballing a suspect ETA. */
    geocodedAddress: text('geocoded_address'),
    geocodedAt: timestamp('geocoded_at', { withTimezone: true }),

    /**
     * Written from stop-local wall time + appointment_tz, converted
     * server-side. The API never accepts a UTC instant for an appointment
     * from the client.
     */
    appointmentStartUtc: timestamp('appointment_start_utc', { withTimezone: true }),
    appointmentEndUtc: timestamp('appointment_end_utc', { withTimezone: true }),
    appointmentTz: text('appointment_tz'),
    appointmentType: appointmentType('appointment_type').notNull().default('APPT'),

    arrivedAt: timestamp('arrived_at', { withTimezone: true }),
    departedAt: timestamp('departed_at', { withTimezone: true }),

    dispatcherNote: text('dispatcher_note'),
    noteBy: uuid('note_by').references(() => profiles.id, { onDelete: 'set null' }),
    noteAt: timestamp('note_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('stops_load_sequence_key').on(t.loadId, t.sequence),
    index('stops_open_idx')
      .on(t.loadId, t.sequence)
      .where(sql`departed_at is null`),

    /**
     * §12.44. The shape the normaliser in `StopEdit` produces, asserted at the
     * layer a future write path cannot skip — the seed script and the
     * geocoder both write these columns without passing through it.
     */
    check('stops_state_two_letters', sql`state is null or state ~ '^[A-Z]{2}$'`),
    check('stops_zip_five_digits', sql`zip is null or zip ~ '^[0-9]{5}$'`),

    /** An appointment instant is meaningless without the zone it was read in. */
    check(
      'stops_appointment_needs_tz',
      sql`appointment_start_utc is null or appointment_tz is not null`,
    ),
    /**
     * §12.22, superseding §12.2's last bullet: an FCFS stop carries RECEIVING
     * HOURS, not a bare cutoff. `appointment_start_utc` is the earliest hour
     * and `appointment_end_utc` the latest — the deadline the status engine
     * measures against. So an FCFS stop with a start must have an end; the
     * old constraint forbade exactly that.
     */
    check(
      'stops_fcfs_has_window',
      sql`appointment_type <> 'FCFS'
          or appointment_start_utc is null
          or appointment_end_utc is not null`,
    ),
    /** Receiving hours of zero length are a typo, not a facility. */
    check(
      'stops_fcfs_window_positive',
      sql`appointment_type <> 'FCFS'
          or appointment_start_utc is null
          or appointment_end_utc is null
          or appointment_end_utc > appointment_start_utc`,
    ),
    check(
      'stops_window_ordered',
      sql`appointment_end_utc is null or appointment_start_utc is null
          or appointment_end_utc >= appointment_start_utc`,
    ),
    check(
      'stops_departed_after_arrived',
      sql`departed_at is null or arrived_at is null or departed_at >= arrived_at`,
    ),
  ],
);

/* ------------------------------ geocode_cache -------------------------- */

/**
 * Forward-geocoding results, keyed by the NORMALISED address string (see
 * lib/address.ts). Provider data, not dispatch data — nothing here is
 * authoritative and the whole table can be truncated without losing a fact
 * the business owns.
 *
 * Why it exists: the same DC gets entered over and over. One call per
 * distinct address instead of one per stop.
 *
 * Misses are cached too, with `lat` null. A typo that fails to resolve would
 * otherwise spend a call on every save of the same stop. They expire sooner
 * than hits — see server/geocode.ts — because a miss is usually a typo, and
 * caching a typo forever keeps punishing the corrected version.
 *
 * `fetched_at` also carries the 30-day expiry that makes storage legal if the
 * Mapbox account cannot grant `permanent=true`: coordinates re-derive from an
 * address we already own, so expiry costs one call per stop per month.
 */
export const geocodeCache = pgTable(
  'geocode_cache',
  {
    /** lib/address.ts `normalizeAddress` output. Not a display string. */
    normalizedAddress: text('normalized_address').primaryKey(),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    precision: geocodePrecision('precision'),
    accuracyMiles: doublePrecision('accuracy_miles'),
    confidence: text('confidence'),
    /** What the provider says it matched, verbatim. */
    matchedAddress: text('matched_address'),
    /** Why a miss was a miss, for the modal warning and for debugging. */
    missReason: text('miss_reason'),
    provider: text('provider').notNull().default('mapbox-v6'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().default(now),
  },
  (t) => [
    index('geocode_cache_fetched_idx').on(t.fetchedAt),
    /** A hit has both coordinates or neither. Half a coordinate is a bug. */
    check(
      'geocode_cache_coords_paired',
      sql`(lat is null) = (lng is null)`,
    ),
    /** A hit must say how good it is; a miss must say why it missed. */
    check(
      'geocode_cache_hit_has_precision',
      sql`(lat is null and precision is null and miss_reason is not null)
          or (lat is not null and precision is not null and miss_reason is null)`,
    ),
  ],
);

/* ------------------------------- routing ------------------------------- */

/**
 * The cached route for a stop (§12.31). One row per stop, replaced in place.
 *
 * A separate table rather than columns on `stops`, which is already wide, and
 * because routing is the concern most likely to change provider: swapping one
 * means dropping this table, not migrating the core of the schema.
 *
 * Keyed on `stop_id`, which makes one invalidation free. When an appointment
 * changes and a truck's NEXT stop becomes a different stop (§12.13), the
 * lookup simply lands on a different row — nothing has to notice or expire.
 * A stop being re-geocoded is caught instead by comparing `stop_lat/lng`.
 */
export const stopRoutes = pgTable(
  'stop_routes',
  {
    stopId: uuid('stop_id')
      .primaryKey()
      .references(() => stops.id, { onDelete: 'cascade' }),

    routedMiles: doublePrecision('routed_miles').notNull(),
    /** Seconds, as the provider gave them. A CAR duration — see §12.31. */
    routedDurationS: doublePrecision('routed_duration_s').notNull(),

    /** Where the truck was when this was routed. The recompute rule's origin. */
    fromLat: doublePrecision('from_lat').notNull(),
    fromLng: doublePrecision('from_lng').notNull(),
    /** Straight-line miles at that moment, so `lane_ratio` is reproducible. */
    straightAtRouteMiles: doublePrecision('straight_at_route_miles').notNull(),
    /**
     * routed_miles / straight_at_route_miles. The measured road factor for
     * THIS lane, which is what replaced the brief's global 1.25 — measured
     * spread across our own lanes was 1.070 to 1.460.
     */
    laneRatio: doublePrecision('lane_ratio').notNull(),

    /** The stop's coordinates when routed. A re-geocode invalidates the row. */
    stopLat: doublePrecision('stop_lat').notNull(),
    stopLng: doublePrecision('stop_lng').notNull(),

    /** How far the provider MOVED each end to reach a road, in metres. */
    snapFromM: doublePrecision('snap_from_m'),
    snapToM: doublePrecision('snap_to_m'),

    provider: text('provider').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().default(now),
  },
  (t) => [
    index('stop_routes_computed_idx').on(t.computedAt),
    check('stop_routes_miles_positive', sql`routed_miles > 0 and lane_ratio > 0`),
  ],
);

/**
 * Every route ever measured. Append-only, and nothing reads it yet.
 *
 * Fargo at 1.07 and Joliet at 1.46 are stable facts about those corridors,
 * not noise. After a few weeks this is a table of the lanes this company
 * actually runs — which is what would let anyone sanity-check a provider
 * swap, or notice a lane whose ratio moved because of construction.
 *
 * Written in the same transaction as the cache row, so the history cannot
 * disagree with the cache.
 */
export const routeSamples = pgTable(
  'route_samples',
  {
    id: uuid('id').primaryKey().default(newId),
    /**
     * PROVENANCE ONLY — which stop this was measured for, at the time.
     *
     * **Not a join key for destination facts** (§12.54). The stop is a live
     * row and may since have been re-pointed anywhere: 31% of the samples
     * that existed when this comment was written already named a destination
     * their stop no longer had. Joining `stops` to recover a destination
     * returns Hazleton for a Dallas measurement.
     */
    stopId: uuid('stop_id').references(() => stops.id, { onDelete: 'set null' }),

    /** Denormalised ON PURPOSE: the stop may be edited or deleted later, and
     *  a sample whose destination can change is not a measurement. */
    destCity: text('dest_city'),
    destState: text('dest_state'),
    destZip: text('dest_zip'),
    destPrecision: geocodePrecision('dest_precision'),
    /**
     * The coordinates actually routed to, snapshotted with the rest (§12.54).
     * These were the gap: the city was denormalised and the point it referred
     * to was not, so the row could name its destination and not locate it.
     * Null only on rows measured before migration 0014 that could not be
     * recovered.
     */
    destLat: doublePrecision('dest_lat'),
    destLng: doublePrecision('dest_lng'),

    straightMiles: doublePrecision('straight_miles').notNull(),
    routedMiles: doublePrecision('routed_miles').notNull(),
    laneRatio: doublePrecision('lane_ratio').notNull(),
    routedDurationS: doublePrecision('routed_duration_s').notNull(),
    /** routed_miles / routed_hours — the provider's implied speed, uncapped. */
    impliedMph: doublePrecision('implied_mph'),

    snapFromM: doublePrecision('snap_from_m'),
    snapToM: doublePrecision('snap_to_m'),

    provider: text('provider').notNull(),
    measuredAt: timestamp('measured_at', { withTimezone: true }).notNull().default(now),
  },
  (t) => [
    index('route_samples_measured_idx').on(t.measuredAt),
    index('route_samples_dest_idx').on(t.destState, t.destCity),
  ],
);

/**
 * Routing calls per UTC month, against a configured ceiling (§12.31).
 *
 * In the DATABASE rather than in worker memory, so a crash loop cannot reset
 * the counter — which is precisely the situation in which a runaway would
 * happen. There is no hard spend cap on the Mapbox account, so this is the
 * only thing between a caching bug and a bill.
 */
export const routingBudget = pgTable('routing_budget', {
  /** `YYYY-MM`, UTC. */
  month: text('month').primaryKey(),
  calls: integer('calls').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now),
});

/* -------------------------------- overrides ---------------------------- */

/**
 * An active override returns the forced status, but the engine keeps
 * computing the real one and the API returns BOTH — the detail panel renders
 * them adjacent.
 *
 * Expiry is evaluated ON READ, never by a scheduled job that might not run.
 * There is no "never": expires_at is mandatory.
 */
export const overrides = pgTable(
  'overrides',
  {
    id: uuid('id').primaryKey().default(newId),
    stopId: uuid('stop_id')
      .notNull()
      .references(() => stops.id, { onDelete: 'cascade' }),
    forcedStatus: truckStatus('forced_status').notNull(),
    reason: overrideReason('reason').notNull(),
    reasonNote: text('reason_note'),
    setBy: uuid('set_by').references(() => profiles.id, { onDelete: 'set null' }),
    setAt: timestamp('set_at', { withTimezone: true }).notNull().default(now),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    clearedAt: timestamp('cleared_at', { withTimezone: true }),
  },
  (t) => [
    index('overrides_stop_idx').on(t.stopId, t.setAt.desc()),
    uniqueIndex('overrides_one_live_per_stop')
      .on(t.stopId)
      .where(sql`cleared_at is null`),
    /** Only the three the modal's segmented control offers. */
    check(
      'overrides_forced_status_allowed',
      sql`forced_status in ('LATE', 'ARRIVED', 'NO_APPT')`,
    ),
    check('overrides_expires_after_set', sql`expires_at > set_at`),
    /** "Other" is only countable in review if it carries a note. */
    check(
      'overrides_other_needs_note',
      sql`reason <> 'OTHER' or length(btrim(coalesce(reason_note, ''))) > 0`,
    ),
  ],
);

/* -------------------------------- audit_log ---------------------------- */

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().default(newId),
    actorUserId: uuid('actor_user_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  },
  (t) => [
    index('audit_log_entity_idx').on(t.entity, t.entityId, t.createdAt.desc()),
    index('audit_log_created_idx').on(t.createdAt.desc()),
  ],
);

/* ------------------------------- feed_health --------------------------- */

/** Singleton. The offline rule reads newest_position_at from here. */
export const feedHealth = pgTable(
  'feed_health',
  {
    id: smallint('id').primaryKey().default(1),
    newestPositionAt: timestamp('newest_position_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastError: text('last_error'),
    /** Persisted in the DB, not in memory, so a worker restart resumes. */
    cursor: text('cursor'),
    /**
     * Missed-cycle history (§12.39). `last_error` answers "is it broken now",
     * and is cleared by the next success — so eleven stalls totalling 5.5
     * hours left no trace at all once the worker recovered.
     */
    stallStartedAt: timestamp('stall_started_at', { withTimezone: true }),
    longestStallSeconds: integer('longest_stall_seconds'),
    longestStallAt: timestamp('longest_stall_at', { withTimezone: true }),
    missedCycles: integer('missed_cycles').notNull().default(0),
    /**
     * When per-stall recording began (§12.42). An empty day and an unrecorded
     * day are different facts, and the counters above cannot tell them apart.
     */
    stallLogSince: timestamp('stall_log_since', { withTimezone: true }).notNull().default(now),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now),
  },
  () => [check('feed_health_singleton', sql`id = 1`)],
);

/* ------------------------------- feed_stalls --------------------------- */

/**
 * One row per stall, written when the poll that recovers it succeeds (§12.42).
 *
 * The counters on feed_health are cumulative, so they answer "has it ever
 * been" and never "was it broken yesterday". This is the table that makes the
 * second question answerable — and answerable from psql, months later,
 * without the worker's stdout.
 */
export const feedStalls = pgTable(
  'feed_stalls',
  {
    id: uuid('id').primaryKey().default(newId),
    /** The last poll that succeeded, and the one that recovered. */
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
    seconds: integer('seconds').notNull(),
    missedCycles: integer('missed_cycles').notNull(),
  },
  (t) => [
    index('feed_stalls_ended_idx').on(t.endedAt.desc()),
    check('feed_stalls_ordered', sql`ended_at >= started_at`),
    check('feed_stalls_positive', sql`seconds > 0`),
  ],
);
