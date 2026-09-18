import type { FleetRow, NextStop } from '@/server/fleet-query';

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
 */

const TRUCK_ID = '11111111-1111-4111-8111-111111111111';

export function fleetRow(over: Partial<FleetRow> = {}): FleetRow {
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
    nextStop: nextStop(),
    openLoadCount: 1,
    apptAt: null,
    ...over,
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
