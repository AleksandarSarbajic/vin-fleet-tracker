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
    samsaraDriverId: text('samsara_driver_id').notNull(),
    name: text('name').notNull(),
    /**
     * Entered by dispatchers. Samsara returns no driver phone numbers for
     * this org. The detail panel hides "Call driver" when this is null
     * rather than rendering a dead button.
     */
    phone: text('phone'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
    // Never store licenseNumber, licenseState, eldSettings or hosSetting.
  },
  (t) => [uniqueIndex('drivers_samsara_driver_id_key').on(t.samsaraDriverId)],
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
    index('positions_truck_recorded_idx').on(t.truckId, t.recordedAt.desc()),
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
    /** Non-empty and trimmed, nothing more. Broker numbers come any shape. */
    loadNumber: text('load_number').notNull(),
    broker: text('broker'),
    status: loadStatus('status').notNull().default('AVAILABLE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  },
  (t) => [
    index('loads_truck_idx').on(t.truckId),
    check('loads_number_not_blank', sql`length(btrim(load_number)) > 0`),
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

    facilityName: text('facility_name'),
    addressLine: text('address_line'),
    city: text('city'),
    state: text('state'),
    zip: text('zip'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    /** Free text, as the broker wrote it. Never validated against a door list. */
    dockDoor: text('dock_door'),

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

    /** An appointment instant is meaningless without the zone it was read in. */
    check(
      'stops_appointment_needs_tz',
      sql`appointment_start_utc is null or appointment_tz is not null`,
    ),
    /** Spec §12.2: an FCFS cutoff carries no window. */
    check(
      'stops_fcfs_has_no_window',
      sql`appointment_type <> 'FCFS' or appointment_end_utc is null`,
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
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now),
  },
  () => [check('feed_health_singleton', sql`id = 1`)],
);
