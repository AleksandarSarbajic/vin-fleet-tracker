import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLog, overrides, stops } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import { makeTruck } from '@/test/fleet';
import { OverrideInput } from '@/lib/override';
import { StopEdit } from '@/lib/stop-edit';
import { OverrideError, clearOverride, setOverride } from './override';
import { saveStopEdit } from './stop-edit';
import { LATEST_POSITION_SQL, applyStatus, parseFleetRows } from './fleet-query';
import { STATUS_DEFAULTS } from '@/lib/status';
import type { Tx } from './audit';

/**
 * The override write path, against the real database, always rolled back.
 */

const withDb = describeDb;
const DISPATCH_TZ = 'America/Chicago';

/**
 * TOMORROW in the dispatch zone, DERIVED (§12.51).
 *
 * This fixture used to paste `2026-09-18`, and it passed until the clock
 * reached the 19th — at which point `setOverride` refused the write with
 * "that expiry is already in the past" and the suite went red on a day when
 * nothing had been touched.
 *
 * CLAUDE.md says to derive dates in code and never paste one. It says it
 * about DST, but the reason generalises: a pasted date is a test that
 * silently depends on when it is run.
 *
 * Tomorrow rather than today, so the appointment is always in the future
 * whatever the hour the suite runs at.
 */
function tomorrowInDispatchZone(): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DISPATCH_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(Date.now() + 86_400_000));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** The wall time an instant reads as in the dispatch zone, as `HH:MM`. */
function wallTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: DISPATCH_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/** A truck with one stop, created through the real edit path. */
async function aStop(tx: Tx) {
  const truck = await makeTruck(tx);

  const saved = await saveStopEdit(tx as never, {
    actorUserId: null,
    dispatchTz: DISPATCH_TZ,
    edit: StopEdit.parse({
      stopId: null,
      truckId: truck.id,
      loadNumber: 'TEST-OV-1',
      loadStatus: 'DISPATCHED',
      stopType: 'DEL',
      addressLine: '1400 Laraway Road',
      city: 'New Lenox',
      state: 'IL',
      zip: '60451',
      appointment: {
        type: 'APPT',
        date: tomorrowInDispatchZone(),
        time: { h: 14, min: 30 },
        tz: DISPATCH_TZ,
        windowMinutes: 30,
      },
      dispatcherNote: null,
    }),
  });
  return {
    truckId: truck.id,
    stopId: saved.stopId,
    apptStartUtc: saved.appointment?.startUtc ?? null,
    apptEndUtc: saved.appointment?.endUtc ?? null,
  };
}

const input = (stopId: string, over: Partial<OverrideInput> = {}) =>
  OverrideInput.parse({
    stopId,
    forcedStatus: 'LATE',
    reason: 'RECEIVER_CONFIRMED_DETENTION',
    reasonNote: null,
    expiry: 'PLUS_4H',
    customExpiry: null,
    ...over,
  });

withDb('setting an override', () => {
  it('writes the row and defaults to +4h, not end of day', async () => {
    const seen = await rolledBack(async (tx) => {
      const { stopId } = await aStop(tx);
      const result = await setOverride(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        override: input(stopId),
      });
      const rows = await tx
        .select({ forced: overrides.forcedStatus, expiresAt: overrides.expiresAt })
        .from(overrides)
        .where(eq(overrides.stopId, stopId));
      return { result, rows };
    });

    expect(seen.rows).toHaveLength(1);
    expect(seen.rows[0]!.forced).toBe('LATE');
    // Four hours out, within a minute of it.
    const hours = (new Date(seen.result.expiresAtUtc).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(3.9);
    expect(hours).toBeLessThan(4.1);
  });

  it('replaces an EXPIRED but uncleared row instead of hitting the index', async () => {
    /**
     * The trap the layer table found: `overrides_one_live_per_stop` is
     * partial on `cleared_at is null`, and expiry is evaluated on READ — so
     * an expired row still occupies the slot. Without closing it first, a
     * second override on the same stop dies on a unique index.
     */
    const seen = await rolledBack(async (tx) => {
      const { stopId } = await aStop(tx);
      await setOverride(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        override: input(stopId),
      });
      // Force the first one into the past without clearing it. `set_at` moves
      // too: overrides_expires_after_set refused the first attempt at this
      // fixture, which is the constraint doing exactly its job.
      await tx
        .update(overrides)
        .set({
          setAt: new Date(Date.now() - 2 * 3_600_000),
          expiresAt: new Date(Date.now() - 3_600_000),
        })
        .where(eq(overrides.stopId, stopId));

      await setOverride(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        override: input(stopId, { forcedStatus: 'ARRIVED' }),
      });

      return tx
        .select({ forced: overrides.forcedStatus, clearedAt: overrides.clearedAt })
        .from(overrides)
        .where(eq(overrides.stopId, stopId));
    });

    expect(seen).toHaveLength(2);
    expect(seen.filter((r) => r.clearedAt === null)).toHaveLength(1);
    expect(seen.find((r) => r.clearedAt === null)!.forced).toBe('ARRIVED');
  });

  it('resolves `Until appt` to the stop’s own deadline', async () => {
    const seen = await rolledBack(async (tx) => {
      const stop = await aStop(tx);
      const result = await setOverride(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        override: input(stop.stopId, { expiry: 'UNTIL_APPT' }),
      });
      return { expiry: result.expiresAtUtc, stop };
    });

    // THE stop's deadline, read back from the row the edit path wrote —
    // not a literal, which is what made this fail on a date change.
    expect(seen.expiry).toBe(seen.stop.apptEndUtc);
    // And the arithmetic the literal used to carry: 14:30 plus the stop's
    // own 30-minute window is 15:00, in the stop's zone, whatever the offset
    // is on the day the suite runs.
    expect(wallTime(seen.expiry!)).toBe('15:00');
  });

  it('converts a CUSTOM wall time through the appointment path', async () => {
    const expiry = await rolledBack(async (tx) => {
      const { stopId } = await aStop(tx);
      const result = await setOverride(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        override: input(stopId, {
          expiry: 'CUSTOM',
          customExpiry: {
            date: tomorrowInDispatchZone(),
            time: { h: 23, min: 0 },
            tz: DISPATCH_TZ,
          },
        }),
      });
      return result.expiresAtUtc;
    });
    // 23:00 in the dispatch zone, whatever that is in UTC on the day. One
    // conversion path, not two — asserted by reading it back through the
    // zone rather than by pasting the offset.
    expect(wallTime(expiry!)).toBe('23:00');
    expect(expiry!.endsWith('Z')).toBe(true);
  });

  it('refuses an expiry already in the past', async () => {
    const outcome = await rolledBack(async (tx) => {
      const { stopId } = await aStop(tx);
      await setOverride(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        override: input(stopId, {
          expiry: 'CUSTOM',
          customExpiry: { date: { y: 2020, m: 1, d: 1 }, time: { h: 9, min: 0 }, tz: DISPATCH_TZ },
        }),
      });
      return 'accepted';
    }).catch((e: unknown) => e);
    expect(outcome).toBeInstanceOf(OverrideError);
  });

  it('shows the forced status while the engine keeps computing the real one', async () => {
    const seen = await rolledBack(async (tx) => {
      const { truckId, stopId } = await aStop(tx);
      await setOverride(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        override: input(stopId, { forcedStatus: 'ARRIVED' }),
      });
      const rows = applyStatus(
        parseFleetRows(await tx.execute(LATEST_POSITION_SQL)),
        { ...STATUS_DEFAULTS, dispatchTz: DISPATCH_TZ },
        new Date(),
      );
      return rows.find((r) => r.id === truckId);
    });

    expect(seen?.status).toBe('ARRIVED');
    // Both, because the detail block renders them adjacent (§9.5).
    expect(seen?.computed).not.toBe('ARRIVED');
    expect(seen?.override?.reason).toBe('RECEIVER_CONFIRMED_DETENTION');
  });

  it('`Clear now` returns the row to its computed status', async () => {
    const seen = await rolledBack(async (tx) => {
      const { truckId, stopId } = await aStop(tx);
      await setOverride(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        override: input(stopId),
      });
      await clearOverride(tx as never, { actorUserId: null, clear: { stopId } });
      const rows = applyStatus(
        parseFleetRows(await tx.execute(LATEST_POSITION_SQL)),
        { ...STATUS_DEFAULTS, dispatchTz: DISPATCH_TZ },
        new Date(),
      );
      const row = rows.find((r) => r.id === truckId);
      return { status: row?.status, computed: row?.computed, override: row?.override };
    });
    expect(seen.override).toBeNull();
    expect(seen.status).toBe(seen.computed);
  });

  it('writes an audit entry for the set and another for the clear', async () => {
    const entries = await rolledBack(async (tx) => {
      const { stopId } = await aStop(tx);
      await setOverride(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        override: input(stopId),
      });
      await clearOverride(tx as never, { actorUserId: null, clear: { stopId } });
      return tx
        .select({ entity: auditLog.entity, before: auditLog.before, after: auditLog.after })
        .from(auditLog)
        .where(eq(auditLog.entityId, stopId));
    });
    const overrideEntries = entries.filter((e) => e.entity === 'override');
    expect(overrideEntries).toHaveLength(2);

    /**
     * Asserted as a SET, not as a sequence.
     *
     * This used to read `overrideEntries[1].after.cleared`, and that was
     * never sound: the select has no ORDER BY, and ordering by `created_at`
     * would not have saved it either — `now()` is transaction-stable in
     * Postgres, so both rows written inside one transaction carry the
     * IDENTICAL timestamp. There is no column that puts these two in order.
     * It passed for a year on the planner's goodwill and failed the first
     * time something upstream changed the timing.
     *
     * What the test actually means is "one entry set it and one cleared it",
     * and that is a property of the pair, not of their order.
     */
    const cleared = overrideEntries.filter(
      (e) => (e.after as { cleared?: boolean } | null)?.cleared === true,
    );
    expect(cleared).toHaveLength(1);
    expect(overrideEntries.filter((e) => e.before === null)).toHaveLength(1);
  });
});

withDb('an edit writes only the fields the form owns (§12.23)', () => {
  it('saving an override leaves every appointment column untouched', async () => {
    /**
     * The `broker` wipe: the modal nulled a column because the column existed
     * and the form did not render it. An override is a different table, and
     * writing one must not touch the stop at all — least of all the
     * appointment, which is the field the whole product is about.
     */
    const seen = await rolledBack(async (tx) => {
      const { stopId } = await aStop(tx);
      const columns = () =>
        tx
          .select({
            startUtc: stops.appointmentStartUtc,
            endUtc: stops.appointmentEndUtc,
            tz: stops.appointmentTz,
            type: stops.appointmentType,
            arrivedAt: stops.arrivedAt,
            departedAt: stops.departedAt,
            note: stops.dispatcherNote,
            city: stops.city,
          })
          .from(stops)
          .where(eq(stops.id, stopId));

      const before = await columns();
      await setOverride(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        override: input(stopId, { forcedStatus: 'NO_APPT' }),
      });
      const afterSet = await columns();
      await clearOverride(tx as never, { actorUserId: null, clear: { stopId } });
      return { before: before[0], afterSet: afterSet[0], afterClear: (await columns())[0] };
    });

    expect(seen.afterSet).toEqual(seen.before);
    expect(seen.afterClear).toEqual(seen.before);
    // And the appointment is genuinely there to have been damaged.
    expect(seen.before?.startUtc).not.toBeNull();
  });
});
