import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { overrides, stops } from '@/db/schema';
import type { ClearOverrideInput, OverrideInput } from '@/lib/override';
import { appointmentStartSql } from './appointment';
/**
 * `Writer`, not `Db`: these are called both on their own (the overrides
 * route) and from INSIDE the stop save's transaction (§12.28), where they
 * receive a Tx and their own `.transaction` becomes a savepoint.
 */
import { writeAudit, type Tx, type Writer } from './audit';

/**
 * Writing a status override (§9.5).
 *
 * The write closes the previous live row before inserting. That is not
 * tidiness: `overrides_one_live_per_stop` is partial on `cleared_at is null`,
 * while EXPIRY is evaluated on read — so an expired-but-uncleared row still
 * occupies the slot and a second override on the same stop would hit the
 * unique index instead of replacing it. Found by writing the layer table out,
 * which is the same shape as the last two bugs.
 */

export class OverrideError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = 'OverrideError';
  }
}

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const ExpiryRow = z
  .object({ expires_at: z.string().regex(ISO_UTC_MS) })
  .strict();

/**
 * Turns the preset into an instant. Two of the four can only be computed
 * HERE: `End of day` needs the dispatch zone, `Until appt` needs the stop's
 * own appointment. A custom time is a wall time and goes through the SAME
 * integer-parts conversion an appointment does — one path, not two.
 */
async function resolveExpiry(
  tx: Tx,
  input: OverrideInput,
  dispatchTz: string,
): Promise<string> {
  const expression = (() => {
    switch (input.expiry) {
      case 'PLUS_4H':
        // The default. NOT end of day — set just after midnight that is
        // twenty hours and defeats the purpose (§9.5, correction 4).
        return sql`now() + interval '4 hours'`;
      case 'END_OF_DAY':
        // Midnight at the END of today, in the DISPATCH zone.
        return sql`timezone(${dispatchTz},
          date_trunc('day', timezone(${dispatchTz}, now())) + interval '1 day')`;
      case 'UNTIL_APPT':
        return sql`(
          select coalesce(s.appointment_end_utc, s.appointment_start_utc)
          from stops s where s.id = ${input.stopId}::uuid
        )`;
      case 'CUSTOM': {
        const custom = input.customExpiry!;
        return appointmentStartSql({
          type: 'APPT',
          date: custom.date,
          time: custom.time,
          tz: custom.tz,
          windowMinutes: null,
        });
      }
    }
  })();

  const rows = z.array(ExpiryRow).parse(
    await tx.execute(sql`
      select to_char((${expression}) at time zone 'UTC', ${sql.raw(ISO)}) as expires_at
    `),
  );
  const expiresAt = rows[0]?.expires_at;
  if (!expiresAt) {
    // `Until appt` on a stop with no appointment has nothing to expire at.
    throw new OverrideError(
      'That stop has no appointment to expire against. Pick another expiry.',
      'expiry',
    );
  }
  if (new Date(expiresAt).getTime() <= Date.now()) {
    throw new OverrideError('That expiry is already in the past.', 'expiry');
  }
  return expiresAt;
}

export interface OverrideResult {
  overrideId: string;
  expiresAtUtc: string;
}

export async function setOverride(
  db: Writer,
  input: { actorUserId: string | null; dispatchTz: string; override: OverrideInput },
): Promise<OverrideResult> {
  return db.transaction(async (tx) => {
    const [stop] = await tx
      .select({ id: stops.id })
      .from(stops)
      .where(eq(stops.id, input.override.stopId))
      .limit(1);
    if (!stop) throw new OverrideError('That stop no longer exists.', 'stopId');

    const expiresAt = await resolveExpiry(tx, input.override, input.dispatchTz);

    // Close whatever holds the slot — live OR merely expired. See the note at
    // the top: the unique index does not know about expiry.
    const [previous] = await tx
      .update(overrides)
      .set({ clearedAt: sql`now()` })
      .where(and(eq(overrides.stopId, stop.id), isNull(overrides.clearedAt)))
      .returning({
        id: overrides.id,
        forcedStatus: overrides.forcedStatus,
        reason: overrides.reason,
        expiresAt: overrides.expiresAt,
      });

    const [created] = await tx
      .insert(overrides)
      .values({
        stopId: stop.id,
        forcedStatus: input.override.forcedStatus,
        reason: input.override.reason,
        reasonNote: input.override.reasonNote,
        setBy: input.actorUserId,
        expiresAt: sql`${expiresAt}::timestamptz`,
      })
      .returning({ id: overrides.id });

    await writeAudit(tx, {
      actorUserId: input.actorUserId,
      entity: 'override',
      entityId: stop.id,
      before: previous
        ? {
            forcedStatus: previous.forcedStatus,
            reason: previous.reason,
            expiresAt: previous.expiresAt?.toISOString() ?? null,
          }
        : null,
      after: {
        forcedStatus: input.override.forcedStatus,
        reason: input.override.reason,
        reasonNote: input.override.reasonNote,
        expiresAt,
        expiry: input.override.expiry,
        source: 'edit-modal',
      },
    });

    return { overrideId: created!.id, expiresAtUtc: expiresAt };
  });
}

/** `Clear now` (§9.5). Clearing is its own action and its own audit entry. */
export async function clearOverride(
  db: Writer,
  input: { actorUserId: string | null; clear: ClearOverrideInput },
): Promise<{ cleared: boolean }> {
  return db.transaction(async (tx) => {
    const [closed] = await tx
      .update(overrides)
      .set({ clearedAt: sql`now()` })
      .where(and(eq(overrides.stopId, input.clear.stopId), isNull(overrides.clearedAt)))
      .returning({
        forcedStatus: overrides.forcedStatus,
        reason: overrides.reason,
      });

    if (!closed) return { cleared: false };

    await writeAudit(tx, {
      actorUserId: input.actorUserId,
      entity: 'override',
      entityId: input.clear.stopId,
      before: { forcedStatus: closed.forcedStatus, reason: closed.reason },
      after: { cleared: true, source: 'detail-panel' },
    });
    return { cleared: true };
  });
}
