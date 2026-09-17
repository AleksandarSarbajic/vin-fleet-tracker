import { eq, sql } from 'drizzle-orm';
import { loads, stops, trucks } from '@/db/schema';
import type { StopEdit } from '@/lib/stop-edit';
import { resolveAppointment, type ResolvedAppointment } from './appointment';
import { writeAudit, type AuditEntry, type Db } from './audit';
import { applyReassignment, type ReassignPreview } from './reassign';

/**
 * The edit modal's write path (§9.9).
 *
 * One transaction covers the load, the stop, the appointment and the
 * assignment, because they are one act: a dispatcher typing a rate
 * confirmation into the screen. A half-applied version of that is a truck
 * with a delivery time and no driver, or a driver on a load that was never
 * saved.
 */

export interface StopEditResult {
  stopId: string;
  loadId: string;
  appointment: ResolvedAppointment | null;
  reassignment: ReassignPreview | null;
}

export class StopEditError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = 'StopEditError';
  }
}

export async function saveStopEdit(
  db: Db,
  input: { actorUserId: string | null; edit: StopEdit },
): Promise<StopEditResult> {
  const { edit } = input;

  return db.transaction(async (tx) => {
    /* -------------------------- the assignment ------------------------- */

    let reassignment: ReassignPreview | null = null;
    if (edit.driverId !== undefined) {
      const applied = await applyReassignment(tx, {
        truckId: edit.truckId,
        driverId: edit.driverId,
        actorUserId: input.actorUserId,
        previewToken: edit.previewToken,
      });
      if (applied.changed) {
        reassignment = applied.preview;
        /**
         * §9.10: one transaction, ONE audit entry for the move, carrying both
         * sides. The stop's own changes get their own entry below — they are
         * a different edit that happened to share a save.
         */
        await writeAudit(tx, {
          actorUserId: input.actorUserId,
          entity: 'assignment',
          entityId: edit.truckId,
          before: {
            gaining: {
              truckId: applied.preview.gaining.truckId,
              driverId: applied.preview.gaining.driverId,
              driverName: applied.preview.gaining.driverName,
            },
            losing: applied.preview.losing
              ? {
                  truckId: applied.preview.losing.truckId,
                  driverId: applied.preview.losing.driverId,
                  driverName: applied.preview.losing.driverName,
                }
              : null,
          },
          after: {
            gaining: {
              truckId: applied.preview.gaining.truckId,
              driverId: applied.preview.gaining.toDriverId,
              driverName: applied.preview.gaining.toDriverName,
            },
            losing: applied.preview.losing
              ? { truckId: applied.preview.losing.truckId, driverId: null, driverName: null }
              : null,
            source: 'edit-modal',
          },
        });
      }
    }

    /* -------------------------- the appointment ------------------------ */

    // Converted here, from wall time + zone. The client never sends an
    // instant, and this throws AppointmentTimeError on an hour that does not
    // exist at that facility.
    const appointment = edit.appointment
      ? await resolveAppointment(tx, edit.appointment)
      : null;

    /* -------------------------- the load and stop ---------------------- */

    const existing = edit.stopId
      ? (
          await tx
            .select({
              stopId: stops.id,
              loadId: loads.id,
              loadNumber: loads.loadNumber,
              loadStatus: loads.status,
              stopType: stops.type,
              addressLine: stops.addressLine,
              city: stops.city,
              state: stops.state,
              zip: stops.zip,
              appointmentStartUtc: stops.appointmentStartUtc,
              appointmentTz: stops.appointmentTz,
              dispatcherNote: stops.dispatcherNote,
            })
            .from(stops)
            .innerJoin(loads, eq(loads.id, stops.loadId))
            .where(eq(stops.id, edit.stopId))
            .limit(1)
        )[0]
      : undefined;

    if (edit.stopId && !existing) {
      throw new StopEditError('That stop no longer exists.', 'stopId');
    }

    const appointmentColumns = {
      appointmentStartUtc: appointment ? sql`${appointment.startUtc}::timestamptz` : null,
      appointmentEndUtc: appointment?.endUtc ? sql`${appointment.endUtc}::timestamptz` : null,
      appointmentTz: appointment?.tz ?? null,
      appointmentType: edit.appointment?.type ?? ('APPT' as const),
    };

    let loadId: string;
    let stopId: string;

    if (existing) {
      loadId = existing.loadId;
      stopId = existing.stopId;
      await tx
        .update(loads)
        .set({
          loadNumber: edit.loadNumber,
          status: edit.loadStatus,
          truckId: edit.truckId,
        })
        .where(eq(loads.id, loadId));
      await tx
        .update(stops)
        .set({
          type: edit.stopType,
          addressLine: edit.addressLine,
          city: edit.city,
          state: edit.state,
          zip: edit.zip,
          dispatcherNote: edit.dispatcherNote,
          noteBy: edit.dispatcherNote ? input.actorUserId : null,
          noteAt: edit.dispatcherNote ? sql`now()` : null,
          ...appointmentColumns,
        })
        .where(eq(stops.id, stopId));
    } else {
      // "New load" state — same fields, same validation, same conversion.
      // A separate creation flow would be a second place for the appointment
      // path to go wrong.
      const [load] = await tx
        .insert(loads)
        .values({
          truckId: edit.truckId,
          loadNumber: edit.loadNumber,
          status: edit.loadStatus,
        })
        .returning({ id: loads.id });
      loadId = load!.id;

      const [stop] = await tx
        .insert(stops)
        .values({
          loadId,
          type: edit.stopType,
          sequence: 1,
          addressLine: edit.addressLine,
          city: edit.city,
          state: edit.state,
          zip: edit.zip,
          dispatcherNote: edit.dispatcherNote,
          noteBy: edit.dispatcherNote ? input.actorUserId : null,
          noteAt: edit.dispatcherNote ? sql`now()` : null,
          ...appointmentColumns,
        })
        .returning({ id: stops.id });
      stopId = stop!.id;
    }

    /* ------------------------------ audit ------------------------------ */

    const entry: AuditEntry = {
      actorUserId: input.actorUserId,
      entity: 'stop',
      entityId: stopId,
      before: existing
        ? {
            loadNumber: existing.loadNumber,
            loadStatus: existing.loadStatus,
            stopType: existing.stopType,
            addressLine: existing.addressLine,
            city: existing.city,
            state: existing.state,
            zip: existing.zip,
            // Stored as an instant; logged as one, with the zone beside it.
            appointmentStartUtc: existing.appointmentStartUtc?.toISOString() ?? null,
            appointmentTz: existing.appointmentTz,
            dispatcherNote: existing.dispatcherNote,
          }
        : null,
      after: {
        truckId: edit.truckId,
        loadId,
        loadNumber: edit.loadNumber,
        loadStatus: edit.loadStatus,
        stopType: edit.stopType,
        addressLine: edit.addressLine,
        city: edit.city,
        state: edit.state,
        zip: edit.zip,
        appointmentStartUtc: appointment?.startUtc ?? null,
        appointmentTz: appointment?.tz ?? null,
        /** Kept: on the fall-back date this says which 01:30 was stored. */
        appointmentResolution: appointment?.resolution ?? null,
        dispatcherNote: edit.dispatcherNote,
        source: 'edit-modal',
      },
    };
    await writeAudit(tx, entry);

    return { stopId, loadId, appointment, reassignment };
  });
}

/** Only an admin may flip this, and only from the edit modal (§12.14). */
export async function setTruckActive(
  db: Db,
  input: { actorUserId: string | null; truckId: string; active: boolean },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ active: trucks.active })
      .from(trucks)
      .where(eq(trucks.id, input.truckId))
      .limit(1);
    if (!before || before.active === input.active) return;

    await tx.update(trucks).set({ active: input.active }).where(eq(trucks.id, input.truckId));
    await writeAudit(tx, {
      actorUserId: input.actorUserId,
      entity: 'truck',
      entityId: input.truckId,
      before: { active: before.active },
      after: { active: input.active, source: 'edit-modal' },
    });
  });
}
