import { eq, sql } from 'drizzle-orm';
import { loads, stops, trucks } from '@/db/schema';
import { normalizeAddress, type AddressParts } from '@/lib/address';
import type { StopEdit } from '@/lib/stop-edit';
import { resolveAppointment, type ResolvedAppointment } from './appointment';
import { writeAudit, type AuditEntry, type Db } from './audit';
import { geocodeAddress, MISS_MESSAGE, type GeocodeOutcome } from './geocode';
import { clearOverride, setOverride } from './override';
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

export interface SaveWarning {
  field: string;
  message: string;
}

export interface StopEditResult {
  stopId: string;
  loadId: string;
  appointment: ResolvedAppointment | null;
  reassignment: ReassignPreview | null;
  /**
   * Things that went wrong without failing the save. Today that is only a
   * geocode that could not place the address (§12.24): the stop is saved and
   * correct, it simply has no ETA. The modal shows these as WARNINGS — an
   * error would imply the dispatcher's work was lost, and it was not.
   */
  warnings: SaveWarning[];
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
  input: {
    actorUserId: string | null;
    edit: StopEdit;
    /** For the override's CUSTOM expiry and END_OF_DAY — see server/override.ts. */
    dispatchTz: string;
    /** Injected by the tests; production uses the real network. */
    fetchImpl?: typeof fetch;
  },
): Promise<StopEditResult> {
  const { edit } = input;
  const warnings: SaveWarning[] = [];

  const typed: AddressParts = {
    addressLine: edit.addressLine,
    city: edit.city,
    state: edit.state,
    zip: edit.zip,
  };

  /* --------------------------- the geocode --------------------------- */

  /**
   * BEFORE the transaction, deliberately.
   *
   * An HTTP round trip inside an open transaction holds a pooler connection
   * for as long as the vendor takes to answer — which is how a slow third
   * party turns into "the app is down". Nothing here is less atomic for it:
   * the save still lands with the coordinates it resolved or does not land
   * at all. The only cost of a rolled-back save is a geocode we already
   * cached.
   *
   * The pre-read decides whether to SPEND a call, nothing more. If it races
   * with another edit the worst case is a wasted call, or the stale-address
   * branch below, which refuses to keep coordinates that no longer describe
   * the address being written.
   */
  const previousAddress = edit.stopId ? await readAddress(db, edit.stopId) : null;
  const addressChanged =
    previousAddress === null || normalizeAddress(previousAddress) !== normalizeAddress(typed);

  let geocode: GeocodeOutcome | null = null;
  if (addressChanged) {
    geocode = await geocodeAddress(db, typed, {
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    });
    if (!geocode.ok && geocode.reason !== 'empty-address') {
      const named =
        geocode.unmatched.length > 0
          ? ` Could not match ${geocode.unmatched.join(' or ')}.`
          : '';
      warnings.push({
        field: 'addressLine',
        message: `${MISS_MESSAGE[geocode.reason]}${named}`,
      });
    }
  }

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

    /**
     * §12.23 — an edit writes only the fields the form owns. Coordinates are
     * not a form field, but they are DERIVED from four that are, in the same
     * save, from the same input, so writing them here is the rule working
     * rather than an exception to it. What the rule does forbid is touching
     * them when the address did not change, which is the middle branch.
     */
    const geocodeColumns = geocode
      ? geocode.ok
        ? {
            lat: geocode.lat,
            lng: geocode.lng,
            geocodePrecision: geocode.precision,
            geocodeConfidence: geocode.confidence,
            geocodedAddress: geocode.matchedAddress,
            geocodedAt: sql`now()`,
          }
        : {
            // Located once, not located now. Keeping the old coordinates
            // would project an ETA to the PREVIOUS address, which is the
            // confident wrong number the cutoff exists to refuse.
            lat: null,
            lng: null,
            geocodePrecision: null,
            geocodeConfidence: null,
            geocodedAddress: null,
            geocodedAt: null,
          }
      : existingAddressStillMatches(existing, typed)
        ? {}
        : {
            // The address moved under us between the pre-read and here.
            lat: null,
            lng: null,
            geocodePrecision: null,
            geocodeConfidence: null,
            geocodedAddress: null,
            geocodedAt: null,
          };

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
          ...geocodeColumns,
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
          ...geocodeColumns,
          ...appointmentColumns,
        })
        .returning({ id: stops.id });
      stopId = stop!.id;
    }

    /* ---------------------------- the override -------------------------- */

    /**
     * §12.28. INSIDE the same transaction, using the stopId this save just
     * resolved — which on a new load did not exist when the request was sent.
     *
     * It was two requests to two routes. A dispatcher who moved an
     * appointment and forced a status could get one and not the other, and
     * the error explaining it was on a screen nobody would be looking at when
     * the next shift read the row at 4am. Both writes or neither.
     *
     * setOverride/clearOverride open transactions of their own; nested here
     * they become savepoints, so their failure rolls back this save too.
     */
    if (edit.override) {
      if (edit.override.action === 'clear') {
        await clearOverride(tx, { actorUserId: input.actorUserId, clear: { stopId } });
      } else {
        const { action: _action, ...fields } = edit.override;
        await setOverride(tx, {
          actorUserId: input.actorUserId,
          dispatchTz: input.dispatchTz,
          override: { stopId, ...fields },
        });
      }
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
        /**
         * What the geocoder did, or that it was not asked. An ETA a
         * dispatcher disputes is answerable from here: which address was
         * matched, how confidently, and whether this save even looked.
         */
        geocode: geocode
          ? geocode.ok
            ? {
                lat: geocode.lat,
                lng: geocode.lng,
                precision: geocode.precision,
                confidence: geocode.confidence,
                matched: geocode.matchedAddress,
              }
            : { missed: geocode.reason, unmatched: geocode.unmatched }
          : 'address unchanged — not re-geocoded',
        /** Kept: on the fall-back date this says which 01:30 was stored. */
        appointmentResolution: appointment?.resolution ?? null,
        dispatcherNote: edit.dispatcherNote,
        source: 'edit-modal',
      },
    };
    await writeAudit(tx, entry);

    return { stopId, loadId, appointment, reassignment, warnings };
  });
}

/** The address as stored, for the "did it actually change?" test. */
async function readAddress(db: Db, stopId: string): Promise<AddressParts | null> {
  const [row] = await db
    .select({
      addressLine: stops.addressLine,
      city: stops.city,
      state: stops.state,
      zip: stops.zip,
    })
    .from(stops)
    .where(eq(stops.id, stopId))
    .limit(1);
  return row ?? null;
}

function existingAddressStillMatches(
  existing: { addressLine: string | null; city: string | null; state: string | null; zip: string | null } | undefined,
  typed: AddressParts,
): boolean {
  if (!existing) return false;
  return normalizeAddress(existing) === normalizeAddress(typed);
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
