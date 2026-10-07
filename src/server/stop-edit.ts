import { randomUUID } from 'node:crypto';
import { asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { loads, positions, stopRoutes, stops, trucks } from '@/db/schema';
import { normalizeAddress, type AddressParts } from '@/lib/address';
import { AppointmentTimeError } from '@/lib/appointment';
import { zoneAbbreviation } from '@/lib/format';
import { ANCHOR_MAX_AGE_MINUTES, anchorAtTick, type AnchorDecision } from '@/lib/arrival';
import { MAX_STOPS_PER_LOAD, type LoadEdit, type StopDraft } from '@/lib/load-edit';
import type { LoadStatus } from '@/lib/loads';
import { needsReachedAnswer } from '@/lib/reached-stop';
import { resolveAppointment, resolveWallTime, type ResolvedAppointment } from './appointment';
import { ARRIVAL_CLEARED } from './arrival-columns';
import { clearStop } from './clear-stop';
import { writeAudit, type AuditEntry, type Db, type Tx } from './audit';
import { fallbackWarning, geocodeAddress, MISS_MESSAGE, type GeocodeOutcome } from './geocode';
import { readLoadVersion } from './load-version';
import { BOARD_NEXT_STOP } from './next-stop';
import { clearOverride, setOverride } from './override';
import { applyReassignment, type ReassignPreview } from './reassign';

/**
 * The edit modal's write path (§9.9, §12.117).
 *
 * One transaction covers the load, its stops, their appointments and the
 * assignment, because they are one act: a dispatcher typing a rate
 * confirmation into the screen. A half-applied version of that is a truck
 * with a delivery time and no driver, or a driver on a load that was never
 * saved — or, with several stops, a pickup saved and its delivery not.
 *
 * §12.117. The request is a LOAD and the stops it writes (`lib/load-edit.ts`).
 * Each stop goes through `writeStop`, which is the single-stop save this used
 * to be, rule for rule. Around it, under a lock on the load and its stops:
 * the version check, the order and count of stops, removals, and the rules
 * that belong to a load rather than a stop.
 */

export interface SaveWarning {
  field: string;
  message: string;
}

export interface SavedStop {
  stopId: string;
  appointment: ResolvedAppointment | null;
}

export interface LoadEditResult {
  /** Shared by every audit row this save wrote (§12.117). */
  saveId: string;
  loadId: string;
  /** In the order the request named them. */
  stops: SavedStop[];
  reassignment: ReassignPreview | null;
  /**
   * Things that went wrong without failing the save — a geocode that could
   * not place an address (§12.24), an arrival with no anchor (§12.85). The
   * modal shows these as WARNINGS: an error would imply the dispatcher's work
   * was lost, and it was not. A stop's warning is named `stops.<i>.<field>`.
   */
  warnings: SaveWarning[];
}

/**
 * §12.57. How far ahead of our clock a hand-entered arrival may be before it
 * is refused. Five minutes, sized by what it is protecting against: an
 * unsynchronised browser clock, not a dispatcher predicting an arrival.
 */
const FUTURE_ARRIVAL_TOLERANCE_MS = 5 * 60_000;

/**
 * A reached stop was saved with a new city or load number, and the save did
 * not say whether that is a correction or the next trip. Nothing is written;
 * the modal asks, with the arrival this carries — the one the SERVER holds,
 * which may be newer than the modal's own copy.
 */
export class ReachedStopError extends Error {
  constructor(readonly arrivedAt: string) {
    super('This stop has been reached. Say whether this is a correction or the next trip.');
    this.name = 'ReachedStopError';
  }
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

/** §12.116 D4. A stop the truck has left keeps where and when it was. */
const LEFT_STOP_LOCKED =
  'The truck has left this stop, so its address, type and appointment stay as recorded. Nothing was saved.';

/** §12.117. Said word for word by the modal, which keeps what was typed. */
export const STALE_LOAD_MESSAGE = 'This load was changed since you opened it. Nothing was saved.';

/**
 * The load is not the one the modal opened: its version under the lock is
 * not the version the save names. Nothing is written and nothing is merged —
 * the dispatcher reloads and sees what changed.
 */
export class StaleLoadError extends Error {
  constructor() {
    super(STALE_LOAD_MESSAGE);
    this.name = 'StaleLoadError';
  }
}

/**
 * An error about ONE stop of the save, saying which. The route names the
 * field `stops.<i>.<field>`, so it lands under that stop's input.
 */
export class AtStopError extends Error {
  constructor(
    readonly stopIndex: number,
    readonly error: StopEditError | AppointmentTimeError,
  ) {
    super(error.message);
    this.name = 'AtStopError';
  }

  get field(): string {
    return `stops.${this.stopIndex}.${this.error.field}`;
  }
}

/** The columns of a stored stop that the save reads, and the audit records. */
const STORED_STOP = {
  stopId: stops.id,
  sequence: stops.sequence,
  stopType: stops.type,
  addressLine: stops.addressLine,
  city: stops.city,
  state: stops.state,
  zip: stops.zip,
  appointmentStartUtc: stops.appointmentStartUtc,
  appointmentEndUtc: stops.appointmentEndUtc,
  appointmentType: stops.appointmentType,
  appointmentTz: stops.appointmentTz,
  dispatcherNote: stops.dispatcherNote,
  arrivedAt: stops.arrivedAt,
  arrivedSource: stops.arrivedSource,
  departedAt: stops.departedAt,
  departedSource: stops.departedSource,
  lat: stops.lat,
  lng: stops.lng,
  geocodePrecision: stops.geocodePrecision,
  geocodeAccuracyMiles: stops.geocodeAccuracyMiles,
  arrivalAnchorAt: stops.arrivalAnchorAt,
};

/** Every stop of a load, in sequence order, locked for the rest of the save. */
async function selectStops(tx: Tx, loadId: string) {
  return tx
    .select(STORED_STOP)
    .from(stops)
    .where(eq(stops.loadId, loadId))
    .orderBy(asc(stops.sequence))
    .for('update');
}

type StoredStop = Awaited<ReturnType<typeof selectStops>>[number];

interface StoredLoad {
  loadId: string;
  loadNumber: string | null;
  loadStatus: LoadStatus;
}

/** A stop as the audit log has always recorded it, before the save. */
function stopBefore(load: StoredLoad, s: StoredStop): Record<string, unknown> {
  return {
    loadNumber: load.loadNumber,
    loadStatus: load.loadStatus,
    stopType: s.stopType,
    addressLine: s.addressLine,
    city: s.city,
    state: s.state,
    zip: s.zip,
    // Stored as an instant; logged as one, with the zone beside it.
    appointmentStartUtc: s.appointmentStartUtc?.toISOString() ?? null,
    appointmentEndUtc: s.appointmentEndUtc?.toISOString() ?? null,
    appointmentType: s.appointmentType,
    appointmentTz: s.appointmentTz,
    dispatcherNote: s.dispatcherNote,
    arrivedAt: s.arrivedAt?.toISOString() ?? null,
    arrivedSource: s.arrivedSource,
    departedAt: s.departedAt?.toISOString() ?? null,
    departedSource: s.departedSource,
    arrivalAnchorAt: s.arrivalAnchorAt?.toISOString() ?? null,
  };
}

const addressOf = (draft: StopDraft): AddressParts => ({
  addressLine: draft.addressLine,
  city: draft.city,
  state: draft.state,
  zip: draft.zip,
});

export async function saveLoadEdit(
  db: Db,
  input: {
    actorUserId: string | null;
    edit: LoadEdit;
    /** For the override's CUSTOM expiry and END_OF_DAY — see server/override.ts. */
    dispatchTz: string;
    /** Injected by the tests; production uses the real network. */
    fetchImpl?: typeof fetch;
  },
): Promise<LoadEditResult> {
  const { edit } = input;
  const warnings: SaveWarning[] = [];
  const saveId = randomUUID();
  const removedIds = edit.removedStopIds ?? [];

  // §12.92. Closing previous loads belongs to creating a new one. On an edit
  // of an existing load it is refused, never quietly ignored.
  if (edit.loadId && edit.closePrevious?.length) {
    throw new StopEditError(
      'Previous loads are only closed when a new load is saved. Nothing was changed.',
      'closePrevious',
    );
  }

  /**
   * The dispatcher said this is the NEXT TRIP, not a correction: the stop
   * being edited keeps its record, its load closes as Delivered, and the save
   * becomes a new load. Everything below treats it as one from here on —
   * including the geocode, because the new stop needs coordinates of its own
   * even when the address did not change.
   *
   * §12.117. The next trip is ONE stop — the reached one, retyped — so a
   * request that names more, or removes any, is not one.
   */
  const isNextTrip = edit.loadId !== null && edit.reachedStop === 'next-trip';
  if (isNextTrip && (edit.stops.length !== 1 || edit.stops[0]!.stopId === null || removedIds.length > 0)) {
    throw new StopEditError(
      'The next trip is entered as the one stop that was reached. Nothing was changed.',
      '*',
    );
  }

  /* --------------------------- the geocode --------------------------- */

  /**
   * BEFORE the transaction, deliberately, one stop after another.
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
   * branch in `writeStop`, which refuses to keep coordinates that no longer
   * describe the address being written.
   */
  const located: { geocode: GeocodeOutcome | null; addressChanged: boolean }[] = [];
  for (const [i, draft] of edit.stops.entries()) {
    const typed = addressOf(draft);
    const previousAddress =
      draft.stopId && !isNextTrip ? await readAddress(db, draft.stopId) : null;
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
          field: `stops.${i}.addressLine`,
          message: `${MISS_MESSAGE[geocode.reason]}${named}`,
        });
      }
      // §12.76. Located, but not at the address typed — still said out loud.
      const loosely = geocode.ok ? fallbackWarning(geocode) : null;
      if (loosely) warnings.push({ field: `stops.${i}.addressLine`, message: loosely });
    }
    located.push({ geocode, addressChanged });
  }

  return db.transaction(async (tx) => {
    /* ----------------------- the load, locked ----------------------- */

    let load: StoredLoad | undefined;
    let stored: StoredStop[] = [];
    if (edit.loadId) {
      /**
       * §12.117. The load row and every one of its stops, locked for the
       * rest of the save. A second dispatcher's save of the same load waits
       * here, then finds a different version and is refused.
       */
      [load] = await tx
        .select({ loadId: loads.id, loadNumber: loads.loadNumber, loadStatus: loads.status })
        .from(loads)
        .where(eq(loads.id, edit.loadId))
        .for('update')
        .limit(1);
      if (!load) throw new StopEditError('That load no longer exists. Nothing was saved.', '*');
      stored = await selectStops(tx, load.loadId);

      if ((await readLoadVersion(tx, load.loadId)) !== edit.version) throw new StaleLoadError();
    }
    const byId = new Map(stored.map((s) => [s.stopId, s]));

    if (load) checkStops(edit, stored, byId, removedIds, isNextTrip);

    /**
     * §12.116 D4, before the reached-stop question: a departed stop's address
     * and type are not open to "correction or next trip?" at all, and asking
     * first would only lead to a refusal after the answer. Its appointment is
     * held to the same rule in `writeStop`, once resolved.
     */
    edit.stops.forEach((draft, i) => {
      const existing = draft.stopId ? byId.get(draft.stopId) : undefined;
      if (
        existing?.departedAt &&
        (normalizeAddress(existing) !== normalizeAddress(addressOf(draft)) ||
          existing.stopType !== draft.stopType)
      ) {
        throw new AtStopError(i, new StopEditError(LEFT_STOP_LOCKED, '*'));
      }
    });

    /**
     * The overwritten-trips fix. Asked every time the city of a reached stop
     * or the load number of a reached load changes, and never answered here:
     * no answer, no save.
     */
    if (load && edit.reachedStop === undefined) {
      const asked = reachedArrival(edit, load, stored, byId);
      if (asked) throw new ReachedStopError(asked.toISOString());
    }

    /**
     * §12.116 D3. The next trip closes this load as Delivered, so it is
     * offered only once every stop on it has been reached. A load with a stop
     * still ahead is not finished, and closing it would close that stop too.
     */
    if (isNextTrip && stored.some((s) => s.arrivedAt === null)) {
      throw new StopEditError(
        'The next trip can be entered once every stop on this load has been reached. Nothing was changed.',
        '*',
      );
    }

    /**
     * §12.116 D2. An override is stored per stop, but the board reads only
     * the truck's NEXT stop's. One set anywhere else would be invisible and
     * would most likely expire before its stop came up. Clearing one is
     * allowed anywhere: it can only remove something.
     */
    if (load && !isNextTrip && edit.stops.some((d) => d.stopId && d.override?.action === 'set')) {
      const [next] = (await tx.execute(sql`
        select s.id::text as stop_id from trucks t ${BOARD_NEXT_STOP} where t.id = ${edit.truckId}::uuid
      `)) as unknown as { stop_id: string }[];
      edit.stops.forEach((d, i) => {
        if (d.stopId && d.override?.action === 'set' && d.stopId !== next?.stop_id) {
          throw new AtStopError(
            i,
            new StopEditError(
              "An override applies to the truck's next stop, and this is not it. Nothing was saved.",
              '*',
            ),
          );
        }
      });
    }

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
         * sides. The stops' own changes get their own entries below — they
         * are a different edit that happened to share a save.
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

    /* -------------------------- the load and stops --------------------- */

    /** The row this save writes over — none, for the next trip. */
    const existingLoad = isNextTrip ? undefined : load;
    let loadId: string;
    const written: WrittenStop[] = [];

    /** Wraps a stop's own errors with which stop it was. */
    const atStop = async <T>(i: number, body: () => Promise<T>): Promise<T> => {
      try {
        return await body();
      } catch (error: unknown) {
        if (error instanceof StopEditError || error instanceof AppointmentTimeError) {
          throw new AtStopError(i, error);
        }
        throw error;
      }
    };

    if (existingLoad) {
      loadId = existingLoad.loadId;
      await tx
        .update(loads)
        .set({
          // §12.21/§12.23: an ABSENT key is not a request to erase anything.
          // Spread rather than `loadNumber: edit.loadNumber`, because drizzle
          // happens to skip undefined in `set()` and that is its behaviour to
          // change, not a contract of ours. The column the caller never
          // mentioned is the one the broker wipe nulled.
          ...(edit.loadNumber !== undefined ? { loadNumber: edit.loadNumber } : {}),
          status: edit.loadStatus,
          truckId: edit.truckId,
        })
        .where(eq(loads.id, loadId));

      // §12.117. The stops that stay, in order, for D5's "earlier stop".
      const kept = stored.filter((s) => !removedIds.includes(s.stopId));
      let appendAt = Math.max(0, ...stored.map((s) => s.sequence));

      for (const [i, draft] of edit.stops.entries()) {
        const existing = draft.stopId ? byId.get(draft.stopId) : undefined;
        const sequence = existing?.sequence ?? ++appendAt;
        const earlier = kept.findIndex((s) => s.sequence < sequence && s.departedAt === null);
        written.push(
          await atStop(i, () =>
            writeStop(tx, {
              actorUserId: input.actorUserId,
              truckId: edit.truckId,
              loadId,
              sequence,
              draft,
              existing,
              located: located[i]!,
              earlierUndeparted: earlier === -1 ? null : earlier + 1,
              warnings,
              index: i,
            }),
          ),
        );
      }

      /**
       * §12.117. Removals, re-checked here against the locked rows: a stop
       * the truck reached after the modal opened is refused, whatever the
       * modal believed (checkStops). Its override, cached route and ETA marks
       * go with it by cascade; route samples keep their own destination.
       */
      if (removedIds.length > 0) {
        await tx.delete(stops).where(inArray(stops.id, removedIds));
      }
      // Contiguous again after a removal or an append, so the timeline never
      // shows "DEL 3" without a 2. Negated first: the unique (load, sequence)
      // index is checked row by row, and a direct renumber can collide.
      if (removedIds.length > 0 || edit.stops.some((d) => d.stopId === null)) {
        await tx.execute(sql`update stops set sequence = -sequence where load_id = ${loadId}::uuid`);
        await tx.execute(sql`
          update stops s set sequence = r.n
          from (select id, row_number() over (order by sequence desc) as n
                from stops where load_id = ${loadId}::uuid) r
          where s.id = r.id`);
      }
    } else {
      /**
       * §12.92. The previous loads the dispatcher said to close, closed FIRST
       * and by Clear stop's own function — its checks, its anchor clearing,
       * its audit row with source `operator-clear-stop`. Nested here it is a
       * savepoint of this transaction, so if anything below fails the closes
       * are undone with the new load: both land or neither does.
       */
      // The next trip closes the reached stop's load first, the same way.
      if (isNextTrip) {
        await clearStop(tx, {
          actorUserId: input.actorUserId,
          request: { truckId: edit.truckId, loadId: load!.loadId, status: 'DELIVERED' },
        });
      }
      for (const close of edit.closePrevious ?? []) {
        await clearStop(tx, {
          actorUserId: input.actorUserId,
          request: { truckId: edit.truckId, loadId: close.loadId, status: close.status },
        });
      }

      // "New load" state — same fields, same validation, same conversion.
      // A separate creation flow would be a second place for the appointment
      // path to go wrong.
      const [created] = await tx
        .insert(loads)
        .values({
          truckId: edit.truckId,
          // A brand new load has nothing to leave alone, so omitted and empty
          // are the same thing here: no number yet.
          loadNumber: edit.loadNumber ?? null,
          status: edit.loadStatus,
        })
        .returning({ id: loads.id });
      loadId = created!.id;

      for (const [i, draft] of edit.stops.entries()) {
        written.push(
          await atStop(i, () =>
            writeStop(tx, {
              actorUserId: input.actorUserId,
              truckId: edit.truckId,
              loadId,
              sequence: i + 1,
              draft,
              existing: undefined,
              located: located[i]!,
              // Every earlier stop of a new load is new, and not left.
              earlierUndeparted: i === 0 ? null : 1,
              warnings,
              index: i,
              // The modal re-sends the stored arrival on every save. On the
              // next trip that arrival is the REACHED stop's, and it stays
              // there: the new stop starts unreached.
              ignoreArrival: isNextTrip,
            }),
          ),
        );
      }
    }

    /* ---------------------------- the overrides ------------------------- */

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
    for (const [i, draft] of edit.stops.entries()) {
      const override = draft.override;
      if (!override) continue;
      const stopId = written[i]!.stopId;
      if (override.action === 'clear') {
        await clearOverride(tx, { actorUserId: input.actorUserId, clear: { stopId } });
      } else {
        const { action: _action, ...fields } = override;
        await setOverride(tx, {
          actorUserId: input.actorUserId,
          dispatchTz: input.dispatchTz,
          override: { stopId, ...fields },
        });
      }
    }

    /* ------------------------------ audit ------------------------------ */

    /**
     * §12.116 D7. One entry per stop this save wrote or removed, in the shape
     * a single stop's save has always had — so Reopen's `readClose` reads a
     * close made here exactly as before — joined by one `saveId`.
     */
    const loadNumberAfter =
      edit.loadNumber !== undefined ? edit.loadNumber : (existingLoad?.loadNumber ?? null);
    for (const [i, w] of written.entries()) {
      const entry: AuditEntry = {
        actorUserId: input.actorUserId,
        entity: 'stop',
        entityId: w.stopId,
        before: w.existing && existingLoad ? stopBefore(existingLoad, w.existing) : null,
        after: {
          truckId: edit.truckId,
          loadId,
          // What was WRITTEN, not what was sent — an omitted key leaves the
          // stored value, and an audit row that claimed null would be a lie.
          loadNumber: loadNumberAfter,
          loadStatus: edit.loadStatus,
          ...w.after,
          // §12.92: the previous loads this save closed, by id and status.
          // Each has its own `operator-clear-stop` row too.
          ...(i === 0 && !existingLoad && edit.closePrevious?.length
            ? { closedPrevious: edit.closePrevious }
            : {}),
          // The reached stop's load this save closed, as the next trip after it.
          ...(i === 0 && isNextTrip
            ? { nextTripAfter: { loadId: load!.loadId, status: 'DELIVERED' } }
            : {}),
          ...w.arrival,
          sequence: w.sequence,
          saveId,
          source: 'edit-modal',
        },
      };
      await writeAudit(tx, entry);
    }
    for (const id of removedIds) {
      const gone = byId.get(id)!;
      await writeAudit(tx, {
        actorUserId: input.actorUserId,
        entity: 'stop',
        entityId: id,
        before: { ...stopBefore(existingLoad!, gone), sequence: gone.sequence },
        after: {
          truckId: edit.truckId,
          loadId,
          loadNumber: loadNumberAfter,
          loadStatus: edit.loadStatus,
          removed: true,
          saveId,
          source: 'edit-modal',
        },
      });
    }

    return {
      saveId,
      loadId,
      stops: written.map((w) => ({ stopId: w.stopId, appointment: w.appointment })),
      reassignment,
      warnings,
    };
  });
}

/**
 * §12.117. The shape of the request against the locked load: every stop it
 * names is on this load, in the order the load holds them, new ones last;
 * every removal is a stop the truck has not reached; and the count stays
 * between one and `MAX_STOPS_PER_LOAD`.
 */
function checkStops(
  edit: LoadEdit,
  stored: StoredStop[],
  byId: Map<string, StoredStop>,
  removedIds: string[],
  isNextTrip: boolean,
): void {
  let last = -Infinity;
  let appended = false;
  edit.stops.forEach((draft, i) => {
    if (draft.stopId === null) {
      appended = true;
      return;
    }
    const existing = byId.get(draft.stopId);
    if (!existing) {
      throw new AtStopError(i, new StopEditError('That stop is not on this load. Nothing was saved.', '*'));
    }
    // Reordering is not built (§12.116): stops stay in the order entered.
    if (appended || existing.sequence < last) {
      throw new AtStopError(
        i,
        new StopEditError('Stops keep the order they were entered in. Nothing was saved.', '*'),
      );
    }
    last = existing.sequence;
  });

  removedIds.forEach((id, j) => {
    const stop = byId.get(id);
    if (!stop) {
      throw new StopEditError('That stop is not on this load. Nothing was saved.', `removedStopIds.${j}`);
    }
    if (stop.arrivedAt !== null || stop.departedAt !== null) {
      throw new StopEditError(
        'The truck has reached this stop, so it stays on the load. Nothing was saved.',
        `removedStopIds.${j}`,
      );
    }
  });

  if (isNextTrip) return;
  const count = stored.length - removedIds.length + edit.stops.filter((d) => d.stopId === null).length;
  if (count < 1) {
    throw new StopEditError('A load needs at least one stop. Nothing was saved.', '*');
  }
  if (count > MAX_STOPS_PER_LOAD) {
    throw new StopEditError(
      `A load holds at most ${MAX_STOPS_PER_LOAD} stops. Nothing was saved.`,
      '*',
    );
  }
}

/**
 * The arrival the reached-stop question quotes, or null when the save needs
 * no answer. A named stop whose city changed after the truck reached it;
 * else, a new load number on a load any of whose stops was reached.
 */
function reachedArrival(
  edit: LoadEdit,
  load: StoredLoad,
  stored: StoredStop[],
  byId: Map<string, StoredStop>,
): Date | null {
  for (const draft of edit.stops) {
    const existing = draft.stopId ? byId.get(draft.stopId) : undefined;
    if (
      existing?.arrivedAt &&
      needsReachedAnswer(
        {
          arrivedAt: existing.arrivedAt.toISOString(),
          city: existing.city,
          loadNumber: load.loadNumber,
        },
        { city: draft.city, loadNumber: edit.loadNumber },
      )
    ) {
      return existing.arrivedAt;
    }
  }
  const numberChanged = edit.loadNumber !== undefined && edit.loadNumber !== load.loadNumber;
  return numberChanged ? (stored.find((s) => s.arrivedAt !== null)?.arrivedAt ?? null) : null;
}

interface WrittenStop {
  stopId: string;
  sequence: number;
  appointment: ResolvedAppointment | null;
  existing: StoredStop | undefined;
  /** The stop's own part of the audit row's `after`, in its historical order. */
  after: Record<string, unknown>;
  /** The arrival's part, present only when this save moved it (§12.57). */
  arrival: Record<string, unknown>;
}

/**
 * One stop: its appointment, address, coordinates, note and arrival — the
 * single-stop save as it was, rule for rule. Errors carry the bare field
 * name; the caller says which stop.
 */
async function writeStop(
  tx: Tx,
  ctx: {
    actorUserId: string | null;
    truckId: string;
    loadId: string;
    sequence: number;
    draft: StopDraft;
    /** The row this save writes over — none for a new stop or the next trip. */
    existing: StoredStop | undefined;
    located: { geocode: GeocodeOutcome | null; addressChanged: boolean };
    /** §12.116 D5. The position of an earlier stop not yet left, if any. */
    earlierUndeparted: number | null;
    warnings: SaveWarning[];
    index: number;
    ignoreArrival?: boolean;
  },
): Promise<WrittenStop> {
  const { draft, existing } = ctx;
  const { geocode, addressChanged } = ctx.located;
  const typed = addressOf(draft);
  const arrivedAtEdit = ctx.ignoreArrival ? undefined : draft.arrivedAt;
  /** §12.118. The departure, by the arrival's rules; the next trip starts with neither. */
  const departedAtEdit = ctx.ignoreArrival ? undefined : draft.departedAt;

  /* -------------------------- the appointment ------------------------ */

  // Converted here, from wall time + zone. The client never sends an
  // instant, and this throws AppointmentTimeError on an hour that does not
  // exist at that facility.
  const appointment = draft.appointment ? await resolveAppointment(tx, draft.appointment) : null;
  if (appointment?.endResolution === 'ambiguous' && appointment.endUtc) {
    ctx.warnings.push({
      field: `stops.${ctx.index}.appointment.endTime`,
      message: repeatedHourWarning(appointment.endUtc, appointment.tz),
    });
  }

  /**
   * §12.116 D4. A stop the truck has LEFT is a record of where it went. Its
   * address, type and appointment stay as recorded: under §12.85 a new
   * address would wipe the departure, and the board would jump back to a
   * stop the truck is no longer at. Its note, arrival and departure can still
   * be corrected.
   */
  if (existing?.departedAt) {
    const instant = (value: Date | string | null | undefined) =>
      value ? new Date(value).getTime() : null;
    const unchanged =
      normalizeAddress(existing) === normalizeAddress(typed) &&
      existing.stopType === draft.stopType &&
      instant(existing.appointmentStartUtc) === instant(appointment?.startUtc) &&
      instant(existing.appointmentEndUtc) === instant(appointment?.endUtc) &&
      (existing.appointmentStartUtc === null ||
        (existing.appointmentTz === (appointment?.tz ?? null) &&
          existing.appointmentType === (draft.appointment?.type ?? 'APPT')));
    if (!unchanged) {
      throw new StopEditError(LEFT_STOP_LOCKED, '*');
    }
  }

  /**
   * §12.118. The departure as an instant, resolved up front so the arrival's
   * own "not after the truck left" check below measures against the
   * departure this save is writing, not the one it is replacing. Refused on
   * the spring-forward hour, like the arrival.
   */
  const departure = departedAtEdit ? await resolveWallTime(tx, departedAtEdit, 'departedAt.time') : null;

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
          geocodeAccuracyMiles: geocode.accuracyMiles ?? null,
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
          geocodeAccuracyMiles: null,
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
          geocodeAccuracyMiles: null,
          geocodeConfidence: null,
          geocodedAddress: null,
          geocodedAt: null,
        };

  const appointmentColumns = {
    appointmentStartUtc: appointment ? sql`${appointment.startUtc}::timestamptz` : null,
    appointmentEndUtc: appointment?.endUtc ? sql`${appointment.endUtc}::timestamptz` : null,
    appointmentTz: appointment?.tz ?? null,
    appointmentType: draft.appointment?.type ?? ('APPT' as const),
  };

  /**
   * The dispatcher note, and the two columns that record who wrote it.
   *
   * Two rules, and they are not the same rule:
   *
   * 1. **Omitted means leave it alone** (§12.21). The key being absent is
   *    not a request to erase a note the caller never mentioned.
   * 2. **`noteBy`/`noteAt` move only when the TEXT moves.** Sending the
   *    same note back — which is exactly what a modal that loads the stored
   *    value does on every unrelated save — must not re-stamp it with a
   *    different dispatcher and the current time. That is history changing
   *    without anything having happened, the same class as §12.45's rename.
   *
   * Compared against the stored value rather than trusting the client to
   * omit correctly: the server is the layer that knows what is already
   * there, and a rule that depends on the caller behaving is not a rule.
   */
  const noteChanged =
    draft.dispatcherNote !== undefined && draft.dispatcherNote !== (existing?.dispatcherNote ?? null);
  const noteColumns = noteChanged
    ? {
        dispatcherNote: draft.dispatcherNote ?? null,
        noteBy: draft.dispatcherNote ? ctx.actorUserId : null,
        noteAt: draft.dispatcherNote ? sql`now()` : null,
      }
    : {};

  /* --------------------------- the arrival --------------------------- */

  /**
   * §12.57. `arrived_at`, written by a person instead of by the sweep.
   *
   * Three rules, and the third is the one with a bug behind it:
   *
   * 1. **Omitted means leave it alone; null means clear it.** Clearing is
   *    not a convenience. §12.27 never unsets `arrived_at` automatically,
   *    which is correct for something anchored to a GPS fix and unbearable
   *    for something typed at 4am on the wrong row.
   *
   * 2. **A wall time, converted here.** Never an instant from the client,
   *    and refused outright on the spring-forward hour — an arrival stored
   *    silently an hour late is a false record of where a truck was.
   *
   * 3. **The source moves only when the TIME moves, tested at the
   *    control's resolution, not the column's.** The modal loads the stored
   *    arrival, so every unrelated save re-sends it. A detected arrival
   *    reads back as 06:44:37 and the control can only render and return
   *    06:44 — so a naive comparison sees a change on every save and
   *    relabels a measurement as a dispatcher's claim. That is §12.53's
   *    note-authorship bug exactly, in the one column where the difference
   *    between measured and asserted is the whole point. Compared to the
   *    minute because a minute is all the control can express.
   */
  /**
   * §12.85. Clearing an arrival clears everything that hangs off it: the
   * departure and the anchor. The set is shared (§12.88) — see
   * `arrival-columns.ts`.
   */
  const CLEARED = ARRIVAL_CLEARED;

  let arrivalColumns:
    | Record<string, never>
    | typeof CLEARED
    | {
        arrivedAt: SQL;
        arrivedSource: 'dispatcher';
        arrivalAnchorLat: number | null;
        arrivalAnchorLng: number | null;
        arrivalAnchorAt: SQL | null;
      } = {};
  /** What to log: undefined = untouched, null = cleared, string = written. */
  let arrivalWritten: string | null | undefined;
  /** §12.85. Why this save cleared an arrival nobody unticked. */
  let arrivalWipedBy: 'address-changed' | undefined;
  /** §12.85. The anchor decision for an arrival this save wrote. */
  let anchor: AnchorDecision | undefined;

  /**
   * §12.85. A new address is a new place. The arrival, its departure and its
   * anchor all described the OLD one — an anchor there would clear the
   * arrival the moment the truck drove to the corrected address. So an
   * address change wipes all three, whatever the arrival fields in the same
   * save say: the modal re-sends a stored arrival on every save, so a
   * ticked box is not evidence the dispatcher meant to keep it, and one
   * rule the modal can state in advance beats one it has to hedge. Marking
   * the truck arrived at the new address is the next save's job.
   */
  const wipedByAddress =
    existing !== undefined &&
    addressChanged &&
    (existing.arrivedAt !== null || existing.departedAt !== null);

  if (wipedByAddress) {
    arrivalColumns = CLEARED;
    arrivalWritten = null;
    arrivalWipedBy = 'address-changed';
  } else if (arrivedAtEdit === null) {
    // Clearing nothing is not a change, and must not write an audit row
    // saying an arrival was removed.
    if (existing?.arrivedAt) {
      arrivalColumns = CLEARED;
      arrivalWritten = null;
    }
  } else if (arrivedAtEdit !== undefined) {
    const arrival = await resolveWallTime(tx, arrivedAtEdit);
    const at = new Date(arrival.utc).getTime();

    /**
     * A truck cannot have arrived in the future. The tolerance exists
     * because the control DEFAULTS to the dispatcher's own clock, and a
     * browser a minute fast would otherwise have its default refused — a
     * validation error on a value nobody typed is worse than useless.
     */
    if (at > Date.now() + FUTURE_ARRIVAL_TOLERANCE_MS) {
      throw new StopEditError(
        'That arrival time is in the future. A truck cannot have arrived yet.',
        'arrivedAt.time',
      );
    }
    // The database would refuse this too (`stops_departed_after_arrived`),
    // as a 500 with no field on it. Said here so it lands on the input. A
    // departure this save also writes is checked against the arrival below,
    // on its own field.
    if (departedAtEdit === undefined && existing?.departedAt && at > existing.departedAt.getTime()) {
      throw new StopEditError(
        'That is after the truck left this stop. Check the date.',
        'arrivedAt.time',
      );
    }

    const minute = (value: Date | null) =>
      value === null ? null : Math.floor(value.getTime() / 60_000);
    if (minute(existing?.arrivedAt ?? null) !== minute(new Date(arrival.utc))) {
      /**
       * §12.116 D5. The board moves on by DEPARTURE (§12.13), so an arrival
       * here while an earlier stop is not left would sit behind that stop
       * for good: the board would stay on stop 1 with stop 2 marked reached.
       */
      if (ctx.earlierUndeparted !== null) {
        throw new StopEditError(
          `Stop ${ctx.earlierUndeparted} hasn't been left yet, so the truck cannot have arrived here.`,
          'arrivedAt.time',
        );
      }

      /**
       * §12.85. Where the truck is NOW — the newest fix, read inside this
       * transaction — measured against the stop as it will be after this
       * save: the new geocode when the address changed, else the stored one.
       */
      const [newest] = await tx
        .select({
          lat: positions.lat,
          lng: positions.lng,
          speedMph: positions.speedMph,
          recordedAt: positions.recordedAt,
        })
        .from(positions)
        .where(eq(positions.truckId, ctx.truckId))
        .orderBy(desc(positions.recordedAt))
        .limit(1);
      // A changed address reaches here only when there was no arrival to
      // wipe — a first arrival marked in the same save as the correction —
      // and then the new geocode is the place it has to be measured at.
      const place = addressChanged
        ? geocode?.ok
          ? {
              lat: geocode.lat,
              lng: geocode.lng,
              precision: geocode.precision,
              accuracyMiles: geocode.accuracyMiles ?? null,
            }
          : { lat: null, lng: null, precision: null, accuracyMiles: null }
        : {
            lat: existing?.lat ?? null,
            lng: existing?.lng ?? null,
            precision: existing?.geocodePrecision ?? null,
            accuracyMiles: existing?.geocodeAccuracyMiles ?? null,
          };
      anchor = anchorAtTick(
        place,
        newest
          ? {
              lat: newest.lat,
              lng: newest.lng,
              speedMph: newest.speedMph,
              recordedAtUtc: newest.recordedAt.toISOString(),
            }
          : null,
        new Date(),
      );
      arrivalColumns = {
        arrivedAt: sql`${arrival.utc}::timestamptz`,
        arrivedSource: 'dispatcher',
        arrivalAnchorLat: anchor.anchor?.lat ?? null,
        arrivalAnchorLng: anchor.anchor?.lng ?? null,
        arrivalAnchorAt: anchor.anchor ? sql`${anchor.anchor.recordedAtUtc}::timestamptz` : null,
      };
      arrivalWritten = arrival.utc;

      /**
       * Said in the modal only where it changes what happens next. A street
       * stop with no anchor still has the §12.27 rule, measured from its own
       * coordinate; a coarse or unlocated one has nothing, and the arrival
       * will sit there until someone unticks it — which is how every
       * hand-marked arrival behaved before this, and worth knowing at 4am.
       */
      if (anchor.anchor === null && place.precision !== 'street') {
        ctx.warnings.push({
          field: `stops.${ctx.index}.arrivedAt`,
          message: noAnchorWarning(anchor, place.precision),
        });
      }
    }
  }

  /* -------------------------- the departure -------------------------- */

  /**
   * §12.118. `departed_at`, written by a person — the arrival's three rules:
   * omitted leaves it, null clears it, a wall time is converted here; and the
   * source moves only when the MINUTE moves, so a detected departure re-sent
   * by an unrelated save stays `detected`.
   *
   * It needs the arrival it leaves from — stored, or written in this save —
   * and is never before it nor in the future. Clearing the arrival has
   * already cleared it (`ARRIVAL_CLEARED`), and so has an address change;
   * a departure sent beside a wiped arrival is dropped with it, like the
   * arrival itself (§12.85).
   */
  let departureColumns:
    | Record<string, never>
    | { departedAt: null; departedSource: null }
    | { departedAt: SQL; departedSource: 'dispatcher' } = {};
  /** What to log: undefined = untouched, null = cleared, string = written. */
  let departureWritten: string | null | undefined;

  const arrivalCleared = arrivalColumns === CLEARED;
  if (!wipedByAddress) {
    if (departedAtEdit === null) {
      if (existing?.departedAt && !arrivalCleared) {
        departureColumns = { departedAt: null, departedSource: null };
        departureWritten = null;
      }
    } else if (departure) {
      const minute = (value: Date | null) =>
        value === null ? null : Math.floor(value.getTime() / 60_000);
      if (minute(existing?.departedAt ?? null) !== minute(new Date(departure.utc))) {
        const arrivedAt = arrivalCleared
          ? null
          : arrivalWritten !== undefined && arrivalWritten !== null
            ? new Date(arrivalWritten)
            : (existing?.arrivedAt ?? null);
        if (arrivedAt === null) {
          throw new StopEditError(
            'Mark the arrival first: a truck can only leave a stop it reached.',
            'departedAt.time',
          );
        }
        const at = new Date(departure.utc).getTime();
        // The arrival's guard, unchanged: the control defaults to the
        // dispatcher's own clock, so a browser a minute fast is tolerated.
        if (at > Date.now() + FUTURE_ARRIVAL_TOLERANCE_MS) {
          throw new StopEditError(
            'That departure time is in the future. The truck cannot have left yet.',
            'departedAt.time',
          );
        }
        if (at < arrivedAt.getTime()) {
          throw new StopEditError(
            'That is before the truck arrived at this stop. Check the date.',
            'departedAt.time',
          );
        }
        departureColumns = {
          departedAt: sql`${departure.utc}::timestamptz`,
          departedSource: 'dispatcher',
        };
        departureWritten = departure.utc;
      }
    }
  }

  let stopId: string;
  if (existing) {
    stopId = existing.stopId;
    await tx
      .update(stops)
      .set({
        type: draft.stopType,
        addressLine: draft.addressLine,
        city: draft.city,
        state: draft.state,
        zip: draft.zip,
        ...noteColumns,
        ...arrivalColumns,
        ...departureColumns,
        ...geocodeColumns,
        ...appointmentColumns,
      })
      .where(eq(stops.id, stopId));

    /**
     * §12.54. The cached route is a cache of THIS stop. Re-geocoding moves
     * the destination, so the row stops describing anything.
     *
     * It is already inert — `fleet-query` joins `stop_routes` on
     * `sr.stop_lat = s.lat and sr.stop_lng = s.lng`, so a moved stop falls
     * back to a straight line rather than projecting to the old place. This
     * deletes it because inert is not the same as gone, and one stale row
     * survived for exactly that reason:
     *
     * **The two defects compound.** `needsRecompute` correctly returned
     * `stop-moved` for truck 132's re-pointed stop every poll, and the
     * sweep's 0.5-mile floor then skipped the lane — because the truck was
     * parked 0.313 mi from the NEW address. The overwrite that would have
     * cleared the cache was blocked by the same rule that made the lane
     * unroutable, so a Dallas route sat on a Pennsylvania stop indefinitely.
     * 22 of 23 cache rows were current; the one that was not is the one the
     * floor had hold of.
     *
     * Deleting at the source closes it without depending on a later sweep
     * being ABLE to run. `route_samples` is untouched — those are
     * measurements and they keep their own destination now.
     */
    if (geocode) await tx.delete(stopRoutes).where(eq(stopRoutes.stopId, stopId));
  } else {
    const [stop] = await tx
      .insert(stops)
      .values({
        loadId: ctx.loadId,
        type: draft.stopType,
        sequence: ctx.sequence,
        addressLine: draft.addressLine,
        city: draft.city,
        state: draft.state,
        zip: draft.zip,
        // A brand new stop has nothing to leave alone, so omitted and empty
        // mean the same thing here: no note yet.
        dispatcherNote: draft.dispatcherNote ?? null,
        noteBy: draft.dispatcherNote ? ctx.actorUserId : null,
        noteAt: draft.dispatcherNote ? sql`now()` : null,
        // A brand new stop has no arrival to leave alone either, so the
        // block above resolves to `{}` for both omitted and null.
        ...arrivalColumns,
        ...departureColumns,
        ...geocodeColumns,
        ...appointmentColumns,
      })
      .returning({ id: stops.id });
    stopId = stop!.id;
  }

  return {
    stopId,
    sequence: ctx.sequence,
    appointment,
    existing,
    after: {
      stopType: draft.stopType,
      addressLine: draft.addressLine,
      city: draft.city,
      state: draft.state,
      zip: draft.zip,
      appointmentStartUtc: appointment?.startUtc ?? null,
      /**
       * The deadline, and what kind of time it is (§12.114). Absent from
       * this log until then, which is why two FCFS windows ending 23:59
       * could not be told apart from an overnight workaround afterwards.
       */
      appointmentEndUtc: appointment?.endUtc ?? null,
      appointmentType: appointmentColumns.appointmentType,
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
              accuracyMiles: geocode.accuracyMiles ?? null,
              confidence: geocode.confidence,
              matched: geocode.matchedAddress,
              ...(geocode.streetRefusal ? { streetRefused: geocode.streetRefusal } : {}),
            }
          : { missed: geocode.reason, unmatched: geocode.unmatched }
        : 'address unchanged — not re-geocoded',
      /** Kept: on the fall-back date this says which 01:30 was stored. */
      appointmentResolution: appointment?.resolution ?? null,
      appointmentEndResolution: appointment?.endResolution ?? null,
      // What was WRITTEN, not what was sent (§12.21). A save that left the
      // note alone must not appear in history as having set it.
      ...(noteChanged ? { dispatcherNote: draft.dispatcherNote ?? null } : {}),
    },
    /**
     * §12.57. Same rule, same reason: present only when this save actually
     * moved it. A history that showed an arrival being re-set on every
     * unrelated edit would bury the one entry that matters.
     */
    arrival: {
      ...(arrivalWritten !== undefined
        ? {
            arrivedAt: arrivalWritten,
            arrivedSource: arrivalWritten === null ? null : 'dispatcher',
            // §12.85. Where the truck stood, or why nothing was recorded.
            ...(anchor
              ? anchor.anchor
                ? { arrivalAnchor: anchor.anchor }
                : { arrivalAnchor: null, anchorRefused: anchor.refused, anchorMiles: anchor.miles }
              : {}),
            ...(arrivalWritten === null ? { departedAt: null, departedSource: null } : {}),
            ...(arrivalWipedBy ? { arrivalWipedBy } : {}),
          }
        : {}),
      // §12.118. Same rule: present only when this save moved the departure.
      ...(departureWritten !== undefined
        ? {
            departedAt: departureWritten,
            departedSource: departureWritten === null ? null : 'dispatcher',
          }
        : {}),
    },
  };
}

/**
 * §12.117. `Clear now`, from an open modal: the override goes at once, and
 * the modal is handed the version that results — but only if the load is
 * still the one it opened. Otherwise this is refused like a stale save, and
 * nothing is cleared.
 */
export async function clearOverrideAt(
  db: Db,
  input: { actorUserId: string | null; stopId: string; version: string },
): Promise<{ cleared: boolean; loadVersion: string }> {
  return db.transaction(async (tx) => {
    const [stop] = await tx
      .select({ loadId: stops.loadId })
      .from(stops)
      .where(eq(stops.id, input.stopId))
      .limit(1);
    if (!stop) throw new StaleLoadError();
    await tx.select({ id: loads.id }).from(loads).where(eq(loads.id, stop.loadId)).for('update');
    if ((await readLoadVersion(tx, stop.loadId)) !== input.version) throw new StaleLoadError();
    const { cleared } = await clearOverride(tx, {
      actorUserId: input.actorUserId,
      clear: { stopId: input.stopId },
    });
    return { cleared, loadVersion: (await readLoadVersion(tx, stop.loadId))! };
  });
}

/**
 * §12.85. The modal's sentence for a hand-marked arrival that cannot end by
 * itself. Names the reason, because "the truck is not there" is only true of
 * one of the four and a dispatcher who knows the truck IS there needs to
 * know it was the feed that could not say so.
 */
export function noAnchorWarning(
  decision: Extract<AnchorDecision, { anchor: null }>,
  precision: 'street' | 'block' | 'zip' | null,
): string {
  const area =
    precision === 'zip'
      ? "this stop's ZIP area"
      : precision === 'block'
        ? "this stop's block"
        : 'this stop';
  const why =
    decision.refused === 'no-position'
      ? 'there is no position for this truck'
      : decision.refused === 'stale'
        ? `this truck's last position is more than ${ANCHOR_MAX_AGE_MINUTES} minutes old`
        : decision.refused === 'moving'
          ? 'the truck is moving right now'
          : `the truck is ${decision.miles?.toFixed(1) ?? '?'} mi from ${area}`;
  return (
    `Arrival saved, but ${why}, so there is no position to measure leaving from. ` +
    'This arrival will not clear by itself when the truck leaves.'
  );
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

/**
 * §12.114. The latest hour landed on the hour that happens twice. Postgres
 * takes the SECOND one — standard time, the later instant — which for a
 * deadline is the generous reading. Saved, and said, because a dispatcher
 * reading "01:30" off a rate confirmation has no way to know which one the
 * receiver meant either.
 */
function repeatedHourWarning(endUtc: string, tz: string): string {
  const end = new Date(endUtc);
  const wall = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(end);
  return (
    `The latest hour, ${wall}, happens twice in ${tz} — the clocks go back that ` +
    `night. Saved as the second one (${zoneAbbreviation(end, tz)}), the later deadline.`
  );
}
