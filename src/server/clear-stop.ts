import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { loads, stops } from '@/db/schema';
import type { ClearStopRequest } from '@/lib/clear-stop';
import { isTerminal, LOAD_STATUS_LABEL } from '@/lib/loads';
import { ANCHOR_CLEARED } from './arrival-columns';
import { writeAudit, type Db, type Writer } from './audit';

/**
 * §12.88 — Clear stop. One transaction: the load closes, its stops' arrival
 * anchors go, and the audit row is written, or none of it happens.
 *
 * What it does NOT touch, each for a reason:
 *
 *   - `arrived_at`, `departed_at`, `arrived_source`: the delivery record. The
 *     timeline shows them and the day's on-time count is made of them.
 *   - The address, the coordinates and `geocode_cache`: nothing here writes an
 *     address, so nothing is re-geocoded. A correct address the geocoder once
 *     refused a street match for (§12.76, `refused_match`) stays exactly as
 *     it was.
 *   - The driver assignment, `trucks.active`, earlier audit rows.
 *
 * Everything that makes the row read "no load" follows from the status
 * alone: every next-stop query skips a closed load's stops (§12.13).
 */

export class ClearStopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClearStopError';
  }
}

export interface ClearStopResult {
  loadId: string;
  status: ClearStopRequest['status'];
  /** How many of its stops carried an anchor that this removed. */
  anchorsCleared: number;
}

export async function clearStop(
  db: Db | Writer,
  input: { actorUserId: string | null; request: ClearStopRequest },
): Promise<ClearStopResult> {
  const { truckId, loadId, status } = input.request;

  return db.transaction(async (tx) => {
    // Locked, so a second dispatcher's Clear stop on the same load waits for
    // this one and then finds it closed, rather than closing it twice.
    const [load] = await tx
      .select({
        truckId: loads.truckId,
        loadNumber: loads.loadNumber,
        status: loads.status,
      })
      .from(loads)
      .where(eq(loads.id, loadId))
      .for('update')
      .limit(1);

    if (!load)
      throw new ClearStopError('That load no longer exists. Nothing was changed.');
    if (load.truckId !== truckId) {
      throw new ClearStopError(
        'That load is no longer on this truck. Nothing was changed — reopen the truck and try again.',
      );
    }
    if (isTerminal(load.status)) {
      throw new ClearStopError(
        `That load is already ${LOAD_STATUS_LABEL[load.status]}. Nothing was changed.`,
      );
    }

    const before = await tx
      .select({
        stopId: stops.id,
        sequence: stops.sequence,
        type: stops.type,
        city: stops.city,
        state: stops.state,
        arrivedAt: stops.arrivedAt,
        arrivedSource: stops.arrivedSource,
        departedAt: stops.departedAt,
        arrivalAnchorLat: stops.arrivalAnchorLat,
        arrivalAnchorLng: stops.arrivalAnchorLng,
        arrivalAnchorAt: stops.arrivalAnchorAt,
      })
      .from(stops)
      .where(eq(stops.loadId, loadId))
      .orderBy(asc(stops.sequence));

    await tx.update(loads).set({ status }).where(eq(loads.id, loadId));

    const cleared = await tx
      .update(stops)
      .set(ANCHOR_CLEARED)
      .where(and(eq(stops.loadId, loadId), isNotNull(stops.arrivalAnchorAt)))
      .returning({ id: stops.id });

    await writeAudit(tx, {
      actorUserId: input.actorUserId,
      entity: 'load',
      entityId: loadId,
      before: {
        truckId,
        loadNumber: load.loadNumber,
        loadStatus: load.status,
        stops: before.map((s) => ({
          stopId: s.stopId,
          sequence: s.sequence,
          type: s.type,
          city: s.city,
          state: s.state,
          arrivedAt: s.arrivedAt?.toISOString() ?? null,
          arrivedSource: s.arrivedSource,
          departedAt: s.departedAt?.toISOString() ?? null,
          arrivalAnchor:
            s.arrivalAnchorAt === null
              ? null
              : {
                  lat: s.arrivalAnchorLat,
                  lng: s.arrivalAnchorLng,
                  recordedAtUtc: s.arrivalAnchorAt.toISOString(),
                },
        })),
      },
      after: {
        truckId,
        loadStatus: status,
        anchorsCleared: cleared.map((r) => r.id),
        source: 'operator-clear-stop',
      },
    });

    return { loadId, status, anchorsCleared: cleared.length };
  });
}
