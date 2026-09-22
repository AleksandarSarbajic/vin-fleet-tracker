import { createHash } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DriverSource } from '@/lib/driver';
import { assignments, drivers } from '@/db/schema';
import { truckLabel } from './assignments';
import type { Db, Tx } from './audit';
import { NEXT_STOP_ORDER } from './next-stop';

/**
 * Reassignment: two trucks, one transaction (§9.10).
 *
 * The confirm dialog renders from THIS preview, not from the client's guess
 * about what will happen. The client cannot know what the losing truck's next
 * appointment is, and a dialog that guesses is a dialog that lies on the one
 * occasion it matters.
 */

export interface PreviewSide {
  truckId: string;
  truckLabel: string;
  driverId: string | null;
  driverName: string | null;
  /** §12.37: the confirm dialog shows these names, so it needs the tag too. */
  driverSource: DriverSource | null;
  driverSamsaraId: string | null;
  /** ISO-8601 UTC + the stop's zone, so the dialog can print it correctly. */
  nextApptUtc: string | null;
  nextApptTz: string | null;
}

export interface ReassignPreview {
  /** Gaining truck, as it will be. */
  gaining: PreviewSide & { toDriverId: string | null; toDriverName: string | null };
  /** The truck that loses the driver, when there is one. */
  losing: PreviewSide | null;
  summary: string;
  note: string;
  /**
   * A hash of the exact state this preview describes. Sent back with the
   * confirm and recomputed inside the transaction: if someone else moved the
   * driver in between, the save is refused rather than doing something the
   * dispatcher never saw.
   */
  token: string;
}

const SideRow = z.object({
  truck_id: z.string().uuid(),
  truck_number: z.number().int().nullable(),
  samsara_name: z.string(),
  driver_id: z.string().uuid().nullable(),
  driver_name: z.string().nullable(),
  driver_source: z.enum(['samsara', 'app']).nullable(),
  driver_samsara_id: z.string().nullable(),
  next_appt_utc: z.string().nullable(),
  next_appt_tz: z.string().nullable(),
});

/** One truck's current driver and next deadline. */
async function sideOf(executor: Db | Tx, truckId: string): Promise<PreviewSide | null> {
  const rows = z.array(SideRow).parse(
    await executor.execute(sql`
      select
        t.id::text        as truck_id,
        t.truck_number    as truck_number,
        t.samsara_name    as samsara_name,
        d.id::text        as driver_id,
        d.name            as driver_name,
        d.source::text    as driver_source,
        d.samsara_driver_id as driver_samsara_id,
        to_char(ns.appointment_start_utc at time zone 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as next_appt_utc,
        ns.appointment_tz as next_appt_tz
      from trucks t
      left join assignments a on a.truck_id = t.id and a.ended_at is null
      left join drivers d     on d.id = a.driver_id
      left join lateral (
        select s.appointment_start_utc, s.appointment_tz
        from loads l join stops s on s.load_id = l.id
        where l.truck_id = t.id
          and l.status not in ('DELIVERED', 'TONU', 'CANCELLED')
          and s.departed_at is null
        ${NEXT_STOP_ORDER}
        limit 1
      ) ns on true
      where t.id = ${truckId}::uuid
    `),
  );
  const row = rows[0];
  if (!row) return null;
  return {
    truckId: row.truck_id,
    truckLabel: truckLabel({ truckNumber: row.truck_number, samsaraName: row.samsara_name }),
    driverId: row.driver_id,
    driverName: row.driver_name,
    driverSource: row.driver_source,
    driverSamsaraId: row.driver_samsara_id,
    nextApptUtc: row.next_appt_utc,
    nextApptTz: row.next_appt_tz,
  };
}

/** The truck a driver is currently on, if any. */
async function truckHolding(executor: Db | Tx, driverId: string): Promise<string | null> {
  const rows = await executor
    .select({ truckId: assignments.truckId })
    .from(assignments)
    .where(and(eq(assignments.driverId, driverId), isNull(assignments.endedAt)))
    .limit(1);
  return rows[0]?.truckId ?? null;
}

/**
 * The token covers everything the dialog asserted: which driver is moving,
 * where from, where to, and who the gaining truck is giving up. Any of those
 * changing under the dispatcher invalidates the confirmation.
 */
function tokenFor(parts: (string | null)[]): string {
  return createHash('sha256').update(parts.map((p) => p ?? '-').join('|')).digest('hex').slice(0, 32);
}

export async function previewReassignment(
  executor: Db | Tx,
  input: { truckId: string; driverId: string | null },
): Promise<ReassignPreview> {
  const gaining = await sideOf(executor, input.truckId);
  if (!gaining) throw new Error(`No truck ${input.truckId}`);

  const toDriver = input.driverId
    ? ((
        await executor
          .select({ id: drivers.id, name: drivers.name })
          .from(drivers)
          .where(eq(drivers.id, input.driverId))
          .limit(1)
      )[0] ?? null)
    : null;

  const losingTruckId = input.driverId ? await truckHolding(executor, input.driverId) : null;
  const losing =
    losingTruckId && losingTruckId !== input.truckId
      ? await sideOf(executor, losingTruckId)
      : null;

  const summary = input.driverId
    ? `Reassigns ${gaining.truckLabel} from ${gaining.driverName ?? 'Unassigned'} to ${toDriver?.name ?? 'Unassigned'}.` +
      (losing
        ? ` Truck ${losing.truckLabel} will have no driver` +
          (losing.nextApptUtc ? ' and keeps a live appointment.' : '.')
        : '')
    : `Clears the driver on ${gaining.truckLabel}. ${gaining.driverName ?? 'Nobody'} becomes unassigned.`;

  // Nothing is sent to anyone. Notifications are not built, deliberately.
  const note = losing
    ? `${losing.driverName ?? 'The driver'} becomes unassigned too and appears in the driver picker as available. Nothing is sent to either driver — notifications aren't built.`
    : 'Nothing is sent to the driver — notifications aren’t built.';

  return {
    gaining: {
      ...gaining,
      toDriverId: toDriver?.id ?? null,
      toDriverName: toDriver?.name ?? null,
    },
    losing,
    summary,
    note,
    token: tokenFor([
      gaining.truckId,
      gaining.driverId,
      input.driverId,
      losing?.truckId ?? null,
      losing?.driverId ?? null,
    ]),
  };
}

export class StalePreviewError extends Error {
  constructor(readonly fresh: ReassignPreview) {
    super('The assignment changed while the confirmation was open.');
    this.name = 'StalePreviewError';
  }
}

/**
 * Applies the move. Call inside the caller's transaction.
 *
 * Gaining truck gets a new row; the losing truck's row closes with an end
 * timestamp. There is never a window where one truck holds the driver and the
 * other still claims them — the two partial unique indexes would reject it
 * anyway, which is the point of having them.
 */
export async function applyReassignment(
  tx: Tx,
  input: {
    truckId: string;
    driverId: string | null;
    actorUserId: string | null;
    /** Required when the driver comes off another truck. */
    previewToken?: string | undefined;
  },
): Promise<{ preview: ReassignPreview; changed: boolean }> {
  // Recomputed INSIDE the transaction, after the rows are locked.
  await tx.execute(sql`
    select 1 from assignments where ended_at is null for update
  `);
  const preview = await previewReassignment(tx, input);

  if (preview.gaining.driverId === input.driverId) return { preview, changed: false };

  /**
   * Two rules, and both matter for the same reason: the dispatcher acts on
   * what the dialog said.
   *
   *   A token that no longer matches means the world moved under the open
   *   dialog — even when it moved in the harmless direction, the confirmation
   *   described something that is no longer what will happen.
   *
   *   A two-sided move with NO token was never confirmed at all. Taking a
   *   driver off another truck is not something to do on an unconfirmed
   *   request, whatever the UI believes it showed.
   */
  const tokenStale =
    input.previewToken !== undefined && input.previewToken !== preview.token;
  if (tokenStale || (preview.losing !== null && input.previewToken === undefined)) {
    throw new StalePreviewError(preview);
  }

  if (preview.losing) {
    await tx
      .update(assignments)
      .set({ endedAt: sql`now()` })
      .where(and(eq(assignments.truckId, preview.losing.truckId), isNull(assignments.endedAt)));
  }
  await tx
    .update(assignments)
    .set({ endedAt: sql`now()` })
    .where(and(eq(assignments.truckId, input.truckId), isNull(assignments.endedAt)));

  if (input.driverId) {
    await tx.insert(assignments).values({
      truckId: input.truckId,
      driverId: input.driverId,
      createdBy: input.actorUserId,
    });
  }

  return { preview, changed: true };
}
