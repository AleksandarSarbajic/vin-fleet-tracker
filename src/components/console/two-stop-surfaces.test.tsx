import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { loads, stops } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import { makePosition, makeTruck } from '@/test/fleet';
import { STATUS_DEFAULTS } from '@/lib/status';
import { LATEST_POSITION_SQL, applyStatus, parseFleetRows, type FleetRow } from '@/server/fleet-query';
import type { Tx } from '@/server/audit';
import { MapPopup } from './map/MapPopup';
import { TruckSheet } from './phone/TruckSheet';

/**
 * §12.119. The map popup and the phone's truck sheet for a truck on a load of
 * two stops, from the board's REAL row — the query, not a hand-made fixture.
 * Both show the board's next stop: the pickup while the truck is at it,
 * arrived or not; the delivery once the pickup is left. Stage 5 adds the
 * stop's place in its load to the load line — "VT-TWO · stop 2 of 3" — and
 * nothing at all for a one-stop load, whose line reads as it always has.
 *
 * The map's Popup is a pass-through: it needs a live map, and only what the
 * popup puts inside it is being read.
 */
vi.mock('react-map-gl/mapbox', () => ({
  Popup: ({ children }: { children: ReactNode }) => children,
}));

const TZ = 'America/Chicago';
const config = { ...STATUS_DEFAULTS, dispatchTz: TZ };

const PLACES = [
  { type: 'PU' as const, addressLine: '1900 N 25th Ave', city: 'Melrose Park', zip: '60160', lat: 41.9006, lng: -87.8567 },
  { type: 'DEL' as const, addressLine: '2 Test Dock', city: 'Joliet', zip: '60431', lat: 41.525, lng: -88.0817 },
  { type: 'DEL' as const, addressLine: '3 Test Dock', city: 'Aurora', zip: '60502', lat: 41.7606, lng: -88.3201 },
];

/** A truck parked at the first stop, on one open load of the first `count` PLACES. */
async function truckWithStops(tx: Tx, count: number, loadNumber: string) {
  const truck = await makeTruck(tx);
  await makePosition(tx, truck.id, {
    lat: PLACES[0]!.lat,
    lng: PLACES[0]!.lng,
    speedMph: 0,
    recordedAt: new Date(Date.now() - 60_000),
  });
  const [load] = await tx
    .insert(loads)
    .values({ truckId: truck.id, loadNumber, status: 'DISPATCHED' })
    .returning({ id: loads.id });
  const ids: string[] = [];
  for (const [i, p] of PLACES.slice(0, count).entries()) {
    const [row] = await tx
      .insert(stops)
      .values({
        loadId: load!.id,
        type: p.type,
        sequence: i + 1,
        addressLine: p.addressLine,
        city: p.city,
        state: 'IL',
        zip: p.zip,
        lat: p.lat,
        lng: p.lng,
        geocodePrecision: 'street',
        appointmentStartUtc: new Date(Date.now() + (1 + i * 7) * 3_600_000),
        appointmentTz: TZ,
        appointmentType: 'APPT',
      })
      .returning({ id: stops.id });
    ids.push(row!.id);
  }
  return { truckId: truck.id, stopIds: ids };
}

const leave = (tx: Tx, stopId: string) =>
  tx
    .update(stops)
    .set({
      arrivedAt: new Date(Date.now() - 30 * 60_000),
      arrivedSource: 'detected',
      departedAt: new Date(Date.now() - 2 * 60_000),
      departedSource: 'detected',
    })
    .where(eq(stops.id, stopId));

async function rowFor(tx: Tx, truckId: string): Promise<FleetRow> {
  const rows = applyStatus(parseFleetRows(await tx.execute(LATEST_POSITION_SQL)), config, new Date());
  return rows.find((r) => r.id === truckId)!;
}

const popupText = (row: FleetRow) =>
  renderToStaticMarkup(
    <MapPopup row={row} fetchedAt={new Date().toISOString()} onEdit={() => {}} onTimeline={() => {}} onClose={() => {}} />,
  );
const sheetText = (row: FleetRow) =>
  renderToStaticMarkup(
    <TruckSheet
      row={row}
      fetchedAt={new Date().toISOString()}
      feedStale={false}
      tel={null}
      onClose={() => {}}
      onTimeline={() => {}}
      onShowOnMap={() => {}}
    />,
  );

describeDb('the popup and the sheet on a load of several stops (§12.119)', () => {
  it('name the pickup while the truck is at it, then the delivery once it is left — stop 1 of 2, stop 2 of 2', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await truckWithStops(tx, 2, 'VT-TWO');
      const ahead = await rowFor(tx, lane.truckId);

      await tx
        .update(stops)
        .set({ arrivedAt: new Date(Date.now() - 30 * 60_000), arrivedSource: 'detected' })
        .where(eq(stops.id, lane.stopIds[0]!));
      const atPickup = await rowFor(tx, lane.truckId);

      await leave(tx, lane.stopIds[0]!);
      const left = await rowFor(tx, lane.truckId);
      return { ahead, atPickup, left };
    });

    for (const row of [seen.ahead, seen.atPickup]) {
      for (const html of [popupText(row), sheetText(row)]) {
        expect(html).toContain('Pick up — 1900 N 25th Ave, Melrose Park, IL, 60160');
        expect(html).not.toContain('Joliet');
        expect(html).toContain('VT-TWO · stop 1 of 2');
      }
    }
    expect(seen.atPickup.status).toBe('ARRIVED');

    for (const html of [popupText(seen.left), sheetText(seen.left)]) {
      expect(html).toContain('Deliver — 2 Test Dock, Joliet, IL, 60431');
      expect(html).not.toContain('Melrose Park');
      expect(html).toContain('VT-TWO · stop 2 of 2');
      // One load, however many stops: no "open loads" count.
      expect(html).not.toMatch(/open loads/);
    }
  });

  it('count a three-stop load: stop 2 of 3 once the pickup is left', async () => {
    const row = await rolledBack(async (tx) => {
      const lane = await truckWithStops(tx, 3, 'VT-THREE');
      await leave(tx, lane.stopIds[0]!);
      return rowFor(tx, lane.truckId);
    });
    for (const html of [popupText(row), sheetText(row)]) {
      expect(html).toContain('Deliver — 2 Test Dock, Joliet, IL, 60431');
      expect(html).toContain('VT-THREE · stop 2 of 3');
    }
  });

  it('leave a one-stop load’s line as it was: the number alone, no "of"', async () => {
    const row = await rolledBack(async (tx) => {
      const lane = await truckWithStops(tx, 1, 'VT-ONE');
      return rowFor(tx, lane.truckId);
    });
    expect(row.nextStop).toMatchObject({ stopNumber: 1, loadStopCount: 1 });
    // The load line's whole text, in the markup each one renders.
    expect(popupText(row)).toMatch(/>Load<\/(dt|span|div)>.*?>VT-ONE<\/(dd|span|div)>/s);
    expect(sheetText(row)).toMatch(/data-sheet-field="load"[^>]*>VT-ONE<\/dd>/);
    for (const html of [popupText(row), sheetText(row)]) {
      expect(html).not.toMatch(/stop \d of \d/);
    }
  });
});
