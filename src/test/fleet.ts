import { sql } from 'drizzle-orm';
import {
  assignments,
  drivers,
  loads,
  overrides,
  positions,
  stopRoutes,
  stops,
  trucks,
} from '@/db/schema';
import type { Tx } from '@/server/audit';

/**
 * Fixture builders (§12.32).
 *
 * Every suite used to open with `select … from trucks limit 1`, which against
 * a shared database means the test's subject is whichever truck happened to
 * exist — so the same test exercised a different row on Tuesday than it did
 * on Monday, and an assignment fixture could claim a driver a dispatcher had
 * just assigned for real. The database is empty now, so that line returns
 * nothing and the fixture throws. These replace it.
 *
 * A test builds the fleet it needs and asserts against that. Nothing here
 * reads an existing row.
 */

/**
 * Unique per call, because `samsara_vehicle_id` and `samsara_driver_id` are
 * both unique indexes and two fixtures in one transaction would collide.
 * Counter rather than random: a collision that depends on chance is exactly
 * the kind of test failure nobody can reproduce.
 */
let seq = 0;
const nextSeq = () => ++seq;

export interface TruckOptions {
  truckNumber?: number;
  active?: boolean;
  lastSeenAt?: Date | null;
}

export async function makeTruck(tx: Tx, options: TruckOptions = {}) {
  const n = nextSeq();
  const [truck] = await tx
    .insert(trucks)
    .values({
      samsaraVehicleId: `vitest-vehicle-${n}`,
      samsaraName: `Vitest ${options.truckNumber ?? n}`,
      truckNumber: options.truckNumber ?? 9000 + n,
      active: options.active ?? true,
      ...(options.lastSeenAt !== undefined ? { lastSeenAt: options.lastSeenAt } : {}),
    })
    .returning({ id: trucks.id, truckNumber: trucks.truckNumber });
  return truck!;
}

export async function makeDriver(tx: Tx, options: { name?: string; active?: boolean } = {}) {
  const n = nextSeq();
  const [driver] = await tx
    .insert(drivers)
    .values({
      samsaraDriverId: `vitest-driver-${n}`,
      name: options.name ?? `Vitest Driver ${n}`,
      active: options.active ?? true,
    })
    .returning({ id: drivers.id, name: drivers.name });
  return driver!;
}

/** An open assignment — the shape the one-driver-per-truck invariant guards. */
export async function assign(tx: Tx, truckId: string, driverId: string) {
  const [row] = await tx
    .insert(assignments)
    .values({ truckId, driverId })
    .returning({ id: assignments.id });
  return row!;
}

/** A truck with a driver already on it, which is the common starting point. */
export async function makeAssignedTruck(tx: Tx, options: TruckOptions = {}) {
  const truck = await makeTruck(tx, options);
  const driver = await makeDriver(tx);
  await assign(tx, truck.id, driver.id);
  return { truck, driver };
}

export interface PositionOptions {
  lat: number;
  lng: number;
  recordedAt: Date;
  speedMph?: number;
  heading?: number;
  formattedLocation?: string;
}

export async function makePosition(tx: Tx, truckId: string, options: PositionOptions) {
  const [row] = await tx
    .insert(positions)
    .values({
      truckId,
      lat: options.lat,
      lng: options.lng,
      recordedAt: options.recordedAt,
      ...(options.speedMph !== undefined ? { speedMph: options.speedMph } : {}),
      ...(options.heading !== undefined ? { heading: options.heading } : {}),
      ...(options.formattedLocation !== undefined
        ? { formattedLocation: options.formattedLocation }
        : {}),
    })
    .returning({ id: positions.id });
  return row!;
}

/**
 * A dispatcher, via `auth.users` so the signup trigger writes the profile —
 * which is the only way `overrides.set_by` can point at a real name.
 *
 * Possible only because the cluster is ours: against production this would be
 * creating a user in somebody's real auth system.
 */
export async function makeDispatcher(tx: Tx, name = 'Vitest Dispatcher') {
  const n = nextSeq();
  const [row] = (await tx.execute(sql`
    insert into auth.users (email, raw_user_meta_data)
    values (${`vitest-${n}@example.test`}, ${JSON.stringify({ full_name: name })}::jsonb)
    returning id
  `)) as unknown as [{ id: string }];
  return { id: row!.id, name };
}

/**
 * A truck with EVERY column of the fleet query populated: driver, position,
 * load, stop, geocode, route and an active override.
 *
 * The column-type assertions in fleet-query.test.ts skip nulls, so a fixture
 * that leaves a column null silently stops checking it. Against production
 * most of these were null most of the time, which meant the test claiming to
 * verify forty column types was verifying rather fewer.
 */
export async function makeFullFleetRow(tx: Tx, options: TruckOptions = {}) {
  const { truck, driver } = await makeAssignedTruck(tx, options);
  const dispatcher = await makeDispatcher(tx);
  const recordedAt = new Date(Date.now() - 5 * 60_000);

  await makePosition(tx, truck.id, {
    lat: 41.8781,
    lng: -87.6298,
    speedMph: 54.5,
    heading: 270,
    recordedAt,
    formattedLocation: 'Halsted Street, Chicago, IL, 60607',
  });

  const [load] = await tx
    .insert(loads)
    .values({ truckId: truck.id, loadNumber: `VT-${nextSeq()}`, status: 'DISPATCHED' })
    .returning({ id: loads.id });

  const [stop] = await tx
    .insert(stops)
    .values({
      loadId: load!.id,
      type: 'DEL',
      sequence: 1,
      addressLine: '1 Vitest Fixture Street',
      city: 'Joliet',
      state: 'IL',
      zip: '60433',
      lat: 41.525,
      lng: -88.0817,
      geocodePrecision: 'street',
      geocodeAccuracyMiles: 0.1,
      geocodeConfidence: 'census:street',
      geocodedAddress: '1 VITEST FIXTURE ST, JOLIET, IL, 60433',
      geocodedAt: new Date(),
      appointmentStartUtc: new Date(Date.now() + 4 * 3_600_000),
      appointmentEndUtc: new Date(Date.now() + 5 * 3_600_000),
      appointmentTz: 'America/Chicago',
      appointmentType: 'APPT',
      dispatcherNote: 'fixture',
    })
    .returning({ id: stops.id });

  await tx.insert(stopRoutes).values({
    stopId: stop!.id,
    routedMiles: 42.5,
    routedDurationS: 2_700,
    fromLat: 41.8781,
    fromLng: -87.6298,
    straightAtRouteMiles: 35.2,
    laneRatio: 1.207,
    stopLat: 41.525,
    stopLng: -88.0817,
    snapFromM: 8,
    snapToM: 12,
    provider: 'vitest',
  });

  await tx.insert(overrides).values({
    stopId: stop!.id,
    forcedStatus: 'LATE',
    reason: 'RECEIVER_CONFIRMED_DETENTION',
    reasonNote: 'fixture',
    setBy: dispatcher.id,
    expiresAt: new Date(Date.now() + 2 * 3_600_000),
  });

  return { truck, driver, dispatcher, loadId: load!.id, stopId: stop!.id, recordedAt };
}

export interface LaneOptions {
  /** Where the truck is. Defaults to Chicago. */
  from?: { lat: number; lng: number };
  /** Where the stop is. Defaults to Joliet. */
  to?: { lat: number; lng: number };
  precision?: 'street' | 'block' | 'zip';
  city?: string;
  state?: string;
  zip?: string;
  arrived?: boolean;
}

/**
 * A truck the routing sweep will pick up: active, with a position, an open
 * load, and a stop that has coordinates and has not been arrived at.
 *
 * No cached route — that is what the sweep is for.
 */
export async function makeRoutableLane(tx: Tx, options: LaneOptions = {}) {
  const from = options.from ?? { lat: 41.8781, lng: -87.6298 };
  const to = options.to ?? { lat: 41.525, lng: -88.0817 };
  const truck = await makeTruck(tx);

  await makePosition(tx, truck.id, {
    ...from,
    speedMph: 55,
    recordedAt: new Date(Date.now() - 60_000),
    formattedLocation: 'Halsted Street, Chicago, IL, 60607',
  });

  const [load] = await tx
    .insert(loads)
    .values({ truckId: truck.id, loadNumber: `VT-LANE-${nextSeq()}`, status: 'DISPATCHED' })
    .returning({ id: loads.id });

  const [stop] = await tx
    .insert(stops)
    .values({
      loadId: load!.id,
      type: 'DEL',
      sequence: 1,
      addressLine: '1 Vitest Fixture Street',
      city: options.city ?? 'Joliet',
      state: options.state ?? 'IL',
      zip: options.zip ?? '60433',
      lat: to.lat,
      lng: to.lng,
      geocodePrecision: options.precision ?? 'street',
      geocodeAccuracyMiles: 0.1,
      geocodedAt: new Date(),
      appointmentStartUtc: new Date(Date.now() + 6 * 3_600_000),
      appointmentEndUtc: new Date(Date.now() + 7 * 3_600_000),
      appointmentTz: 'America/Chicago',
      appointmentType: 'APPT',
      // §12.57. Paired in the database, so paired here: a fixture that set
      // only the timestamp is refused, which is the constraint doing its job.
      ...(options.arrived
        ? { arrivedAt: new Date(), arrivedSource: 'detected' as const }
        : {}),
    })
    .returning({ id: stops.id });

  return { truck, loadId: load!.id, stopId: stop!.id };
}

/** `count` routable lanes, each to a different destination. */
export async function makeRoutableLanes(tx: Tx, count: number) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    // Spread the destinations so each lane is its own corridor.
    out.push(
      await makeRoutableLane(tx, {
        to: { lat: 41.525 + i * 0.35, lng: -88.0817 - i * 0.4 },
        zip: String(60433 + i),
      }),
    );
  }
  return out;
}
