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
 * Both show the board's next stop and nothing else: the pickup while the
 * truck is at it, arrived or not; the delivery once the pickup is left. Its
 * place in the load ("stop 2 of 2") is stage 5, so it is pinned absent here.
 *
 * The map's Popup is a pass-through: it needs a live map, and only what the
 * popup puts inside it is being read.
 */
vi.mock('react-map-gl/mapbox', () => ({
  Popup: ({ children }: { children: ReactNode }) => children,
}));

const TZ = 'America/Chicago';
const config = { ...STATUS_DEFAULTS, dispatchTz: TZ };

async function twoStopTruck(tx: Tx) {
  const truck = await makeTruck(tx);
  await makePosition(tx, truck.id, {
    lat: 41.9006,
    lng: -87.8567,
    speedMph: 0,
    recordedAt: new Date(Date.now() - 60_000),
  });
  const [load] = await tx
    .insert(loads)
    .values({ truckId: truck.id, loadNumber: 'VT-TWO', status: 'DISPATCHED' })
    .returning({ id: loads.id });
  const [pickup] = await tx
    .insert(stops)
    .values({
      loadId: load!.id,
      type: 'PU',
      sequence: 1,
      addressLine: '1900 N 25th Ave',
      city: 'Melrose Park',
      state: 'IL',
      zip: '60160',
      lat: 41.9006,
      lng: -87.8567,
      geocodePrecision: 'street',
      appointmentStartUtc: new Date(Date.now() + 1 * 3_600_000),
      appointmentTz: TZ,
      appointmentType: 'APPT',
    })
    .returning({ id: stops.id });
  await tx.insert(stops).values({
    loadId: load!.id,
    type: 'DEL',
    sequence: 2,
    addressLine: '2 Test Dock',
    city: 'Joliet',
    state: 'IL',
    zip: '60431',
    lat: 41.525,
    lng: -88.0817,
    geocodePrecision: 'street',
    appointmentStartUtc: new Date(Date.now() + 8 * 3_600_000),
    appointmentTz: TZ,
    appointmentType: 'APPT',
  });
  return { truckId: truck.id, pickupId: pickup!.id };
}

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

describeDb('the popup and the sheet on a two-stop load (§12.119)', () => {
  it('name the pickup while the truck is at it, then the delivery once it is left', async () => {
    const seen = await rolledBack(async (tx) => {
      const lane = await twoStopTruck(tx);
      const ahead = await rowFor(tx, lane.truckId);

      await tx
        .update(stops)
        .set({ arrivedAt: new Date(Date.now() - 30 * 60_000), arrivedSource: 'detected' })
        .where(eq(stops.id, lane.pickupId));
      const atPickup = await rowFor(tx, lane.truckId);

      await tx
        .update(stops)
        .set({ departedAt: new Date(Date.now() - 2 * 60_000), departedSource: 'detected' })
        .where(eq(stops.id, lane.pickupId));
      const left = await rowFor(tx, lane.truckId);
      return { ahead, atPickup, left };
    });

    for (const row of [seen.ahead, seen.atPickup]) {
      for (const html of [popupText(row), sheetText(row)]) {
        expect(html).toContain('Pick up — 1900 N 25th Ave, Melrose Park, IL, 60160');
        expect(html).not.toContain('Joliet');
        expect(html).toContain('VT-TWO');
      }
    }
    expect(seen.atPickup.status).toBe('ARRIVED');

    for (const html of [popupText(seen.left), sheetText(seen.left)]) {
      expect(html).toContain('Deliver — 2 Test Dock, Joliet, IL, 60431');
      expect(html).not.toContain('Melrose Park');
      expect(html).toContain('VT-TWO');
      // One load, however many stops: no "open loads" count, and no
      // "stop 2 of 2" before stage 5 puts it there.
      expect(html).not.toMatch(/open loads/);
      expect(html).not.toMatch(/stop \d of \d/i);
    }
  });
});
