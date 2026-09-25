import type { FleetRow, NextStop } from '@/server/fleet-query';
import type { FleetHealth } from '@/server/health';

/**
 * An in-memory `FleetRow`, for tests that render a component rather than
 * query the database.
 *
 * The DB-backed builders in `./fleet.ts` are the right tool when the point is
 * what SQL returns. This is for the other half — a screen, given a row —
 * which was untestable until components could render at all (§12.37).
 *
 * Every field is defaulted to its quietest value so a test states only what it
 * is about. A row that has to spell out forty fields to assert one is a row
 * nobody writes a second test with.
 *
 * ## `nextStop` is merged, not replaced
 *
 * The obvious shape — one object of defaults with `...over` spread over it —
 * is wrong for a row that CONTAINS an object. `{ nextStop: { city: null } }`
 * spread over the defaults replaces the whole stop, so a test meaning "this
 * stop has no city" silently becomes "this stop has no address, no type, no
 * appointment and no coordinates either", and it passes for the wrong reason.
 *
 * That happened once, in `copy-text.test.ts`, where a local helper had done
 * its own spreading. The fix lives here instead of there: `nextStop` takes a
 * PARTIAL and is merged into the default stop, `null` means the truck holds
 * no load, and the type says both — so the next test to override a nested
 * field gets the merge without having to know the story.
 */

const TRUCK_ID = '11111111-1111-4111-8111-111111111111';

export type FleetRowOver = Partial<Omit<FleetRow, 'nextStop'>> & {
  /** Merged into the default stop. `null` means the truck holds no load. */
  nextStop?: Partial<NextStop> | null;
};

export function fleetRow(over: FleetRowOver = {}): FleetRow {
  const { nextStop: stopOver, ...rest } = over;
  return {
    id: TRUCK_ID,
    truckNumber: 137,
    samsaraName: 'Truck #137',
    driverName: 'Sam Driver',
    driverSource: 'samsara',
    driverSamsaraId: 'sam-1',
    lat: 41.8781,
    lng: -87.6298,
    heading: null,
    speedMph: 0,
    recordedAt: '2026-09-18T12:00:00.000Z',
    formattedLocation: '1 Broadway, Chicago, IL',
    cityState: 'Chicago, IL',
    active: true,
    status: 'ON_TIME',
    computed: 'ON_TIME',
    override: null,
    etaUtc: null,
    milesRemaining: null,
    etaPrecision: null,
    etaAccuracyMiles: null,
    distanceBasis: 'straight-line',
    laneRatio: null,
    snapMeters: null,
    routeMeasuredAtUtc: null,
    etaAbsence: 'no-appointment',
    lastComputedEtaUtc: null,
    deadlineUtc: null,
    upcoming: null,
    openLoadCount: 1,
    apptAt: null,
    ...rest,
    // After the spread, so `rest` cannot carry a `nextStop` past the merge.
    nextStop: stopOver === null ? null : nextStop(stopOver),
  };
}

export function nextStop(over: Partial<NextStop> = {}): NextStop {
  return {
    stopId: '22222222-2222-4222-8222-222222222222',
    loadId: '33333333-3333-4333-8333-333333333333',
    loadNumber: 'LD-4417',
    loadStatus: 'DISPATCHED',
    type: 'DEL',
    addressLine: '1 Broadway',
    city: 'Chicago',
    state: 'IL',
    zip: '60601',
    apptStartUtc: null,
    ...over,
  } as NextStop;
}

/**
 * §14 feature 8's totals, quiet by default — a day with nothing done and
 * nothing due, so a test that is not about the strip does not have to say
 * anything about it.
 */
export function fleetHealth(over: Partial<FleetHealth> = {}): FleetHealth {
  return { day: '2026-09-18', onTime: 0, late: 0, unscheduled: 0, remaining: 0, ...over };
}
