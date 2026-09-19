import { describe, expect, it, vi } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { assignments, loads, overrides, stopRoutes, stops, auditLog } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import { makeDispatcher, makeDriver, makeTruck } from '@/test/fleet';
import { LATEST_POSITION_SQL, parseFleetRows } from './fleet-query';
import { AppointmentTimeError } from '@/lib/appointment';
import { StopEdit } from '@/lib/stop-edit';
import { applyReassignment, previewReassignment, StalePreviewError } from './reassign';
import { saveStopEdit } from './stop-edit';
import type { Tx } from './audit';

/**
 * The two-sided reassignment and the edit modal's save, against the real
 * database, inside transactions that always roll back.
 *
 * The property that matters is the one the design states twice: there is
 * never a window where one truck holds the driver and the other still claims
 * them. It cannot be observed from outside a transaction, so it is asserted
 * from inside one.
 */

const DISPATCH_TZ = 'America/Chicago';
const withDb = describeDb;

/**
 * The two trucks and two drivers these tests move around.
 *
 * This was thirty lines of defence against a shared database: take the two
 * lowest-numbered active trucks and the two first drivers, ORDER BY so the
 * planner could not change which ones, then end any open assignment on them
 * inside the rolling-back transaction. All of it because the fixtures assumed
 * the first two drivers were free, which stopped being true the moment a
 * dispatcher used /assignments — four reassignment tests then failed with
 * "The assignment changed while the confirmation was open", the stale-preview
 * guard doing its job against a fixture with no right to those drivers.
 *
 * The database is empty now, so the trucks and drivers are simply made
 * (§12.32). Nothing to order, nothing to free, nothing to collide with.
 */
const fixtures = async (tx: Tx) => ({
  trucks: [await makeTruck(tx), await makeTruck(tx)],
  drivers: [await makeDriver(tx), await makeDriver(tx)],
});

const openDriverFor = async (tx: Tx, truckId: string) => {
  const rows = await tx
    .select({ driverId: assignments.driverId })
    .from(assignments)
    .where(and(eq(assignments.truckId, truckId), isNull(assignments.endedAt)));
  return rows[0]?.driverId ?? null;
};

withDb('reassignment', () => {
  it('moves the driver and closes the losing side in one transaction', async () => {
    const seen = await rolledBack(async (tx) => {
      const { trucks: t, drivers: d } = await fixtures(tx);
      // Driver starts on truck A.
      await applyReassignment(tx, {
        truckId: t[0]!.id, driverId: d[0]!.id, actorUserId: null,
      });
      const preview = await previewReassignment(tx, { truckId: t[1]!.id, driverId: d[0]!.id });
      await applyReassignment(tx, {
        truckId: t[1]!.id,
        driverId: d[0]!.id,
        actorUserId: null,
        previewToken: preview.token,
      });
      return {
        losing: await openDriverFor(tx, t[0]!.id),
        gaining: await openDriverFor(tx, t[1]!.id),
        driverId: d[0]!.id,
        preview,
      };
    });

    // Both sides, together: never one truck holding the driver while the
    // other still claims them.
    expect(seen.losing).toBeNull();
    expect(seen.gaining).toBe(seen.driverId);
    expect(seen.preview.losing?.driverId).toBe(seen.driverId);
  });

  it('previews from the server, including the losing truck the client cannot know', async () => {
    const preview = await rolledBack(async (tx) => {
      const { trucks: t, drivers: d } = await fixtures(tx);
      await applyReassignment(tx, { truckId: t[0]!.id, driverId: d[0]!.id, actorUserId: null });
      return previewReassignment(tx, { truckId: t[1]!.id, driverId: d[0]!.id });
    });
    expect(preview.losing).not.toBeNull();
    expect(preview.summary).toMatch(/Reassigns .* from .* to /);
    // Nothing is sent to anyone, and the dialog says so.
    expect(preview.note).toMatch(/notifications aren/i);
  });

  it('refuses a confirmation whose preview went stale', async () => {
    const outcome = await rolledBack(async (tx) => {
      const { trucks: t, drivers: d } = await fixtures(tx);
      await applyReassignment(tx, { truckId: t[0]!.id, driverId: d[0]!.id, actorUserId: null });
      const stale = await previewReassignment(tx, { truckId: t[1]!.id, driverId: d[0]!.id });

      // Someone else moves the driver away while the dialog is open.
      await applyReassignment(tx, { truckId: t[0]!.id, driverId: d[1]!.id, actorUserId: null });
      await applyReassignment(tx, { truckId: t[1]!.id, driverId: d[0]!.id, actorUserId: null,
        previewToken: stale.token });
      return 'accepted';
    }).catch((error: unknown) => error);

    expect(outcome).toBeInstanceOf(StalePreviewError);
  });

  it('refuses a two-sided move that was never confirmed at all', async () => {
    // Taking a driver off another truck without a confirmed preview is the
    // one case the design names twice. No token, no move.
    const outcome = await rolledBack(async (tx) => {
      const { trucks: t, drivers: d } = await fixtures(tx);
      await applyReassignment(tx, { truckId: t[0]!.id, driverId: d[0]!.id, actorUserId: null });
      await applyReassignment(tx, { truckId: t[1]!.id, driverId: d[0]!.id, actorUserId: null });
      return 'accepted';
    }).catch((error: unknown) => error);
    expect(outcome).toBeInstanceOf(StalePreviewError);
  });

  it('does nothing when the driver is already the one asked for', async () => {
    const result = await rolledBack(async (tx) => {
      const { trucks: t, drivers: d } = await fixtures(tx);
      await applyReassignment(tx, { truckId: t[0]!.id, driverId: d[0]!.id, actorUserId: null });
      return applyReassignment(tx, { truckId: t[0]!.id, driverId: d[0]!.id, actorUserId: null });
    });
    expect(result.changed).toBe(false);
  });
});

withDb('the edit modal save', () => {
  const edit = (over: Partial<StopEdit> & { truckId: string }) =>
    StopEdit.parse({
      stopId: null,
      loadNumber: 'TEST-8841',
      loadStatus: 'DISPATCHED',
      stopType: 'DEL',
      addressLine: '1400 Laraway Road',
      city: 'New Lenox',
      state: 'IL',
      zip: '60451',
      appointment: {
        type: 'APPT',
        date: { y: 2026, m: 9, d: 18 },
        time: { h: 14, min: 30 },
        tz: 'America/Chicago',
        windowMinutes: 30,
      },
      dispatcherNote: null,
      ...over,
    });

  it('creates the load and its stop when the truck has none', async () => {
    const saved = await rolledBack(async (tx) => {
      const { trucks: t } = await fixtures(tx);
      await tx.delete(loads).where(eq(loads.truckId, t[0]!.id));
      const result = await saveStopEdit(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        edit: edit({ truckId: t[0]!.id }),
      });
      const [stop] = await tx
        .select({ apptUtc: stops.appointmentStartUtc, tz: stops.appointmentTz })
        .from(stops)
        .where(eq(stops.id, result.stopId));
      return { result, stop };
    });

    // 14:30 at the receiver, stored as the instant 14:30 happens there.
    expect(saved.result.appointment?.startUtc).toBe('2026-09-18T19:30:00.000Z');
    expect(saved.stop?.tz).toBe('America/Chicago');
    expect(saved.stop?.apptUtc?.toISOString()).toBe('2026-09-18T19:30:00.000Z');
  });

  /**
   * §12.21, and the reason this is a test rather than a button check: the
   * column was made nullable, the modal was updated — and the shared Zod
   * schema kept `.min(1)`, so an empty load number was still refused at the
   * boundary and the save never reached the database. The rule lives in three
   * places and all three are asserted here.
   */
  describe('an empty load number (§12.21)', () => {
    it('passes the shared schema, which is what the route re-parses', () => {
      const parsed = StopEdit.safeParse({
        stopId: null,
        truckId: '00000000-0000-4000-8000-000000000000',
        loadNumber: '',
        loadStatus: 'AVAILABLE',
        stopType: 'DEL',
        addressLine: null,
        city: null,
        state: null,
        zip: null,
        appointment: null,
        dispatcherNote: null,
      });
      expect(parsed.success).toBe(true);
      // NULL, never '' — one way to say "not known yet".
      expect(parsed.success && parsed.data.loadNumber).toBeNull();
    });

    /**
     * The layer that was still standing after two fixes: `.nullable()` without
     * `.optional()`. The modal always sends the key, so only an API client
     * ever hit it — with `400 Required`, which is not a thing "permanently
     * optional" can mean.
     */
    it('accepts the key being ABSENT, not merely empty', () => {
      const parsed = StopEdit.safeParse({
        stopId: null,
        truckId: '00000000-0000-4000-8000-000000000000',
        // loadNumber deliberately not present
        loadStatus: 'AVAILABLE',
        stopType: 'DEL',
        addressLine: null,
        city: null,
        state: null,
        zip: null,
        appointment: null,
        dispatcherNote: null,
      });
      expect(parsed.success).toBe(true);
      // undefined, NOT null: absent means "leave it alone", and null means
      // "clear it". Collapsing them would be §12.23's broker wipe.
      expect(parsed.success && parsed.data.loadNumber).toBeUndefined();
    });

    it('distinguishes all four ways the field can arrive', () => {
      const base = {
        stopId: null,
        truckId: '00000000-0000-4000-8000-000000000000',
        loadStatus: 'AVAILABLE' as const,
        stopType: 'DEL' as const,
        addressLine: null,
        city: null,
        state: null,
        zip: null,
        appointment: null,
        dispatcherNote: null,
      };
      const of = (over: Record<string, unknown>) => {
        const r = StopEdit.safeParse({ ...base, ...over });
        return r.success ? r.data.loadNumber : 'REJECTED';
      };
      expect(of({ loadNumber: 'LD-4417' })).toBe('LD-4417');
      expect(of({ loadNumber: '   LD-4417  ' })).toBe('LD-4417');
      expect(of({ loadNumber: '' })).toBeNull();
      expect(of({ loadNumber: '   ' })).toBeNull();
      expect(of({ loadNumber: null })).toBeNull();
      expect(of({})).toBeUndefined();
    });

    it('leaves a stored number alone when the key is absent, and clears it when null', async () => {
      const seen = await rolledBack(async (tx) => {
        const t = await fixtures(tx);
        const created = await saveStopEdit(tx as never, {
          actorUserId: null,
          dispatchTz: DISPATCH_TZ,
          edit: edit({ truckId: t.trucks[0]!.id, loadNumber: 'LD-4417' }),
        });
        const read = async () =>
          (
            await tx
              .select({ number: loads.loadNumber })
              .from(loads)
              .where(eq(loads.id, created.loadId))
          )[0]?.number ?? null;

        // The key omitted entirely — an API client that only wanted to change
        // the status. The number must survive.
        const { loadNumber: _omitted, ...withoutKey } = edit({
          truckId: t.trucks[0]!.id,
          stopId: created.stopId,
        });
        await saveStopEdit(tx as never, {
          actorUserId: null,
          dispatchTz: DISPATCH_TZ,
          edit: StopEdit.parse(withoutKey),
        });
        const afterOmit = await read();

        // And null, which IS a request to clear it.
        await saveStopEdit(tx as never, {
          actorUserId: null,
          dispatchTz: DISPATCH_TZ,
          edit: edit({ truckId: t.trucks[0]!.id, stopId: created.stopId, loadNumber: null }),
        });
        return { afterOmit, afterNull: await read() };
      });

      expect(seen.afterOmit).toBe('LD-4417');
      expect(seen.afterNull).toBeNull();
    });

    it('is stored as NULL, not as an empty string', async () => {
      const saved = await rolledBack(async (tx) => {
        const { trucks: t } = await fixtures(tx);
        await tx.delete(loads).where(eq(loads.truckId, t[0]!.id));
        const result = await saveStopEdit(tx as never, {
          actorUserId: null,
          dispatchTz: DISPATCH_TZ,
          edit: edit({ truckId: t[0]!.id, loadNumber: '' }),
        });
        const [load] = await tx
          .select({ number: loads.loadNumber })
          .from(loads)
          .where(eq(loads.id, result.loadId));
        return load?.number;
      });
      expect(saved).toBeNull();
    });

    it('survives a round trip through the fleet query as null', async () => {
      const seen = await rolledBack(async (tx) => {
        const { trucks: t } = await fixtures(tx);
        await tx.delete(loads).where(eq(loads.truckId, t[0]!.id));
        await saveStopEdit(tx as never, {
          actorUserId: null,
          dispatchTz: DISPATCH_TZ,
          edit: edit({ truckId: t[0]!.id, loadNumber: '' }),
        });
        const rows = parseFleetRows(await tx.execute(LATEST_POSITION_SQL));
        return rows.find((r) => r.id === t[0]!.id)?.nextStop;
      });
      // The row schema must accept it too, or the console throws on render.
      expect(seen).not.toBeUndefined();
      expect(seen?.loadNumber).toBeNull();
    });

    it('can be given a number later, and taken away again', async () => {
      const values = await rolledBack(async (tx) => {
        const { trucks: t } = await fixtures(tx);
        await tx.delete(loads).where(eq(loads.truckId, t[0]!.id));
        const created = await saveStopEdit(tx as never, {
          actorUserId: null,
          dispatchTz: DISPATCH_TZ,
          edit: edit({ truckId: t[0]!.id, loadNumber: '' }),
        });
        const read = async () =>
          (
            await tx
              .select({ number: loads.loadNumber })
              .from(loads)
              .where(eq(loads.id, created.loadId))
          )[0]?.number ?? null;

        const empty = await read();
        await saveStopEdit(tx as never, {
          actorUserId: null,
          dispatchTz: DISPATCH_TZ,
          edit: edit({ truckId: t[0]!.id, stopId: created.stopId, loadNumber: 'VL-99120' }),
        });
        const given = await read();
        await saveStopEdit(tx as never, {
          actorUserId: null,
          dispatchTz: DISPATCH_TZ,
          // Whitespace is not a load number either.
          edit: edit({ truckId: t[0]!.id, stopId: created.stopId, loadNumber: '   ' }),
        });
        return { empty, given, removed: await read() };
      });
      expect(values).toEqual({ empty: null, given: 'VL-99120', removed: null });
    });
  });

  describe('the dispatcher note (§12.53)', () => {
    /**
     * The note is the field whose own label promises it is "visible to the
     * next shift". It was the third column to be wiped by a write that listed
     * a field the form had not loaded — after `loads.broker` (§12.23) and the
     * load number's four layers (§12.21).
     *
     * Every test here asserts something does NOT happen, because the failure
     * is silent by construction: the dispatcher who destroys the note is the
     * one person who cannot see that it was there.
     */
    const readNote = async (tx: Tx, stopId: string) =>
      (
        await tx
          .select({
            note: stops.dispatcherNote,
            by: stops.noteBy,
            at: stops.noteAt,
          })
          .from(stops)
          .where(eq(stops.id, stopId))
      )[0] ?? null;

    it('survives a save that never mentions it', async () => {
      const seen = await rolledBack(async (tx) => {
        const t = await fixtures(tx);
        const created = await saveStopEdit(tx as never, {
          actorUserId: null,
          dispatchTz: DISPATCH_TZ,
          edit: edit({
            truckId: t.trucks[0]!.id,
            dispatcherNote: 'Call the receiver before 14:00 — gate code 4417.',
          }),
        });

        // An API client changing only the load status, exactly as the load
        // number's own test does. The note must survive untouched.
        const { dispatcherNote: _omitted, ...withoutKey } = edit({
          truckId: t.trucks[0]!.id,
          stopId: created.stopId,
          loadStatus: 'DELIVERED',
        });
        await saveStopEdit(tx as never, {
          actorUserId: null,
          dispatchTz: DISPATCH_TZ,
          edit: StopEdit.parse(withoutKey),
        });
        return readNote(tx, created.stopId);
      });

      expect(seen?.note).toBe('Call the receiver before 14:00 — gate code 4417.');
    });

    /**
     * The bug as the dispatcher met it. The modal initialised its note box to
     * `''` and never loaded the stored value, so the box was empty, the
     * dispatcher had nothing to preserve, and the save sent an explicit null.
     * This is the shape of that request.
     */
    it('is cleared by an explicit null, which is the request the old modal sent', async () => {
      const seen = await rolledBack(async (tx) => {
        const t = await fixtures(tx);
        const created = await saveStopEdit(tx as never, {
          actorUserId: null,
          dispatchTz: DISPATCH_TZ,
          edit: edit({ truckId: t.trucks[0]!.id, dispatcherNote: 'keep me' }),
        });
        await saveStopEdit(tx as never, {
          actorUserId: null,
          dispatchTz: DISPATCH_TZ,
          edit: edit({
            truckId: t.trucks[0]!.id,
            stopId: created.stopId,
            dispatcherNote: null,
          }),
        });
        return readNote(tx, created.stopId);
      });

      // Clearing is a real intent and stays available. What changed is that it
      // now takes saying so.
      expect(seen?.note).toBeNull();
      expect(seen?.by).toBeNull();
      expect(seen?.at).toBeNull();
    });

    /**
     * The half that a load of the stored value creates on its own: the modal
     * now sends the SAME note back on every unrelated save. Re-stamping
     * `note_by` and `note_at` would rewrite who said it and when, which is
     * history changing with nothing behind it — §12.45's rename, in a column.
     */
    it('does not re-stamp authorship when the text did not change', async () => {
      /**
       * TWO actors, and the assertion is on `note_by`, not on `note_at`.
       *
       * The first version of this test asserted the timestamp and passed
       * against the broken code — `now()` in Postgres is the TRANSACTION's
       * start time, and `rolledBack` runs both saves in one transaction, so
       * the two stamps were identical whether or not the column was rewritten.
       * A test that cannot fail is not evidence (§12.38).
       */
      const seen = await rolledBack(async (tx) => {
        const t = await fixtures(tx);
        const wrote = await makeDispatcher(tx, 'Note Author');
        const saved = await makeDispatcher(tx, 'Unrelated Saver');

        const created = await saveStopEdit(tx as never, {
          actorUserId: wrote.id,
          dispatchTz: DISPATCH_TZ,
          edit: edit({ truckId: t.trucks[0]!.id, dispatcherNote: 'Dock 12 after 18:00.' }),
        });
        const first = await readNote(tx, created.stopId);

        // Somebody else saves the stop for an unrelated reason. The modal now
        // loads the note, so it sends the same text back verbatim.
        await saveStopEdit(tx as never, {
          actorUserId: saved.id,
          dispatchTz: DISPATCH_TZ,
          edit: edit({
            truckId: t.trucks[0]!.id,
            stopId: created.stopId,
            loadStatus: 'DELIVERED',
            dispatcherNote: 'Dock 12 after 18:00.',
          }),
        });
        return { first, second: await readNote(tx, created.stopId), wrote, saved };
      });

      expect(seen.second?.note).toBe('Dock 12 after 18:00.');
      // Still attributed to whoever actually wrote it.
      expect(seen.second?.by).toBe(seen.wrote.id);
      expect(seen.second?.by).not.toBe(seen.saved.id);
      expect(seen.first?.by).toBe(seen.wrote.id);
    });

    it('records a genuine change, and says so in the audit row', async () => {
      const seen = await rolledBack(async (tx) => {
        const t = await fixtures(tx);
        const created = await saveStopEdit(tx as never, {
          actorUserId: null,
          dispatchTz: DISPATCH_TZ,
          edit: edit({ truckId: t.trucks[0]!.id, dispatcherNote: 'first' }),
        });
        await saveStopEdit(tx as never, {
          actorUserId: null,
          dispatchTz: DISPATCH_TZ,
          edit: edit({
            truckId: t.trucks[0]!.id,
            stopId: created.stopId,
            dispatcherNote: 'second',
          }),
        });
        const rows = await tx
          .select({ after: auditLog.after })
          .from(auditLog)
          .where(eq(auditLog.entityId, created.stopId));
        return { note: (await readNote(tx, created.stopId))?.note, rows };
      });

      expect(seen.note).toBe('second');
      const wrote = seen.rows.filter(
        (r) => (r.after as { dispatcherNote?: string | null }).dispatcherNote !== undefined,
      );
      // Two saves, two genuine changes, two audit rows carrying the note.
      expect(wrote).toHaveLength(2);
    });

    it('comes back through the fleet query, so the modal can load it', async () => {
      const note = await rolledBack(async (tx) => {
        const t = await fixtures(tx);
        await saveStopEdit(tx as never, {
          actorUserId: null,
          dispatchTz: DISPATCH_TZ,
          edit: edit({ truckId: t.trucks[0]!.id, dispatcherNote: 'Gate code 4417.' }),
        });
        const raw = await tx.execute(LATEST_POSITION_SQL);
        const rows = parseFleetRows(raw as never);
        return rows.find((r) => r.id === t.trucks[0]!.id)?.nextStop?.dispatcherNote ?? null;
      });

      // A note the board cannot read is a note nobody wrote.
      expect(note).toBe('Gate code 4417.');
    });
  });

  describe('a re-geocode clears the cached route (§12.54)', () => {
    /**
     * The route cache is keyed to the stop's coordinates. A stop that moves
     * leaves a row describing a lane to somewhere else.
     *
     * It was already inert — the fleet query joins on the coordinates — but
     * one survived anyway, because the routing sweep's 0.5-mile floor blocked
     * the overwrite that would have replaced it. Two defects holding each
     * other up. This deletes at the source so it does not depend on a later
     * sweep being able to run.
     */
    const cacheFor = async (tx: Tx, stopId: string) =>
      tx.select().from(stopRoutes).where(eq(stopRoutes.stopId, stopId));

    it('deletes a route measured to the address the stop no longer has', async () => {
      const seen = await rolledBack(async (tx) => {
        const { trucks: t } = await fixtures(tx);
        const created = await saveStopEdit(tx as never, {
          actorUserId: null,
          dispatchTz: DISPATCH_TZ,
          edit: edit({ truckId: t[0]!.id }),
        });

        // A route to where the stop was, exactly as the sweep would write it.
        await tx.insert(stopRoutes).values({
          stopId: created.stopId,
          routedMiles: 1387.96,
          routedDurationS: 77762,
          fromLat: 40.94653,
          fromLng: -77.708793,
          straightAtRouteMiles: 1198.91,
          laneRatio: 1.1577,
          stopLat: 32.72110135719,
          stopLng: -96.874451650074,
          snapFromM: 0.664,
          snapToM: 3.532,
          provider: 'test',
        });
        const before = await cacheFor(tx, created.stopId);

        // Re-point the stop. A real address, so the geocode actually runs.
        await saveStopEdit(tx as never, {
          actorUserId: null,
          dispatchTz: DISPATCH_TZ,
          edit: edit({
            truckId: t[0]!.id,
            stopId: created.stopId,
            addressLine: '450 E Arthur Gardner',
            city: 'Hazleton',
            state: 'PA',
            zip: '18201',
          }),
        });
        return { before, after: await cacheFor(tx, created.stopId) };
      });

      expect(seen.before).toHaveLength(1);
      expect(seen.after).toEqual([]);
    });

    it('leaves the cache alone when the address did not change', async () => {
      // §12.23: an edit writes only what it owns. A note change is not a
      // reason to throw away a route that cost a call.
      const seen = await rolledBack(async (tx) => {
        const { trucks: t } = await fixtures(tx);
        const created = await saveStopEdit(tx as never, {
          actorUserId: null,
          dispatchTz: DISPATCH_TZ,
          edit: edit({ truckId: t[0]!.id }),
        });
        // Pinned rather than read back: whether the fixture address geocodes
        // is not what this test is about, and a null would fail it for the
        // wrong reason.
        await tx
          .update(stops)
          .set({ lat: 41.525, lng: -88.0817 })
          .where(eq(stops.id, created.stopId));
        await tx.insert(stopRoutes).values({
          stopId: created.stopId,
          routedMiles: 40,
          routedDurationS: 2400,
          fromLat: 41.8781,
          fromLng: -87.6298,
          straightAtRouteMiles: 33,
          laneRatio: 1.21,
          stopLat: 41.525,
          stopLng: -88.0817,
          snapFromM: 1,
          snapToM: 2,
          provider: 'test',
        });

        await saveStopEdit(tx as never, {
          actorUserId: null,
          dispatchTz: DISPATCH_TZ,
          edit: edit({
            truckId: t[0]!.id,
            stopId: created.stopId,
            dispatcherNote: 'gate code 4417',
          }),
        });
        return cacheFor(tx, created.stopId);
      });

      expect(seen).toHaveLength(1);
    });
  });

  it('refuses an appointment in the hour that does not exist', async () => {
    const outcome = await rolledBack(async (tx) => {
      const { trucks: t } = await fixtures(tx);
      await saveStopEdit(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        edit: edit({
          truckId: t[0]!.id,
          appointment: {
            type: 'APPT',
            // 2026-03-08 02:30 America/Chicago: the clocks jump that hour.
            date: { y: 2026, m: 3, d: 8 },
            time: { h: 2, min: 30 },
            tz: 'America/Chicago',
            windowMinutes: null,
          },
        }),
      });
      return 'accepted';
    }).catch((error: unknown) => error);

    expect(outcome).toBeInstanceOf(AppointmentTimeError);
  });

  it('writes an audit row naming the stop, with before and after', async () => {
    const rows = await rolledBack(async (tx) => {
      const { trucks: t } = await fixtures(tx);
      const created = await saveStopEdit(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        edit: edit({ truckId: t[0]!.id }),
      });
      // Editing it again gives the audit row a `before`.
      await saveStopEdit(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        edit: edit({ truckId: t[0]!.id, stopId: created.stopId, zip: '60452' }),
      });
      return tx
        .select({ entity: auditLog.entity, entityId: auditLog.entityId, before: auditLog.before, after: auditLog.after })
        .from(auditLog)
        .where(eq(auditLog.entityId, created.stopId));
    });

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.entity === 'stop')).toBe(true);
    const second = rows.find((r) => r.before !== null);
    expect((second?.before as { zip: string }).zip).toBe('60451');
    expect((second?.after as { zip: string }).zip).toBe('60452');
  });

  it('saves the stop and the two-sided move in the same transaction', async () => {
    const seen = await rolledBack(async (tx) => {
      const { trucks: t, drivers: d } = await fixtures(tx);
      await applyReassignment(tx, { truckId: t[0]!.id, driverId: d[0]!.id, actorUserId: null });
      const preview = await previewReassignment(tx, { truckId: t[1]!.id, driverId: d[0]!.id });
      const result = await saveStopEdit(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        edit: edit({
          truckId: t[1]!.id,
          driverId: d[0]!.id,
          previewToken: preview.token,
        }),
      });
      return {
        result,
        losing: await openDriverFor(tx, t[0]!.id),
        gaining: await openDriverFor(tx, t[1]!.id),
        driverId: d[0]!.id,
      };
    });

    expect(seen.result.reassignment).not.toBeNull();
    expect(seen.losing).toBeNull();
    expect(seen.gaining).toBe(seen.driverId);
  });
});

/* -------------------------------------------------------------------------
 * §12.24 — the geocode on save
 * ---------------------------------------------------------------------- */

withDb('the forward geocode (§12.24)', () => {
  const GRAND_FORKS = { lat: 47.936987, lng: -97.057369 };

  /** A Census locations/address response, shaped as the live service returns one. */
  const located = () =>
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            result: {
              addressMatches: [
                {
                  /**
                   * The SAME street the fixture types. It read
                   * `1804 N WASHINGTON ST` against a typed
                   * `1804 Vitest Fixture Street` — a pairing no real response
                   * could produce, which only became visible once §12.55
                   * started comparing the two.
                   */
                  matchedAddress: '1804 VITEST FIXTURE ST, GRAND FORKS, ND, 58203',
                  // x is LONGITUDE. Backwards puts the fleet in the Indian Ocean.
                  coordinates: { x: GRAND_FORKS.lng, y: GRAND_FORKS.lat },
                  tigerLine: { side: 'R', tigerLineId: '637799318' },
                  addressComponents: {
                    fromAddress: '1800',
                    toAddress: '1818',
                    city: 'GRAND FORKS',
                    state: 'ND',
                    zip: '58203',
                  },
                },
              ],
            },
          }),
          { status: 200 },
        ),
    );

  const unlocatable = () =>
    vi.fn(
      async () =>
        new Response(JSON.stringify({ result: { addressMatches: [] } }), { status: 200 }),
    );

  const edit = (over: Partial<StopEdit> & { truckId: string }) =>
    StopEdit.parse({
      stopId: null,
      loadNumber: 'TEST-GEO',
      loadStatus: 'DISPATCHED',
      stopType: 'DEL',
      addressLine: '1804 Vitest Fixture Street',
      city: 'Grand Forks',
      state: 'ND',
      zip: '58203',
      appointment: {
        type: 'APPT',
        date: { y: 2026, m: 9, d: 18 },
        time: { h: 14, min: 30 },
        tz: 'America/Chicago',
        windowMinutes: 30,
      },
      dispatcherNote: null,
      ...over,
    });

  it('stores the coordinates, the precision and what was matched', async () => {
    const saved = await rolledBack(async (tx) => {
      const { trucks: t } = await fixtures(tx);
      const fetchImpl = located();
      const result = await saveStopEdit(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        edit: edit({ truckId: t[0]!.id }),
        fetchImpl,
      });
      const [stop] = await tx
        .select({
          lat: stops.lat,
          lng: stops.lng,
          precision: stops.geocodePrecision,
          confidence: stops.geocodeConfidence,
          matched: stops.geocodedAddress,
          at: stops.geocodedAt,
        })
        .from(stops)
        .where(eq(stops.id, result.stopId));
      return { stop, warnings: result.warnings, calls: fetchImpl.mock.calls.length };
    });

    expect(saved.calls).toBe(1);
    expect(saved.stop?.lat).toBeCloseTo(GRAND_FORKS.lat, 4);
    expect(saved.stop?.lng).toBeCloseTo(GRAND_FORKS.lng, 4);
    // Renamed from `rooftop`: Census interpolates along a TIGER street
    // segment and never returns a parcel point (§12.24).
    expect(saved.stop?.precision).toBe('street');
    // The signal we actually had, not a grade borrowed from another provider.
    expect(saved.stop?.confidence).toBe('census:in-range');
    // Census normalises to upper case and USPS abbreviations.
    expect(saved.stop?.matched).toContain('GRAND FORKS');
    expect(saved.stop?.at).not.toBeNull();
    expect(saved.warnings).toEqual([]);
  });

  /**
   * The rule that stops this costing money on every save. It rots silently if
   * nobody asserts the CALL COUNT — the coordinates would still be right.
   */
  it('spends nothing when only the appointment time changed', async () => {
    const calls = await rolledBack(async (tx) => {
      const { trucks: t } = await fixtures(tx);
      const fetchImpl = located();
      const created = await saveStopEdit(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        edit: edit({ truckId: t[0]!.id }),
        fetchImpl,
      });
      const afterCreate = fetchImpl.mock.calls.length;

      await saveStopEdit(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        edit: edit({
          truckId: t[0]!.id,
          stopId: created.stopId,
          appointment: {
            type: 'APPT',
            date: { y: 2026, m: 9, d: 18 },
            // Same address, different hour.
            time: { h: 16, min: 0 },
            tz: 'America/Chicago',
            windowMinutes: 30,
          },
        }),
        fetchImpl,
      });
      return { afterCreate, total: fetchImpl.mock.calls.length };
    });

    expect(calls.afterCreate).toBe(1);
    expect(calls.total).toBe(1);
  });

  it('spends one call when an address field actually changed', async () => {
    const total = await rolledBack(async (tx) => {
      const { trucks: t } = await fixtures(tx);
      const fetchImpl = located();
      const created = await saveStopEdit(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        edit: edit({ truckId: t[0]!.id }),
        fetchImpl,
      });
      await saveStopEdit(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        edit: edit({
          truckId: t[0]!.id,
          stopId: created.stopId,
          addressLine: '2100 South Columbia Road',
        }),
        fetchImpl,
      });
      return fetchImpl.mock.calls.length;
    });
    expect(total).toBe(2);
  });

  it('does not re-geocode when the address was only retyped differently', async () => {
    const total = await rolledBack(async (tx) => {
      const { trucks: t } = await fixtures(tx);
      const fetchImpl = located();
      const created = await saveStopEdit(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        edit: edit({ truckId: t[0]!.id }),
        fetchImpl,
      });
      await saveStopEdit(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        edit: edit({
          truckId: t[0]!.id,
          stopId: created.stopId,
          // Same place, typed by a different dispatcher: different case,
          // extra spaces, a ZIP+4. Must normalise to the SAME key as the
          // base fixture above, or this asserts nothing.
          addressLine: '1804   vitest   FIXTURE street',
          zip: '58203-4412',
        }),
        fetchImpl,
      });
      return fetchImpl.mock.calls.length;
    });
    expect(total).toBe(1);
  });

  /** A geocode that fails is not a save that fails. */
  it('saves the stop with null coordinates and warns, rather than refusing', async () => {
    const saved = await rolledBack(async (tx) => {
      const { trucks: t } = await fixtures(tx);
      const result = await saveStopEdit(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        edit: edit({
          truckId: t[0]!.id,
          addressLine: '9999 Nowhere At All Parkway',
          city: 'Xytherium',
          state: 'ZZ',
          zip: '00000',
        }),
        fetchImpl: unlocatable(),
      });
      const [stop] = await tx
        .select({ lat: stops.lat, city: stops.city, precision: stops.geocodePrecision })
        .from(stops)
        .where(eq(stops.id, result.stopId));
      return { stop, warnings: result.warnings };
    });

    // The dispatcher's work is saved and correct. It simply has no ETA.
    expect(saved.stop?.city).toBe('Xytherium');
    expect(saved.stop?.lat).toBeNull();
    expect(saved.stop?.precision).toBeNull();
    expect(saved.warnings).toHaveLength(1);
    expect(saved.warnings[0]?.message).toMatch(/could not be located/i);
  });

  /**
   * Located once, not located now.
   *
   * Since §12.30 this no longer CLEARS the coordinates — it falls back to the
   * new address's ZIP centroid, which is the whole point of the fallback. The
   * property that still matters, and the one this guards, is that the stored
   * coordinates describe the address that is there NOW. Keeping the previous
   * street's point would project an ETA to a place the load is not going.
   */
  it('replaces stale coordinates rather than keeping the old address', async () => {
    const after = await rolledBack(async (tx) => {
      const { trucks: t } = await fixtures(tx);
      const created = await saveStopEdit(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        edit: edit({ truckId: t[0]!.id }),
        fetchImpl: located(),
      });
      await saveStopEdit(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        edit: edit({
          truckId: t[0]!.id,
          stopId: created.stopId,
          addressLine: '9999 Nowhere At All Parkway',
        }),
        fetchImpl: unlocatable(),
      });
      const [stop] = await tx
        .select({ lat: stops.lat, lng: stops.lng, precision: stops.geocodePrecision })
        .from(stops)
        .where(eq(stops.id, created.stopId));
      return stop;
    });

    // Not the street coordinate the first save stored.
    expect(after?.lat).not.toBeCloseTo(GRAND_FORKS.lat, 3);
    // The ZIP centroid for the address as it stands now, honestly labelled.
    expect(after?.precision).toBe('zip');
    expect(after?.lat).not.toBeNull();
  });

  /** §12.23 — an edit writes only the fields the form owns. */
  it('leaves the appointment columns byte-identical when only the address changed', async () => {
    const seen = await rolledBack(async (tx) => {
      const { trucks: t } = await fixtures(tx);
      const created = await saveStopEdit(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        edit: edit({ truckId: t[0]!.id }),
        fetchImpl: located(),
      });
      const columns = {
        start: stops.appointmentStartUtc,
        end: stops.appointmentEndUtc,
        tz: stops.appointmentTz,
        type: stops.appointmentType,
      };
      const [before] = await tx.select(columns).from(stops).where(eq(stops.id, created.stopId));

      await saveStopEdit(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        edit: edit({ truckId: t[0]!.id, stopId: created.stopId, city: 'Fargo' }),
        fetchImpl: located(),
      });
      const [after] = await tx.select(columns).from(stops).where(eq(stops.id, created.stopId));
      return { before, after };
    });

    expect(seen.after?.start?.toISOString()).toBe(seen.before?.start?.toISOString());
    expect(seen.after?.end?.toISOString()).toBe(seen.before?.end?.toISOString());
    expect(seen.after?.tz).toBe(seen.before?.tz);
    expect(seen.after?.type).toBe(seen.before?.type);
  });
});

/* -------------------------------------------------------------------------
 * §12.28 — the override rides inside the save
 * ---------------------------------------------------------------------- */

withDb('the override is part of the save (§12.28)', () => {
  const base = (over: Partial<StopEdit> & { truckId: string }) =>
    StopEdit.parse({
      stopId: null,
      loadNumber: 'TEST-ATOMIC',
      loadStatus: 'DISPATCHED',
      stopType: 'DEL',
      addressLine: '1804 Vitest Fixture Street',
      city: 'Grand Forks',
      state: 'ND',
      zip: '58203',
      appointment: {
        type: 'APPT',
        date: { y: 2026, m: 9, d: 18 },
        time: { h: 14, min: 30 },
        tz: 'America/Chicago',
        windowMinutes: 30,
      },
      dispatcherNote: null,
      ...over,
    });

  const forced = {
    action: 'set' as const,
    forcedStatus: 'LATE' as const,
    reason: 'DRIVER_REPORTED_DELAY' as const,
    reasonNote: null,
    expiry: 'PLUS_4H' as const,
    customExpiry: null,
  };

  it('writes the stop and the override in ONE transaction', async () => {
    const seen = await rolledBack(async (tx) => {
      const { trucks: t } = await fixtures(tx);
      const result = await saveStopEdit(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        edit: base({ truckId: t[0]!.id, override: forced }),
      });
      // Readable INSIDE the transaction is the whole claim: there is no
      // window where the stop exists and the override does not.
      const [row] = await tx
        .select({ forcedStatus: overrides.forcedStatus, clearedAt: overrides.clearedAt })
        .from(overrides)
        .where(eq(overrides.stopId, result.stopId));
      return { stopId: result.stopId, row };
    });
    expect(seen.row?.forcedStatus).toBe('LATE');
    expect(seen.row?.clearedAt).toBeNull();
  });

  /** A new load has no stopId when the request is built. The server fills it. */
  it('attaches the override to a stop that did not exist when it was sent', async () => {
    const attached = await rolledBack(async (tx) => {
      const { trucks: t } = await fixtures(tx);
      await tx.delete(loads).where(eq(loads.truckId, t[0]!.id));
      const result = await saveStopEdit(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        edit: base({ truckId: t[0]!.id, stopId: null, override: forced }),
      });
      const rows = await tx
        .select({ stopId: overrides.stopId })
        .from(overrides)
        .where(eq(overrides.stopId, result.stopId));
      return { stopId: result.stopId, count: rows.length };
    });
    expect(attached.count).toBe(1);
  });

  /**
   * The failure that motivated the change. Before this, the stop save landed
   * and the override request failed separately, leaving a board that
   * disagreed with what the dispatcher intended and an error message on a
   * screen nobody would be reading at 4am.
   */
  it('rolls the STOP back when the override fails', async () => {
    const after = await rolledBack(async (tx) => {
      const { trucks: t } = await fixtures(tx);
      // Created HERE rather than found: a test that needs a stop should make
      // one, not hope the fleet has a suitable row today.
      const created = await saveStopEdit(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        edit: base({ truckId: t[0]!.id, dispatcherNote: 'BEFORE' }),
      });
      const [before] = await tx
        .select({ note: stops.dispatcherNote, id: stops.id })
        .from(stops)
        .where(eq(stops.id, created.stopId));

      let threw = false;
      try {
        await saveStopEdit(tx as never, {
          actorUserId: null,
          dispatchTz: DISPATCH_TZ,
          edit: base({
            truckId: t[0]!.id,
            stopId: before!.id,
            dispatcherNote: 'THIS MUST NOT SURVIVE',
            override: {
              ...forced,
              // An expiry already in the past. server/override.ts refuses it.
              expiry: 'CUSTOM',
              customExpiry: {
                date: { y: 2020, m: 1, d: 1 },
                time: { h: 0, min: 0 },
                tz: 'America/Chicago',
              },
            },
          }),
        });
      } catch {
        threw = true;
      }

      const [now] = await tx
        .select({ note: stops.dispatcherNote })
        .from(stops)
        .where(eq(stops.id, before!.id));
      return { threw, before: before!.note, now: now?.note };
    });

    expect(after.threw).toBe(true);
    // Neither write happened. Not one of them.
    expect(after.now).toBe(after.before);
    expect(after.now).not.toBe('THIS MUST NOT SURVIVE');
  });

  it('clears an override through the same save', async () => {
    const cleared = await rolledBack(async (tx) => {
      const { trucks: t } = await fixtures(tx);
      const created = await saveStopEdit(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        edit: base({ truckId: t[0]!.id, override: forced }),
      });
      await saveStopEdit(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        edit: base({
          truckId: t[0]!.id,
          stopId: created.stopId,
          override: { action: 'clear' },
        }),
      });
      const rows = await tx
        .select({ clearedAt: overrides.clearedAt })
        .from(overrides)
        .where(eq(overrides.stopId, created.stopId));
      return rows;
    });
    expect(cleared).toHaveLength(1);
    expect(cleared[0]?.clearedAt).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------
 * §12.44 — the normalisation, end to end, and the layer under it
 * ---------------------------------------------------------------------- */

/**
 * The point of putting this in the shared schema was that the WIRE gets it,
 * not just the modal. So it is asserted through the same path an API client
 * takes — parse, then save — rather than by calling the normaliser directly.
 */
withDb('state and ZIP normalise on the way to the database (§12.44)', () => {
  const editFor = (truckId: string, over: Record<string, unknown>) => ({
    stopId: null,
    truckId,
    loadNumber: 'LD-1',
    loadStatus: 'DISPATCHED' as const,
    stopType: 'DEL' as const,
    addressLine: '1 Broadway',
    city: 'Chicago',
    state: 'IL',
    zip: '60601',
    appointment: null,
    dispatcherNote: null,
    ...over,
  });

  const savedRow = async (over: Record<string, unknown>) =>
    rolledBack(async (tx) => {
      const { trucks: t } = await fixtures(tx);
      await tx.delete(loads).where(eq(loads.truckId, t[0]!.id));
      // Parsed exactly as the route parses it — this is the contract, not the
      // modal's own trimming.
      const parsed = StopEdit.parse(editFor(t[0]!.id, over));
      const result = await saveStopEdit(tx as never, {
        actorUserId: null,
        dispatchTz: DISPATCH_TZ,
        edit: parsed,
      });
      const [row] = await tx
        .select({ state: stops.state, zip: stops.zip })
        .from(stops)
        .where(eq(stops.id, result.stopId));
      return row;
    });

  /**
   * Drizzle wraps the driver error, so the constraint name is on `cause`.
   * Asserting the NAME rather than just "it threw" is what proves the check
   * fired, rather than the row failing for some unrelated reason.
   */
  const violation = async (run: (tx: Tx) => Promise<unknown>): Promise<string> => {
    try {
      await rolledBack(run);
      return 'NO ERROR';
    } catch (error: unknown) {
      const cause: unknown = error instanceof Error ? error.cause : null;
      return `${String(error)} ${cause === null ? '' : String(cause)}`;
    }
  };

  it('stores IL for an API client that posts "il"', async () => {
    expect((await savedRow({ state: 'il' }))?.state).toBe('IL');
  });

  it('stores five digits for an API client that posts ZIP+4', async () => {
    expect((await savedRow({ zip: '60601-1234' }))?.zip).toBe('60601');
  });

  it('stores null, not an empty string, for a cleared state', async () => {
    const row = await savedRow({ state: '' });
    expect(row?.state).toBeNull();
  });

  /**
   * The constraint, not the schema. The seed script and the geocoder both
   * write these columns without passing through `StopEdit`, so the rule has
   * to exist at the layer a future write path cannot skip — otherwise it is
   * enforced exactly where today's code happens to go.
   */
  it('refuses a bad ZIP written straight to the column', async () => {
    const message = await violation(async (tx) => {
        const { trucks: t } = await fixtures(tx);
        await tx.delete(loads).where(eq(loads.truckId, t[0]!.id));
        const result = await saveStopEdit(tx as never, {
          actorUserId: null,
          dispatchTz: DISPATCH_TZ,
          edit: StopEdit.parse(editFor(t[0]!.id, {})),
        });
        // Bypassing the schema entirely, as a migration or a script would.
        await tx.update(stops).set({ zip: '60601-1234' }).where(eq(stops.id, result.stopId));
    });
    expect(message).toContain('stops_zip_five_digits');
  });

  it('refuses a lower-case state written straight to the column', async () => {
    const message = await violation(async (tx) => {
        const { trucks: t } = await fixtures(tx);
        await tx.delete(loads).where(eq(loads.truckId, t[0]!.id));
        const result = await saveStopEdit(tx as never, {
          actorUserId: null,
          dispatchTz: DISPATCH_TZ,
          edit: StopEdit.parse(editFor(t[0]!.id, {})),
        });
        await tx.update(stops).set({ state: 'il' }).where(eq(stops.id, result.stopId));
    });
    expect(message).toContain('stops_state_two_letters');
  });
});
