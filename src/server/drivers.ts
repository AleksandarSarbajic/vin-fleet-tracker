import { and, eq, isNull, sql } from 'drizzle-orm';
import { assignments, driverMergeCandidates, drivers } from '@/db/schema';
import { DriverCreate, namesMatch } from '@/lib/driver';
import { writeAudit, type Db, type Tx } from './audit';

/**
 * Drivers a dispatcher creates, and the merge that reunites them with Samsara
 * once onboarding completes (§12.35).
 */

export class DriverError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = 'DriverError';
  }
}

/* ------------------------------- creation ------------------------------- */

export async function createDriver(
  db: Db,
  input: {
    actorUserId: string | null;
    driver: DriverCreate;
    /**
     * Assign them to this truck in the SAME transaction (§12.38).
     *
     * "Add and assign" is one act from the dispatcher's side — a new hire
     * walks in and goes on a truck — so it is one write from ours, both or
     * neither, exactly as the override rides inside the stop save (§12.28).
     * A driver created but not assigned leaves them where they started.
     *
     * REFUSED when the truck already has a driver: that is a reassignment,
     * and reassignment has a two-sided confirm and a preview token (§9.10).
     * Creating straight through would bypass a confirmation the design
     * requires, so the caller creates the driver and lets the existing
     * confirm path handle the move.
     */
    assignToTruckId?: string | undefined;
  },
): Promise<{ driverId: string; assignedTruckId: string | null }> {
  /**
   * Re-parsed here, not trusted from the caller (§9.9). The route parses it
   * too; a server function that assumes its caller did is a rule living in
   * one layer and absent from the one that writes the row.
   */
  const driver = DriverCreate.parse(input.driver);

  return db.transaction(async (tx) => {
    /**
     * A duplicate NAME is refused, across both sources.
     *
     * Not a database constraint: Samsara can legitimately hand us two drivers
     * with the same name and we must not reject the roster sync over it. This
     * is a check on what a HUMAN types, where a duplicate is almost always the
     * same person being added twice — and two identical names on the
     * assignment board is a dispatcher putting the wrong one on a truck.
     */
    /**
     * Compared in TypeScript with `namesMatch`, NOT in SQL.
     *
     * The first version did it in SQL, and the two normalisations disagreed:
     * `lower(regexp_replace(...))` collapses whitespace and case, while
     * `normalizeDriverName` also strips punctuation and accents. "J Martinez"
     * and "J. Martinez" matched in one and not the other. One rule with two
     * implementations is the shape that keeps costing this build (§12.21,
     * §12.32), so there is one implementation and the database does not get a
     * vote. At 24 drivers the read is free.
     */
    const existing = await tx
      .select({ id: drivers.id, name: drivers.name, source: drivers.source })
      .from(drivers)
      .where(isNull(drivers.retiredAt));

    const clash = existing.find((row) => namesMatch(row.name, driver.name));
    if (clash) {
      throw new DriverError(
        clash.source === 'samsara'
          ? 'Samsara already has a driver with that name — assign them instead.'
          : 'A driver with that name has already been added.',
        'name',
      );
    }

    const [row] = await tx
      .insert(drivers)
      .values({
        samsaraDriverId: null,
        name: driver.name,
        phone: driver.phone ?? null,
        source: 'app',
        createdBy: input.actorUserId,
        // Samsara's flag, and it has no opinion about a driver it has never
        // seen. `retired_at` is what retires an app driver.
        active: true,
      })
      .returning({ id: drivers.id });

    let assignedTruckId: string | null = null;
    if (input.assignToTruckId !== undefined) {
      const [occupied] = await tx
        .select({ driverId: assignments.driverId })
        .from(assignments)
        .where(and(eq(assignments.truckId, input.assignToTruckId), isNull(assignments.endedAt)))
        .limit(1);

      if (occupied) {
        // Nothing is written, including the driver — one transaction.
        throw new DriverError(
          'That truck already has a driver. Add the driver, then reassign from the board so the change is confirmed.',
          'assignToTruckId',
        );
      }

      await tx
        .insert(assignments)
        .values({ truckId: input.assignToTruckId, driverId: row!.id, createdBy: input.actorUserId });
      assignedTruckId = input.assignToTruckId;
    }

    await writeAudit(tx, {
      actorUserId: input.actorUserId,
      entity: 'driver',
      entityId: row!.id,
      before: null,
      after: {
        name: driver.name,
        phone: driver.phone ?? null,
        source: 'app',
        assignedTruckId,
      },
    });

    return { driverId: row!.id, assignedTruckId };
  });
}

/* ------------------------------ retirement ------------------------------ */

/**
 * Retires a driver. ADMIN only — it takes someone off the board.
 *
 * Never a delete. `assignments.driver_id` is ON DELETE RESTRICT, so a driver
 * with history cannot be removed and should not be: the history is the record
 * of who drove what.
 */
export async function retireDriver(
  db: Db,
  input: { actorUserId: string | null; driverId: string; retired: boolean },
): Promise<void> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: drivers.id, name: drivers.name, retiredAt: drivers.retiredAt })
      .from(drivers)
      .where(eq(drivers.id, input.driverId))
      .limit(1);
    if (!existing) throw new DriverError('That driver no longer exists.', 'driverId');

    if (input.retired) {
      // An open assignment would leave a truck pointing at a retired driver.
      const [open] = await tx
        .select({ truckId: assignments.truckId })
        .from(assignments)
        .where(and(eq(assignments.driverId, input.driverId), isNull(assignments.endedAt)))
        .limit(1);
      if (open) {
        throw new DriverError(
          'That driver is still on a truck. Clear the assignment first.',
          'driverId',
        );
      }
    }

    await tx
      .update(drivers)
      .set({ retiredAt: input.retired ? sql`now()` : null })
      .where(eq(drivers.id, input.driverId));

    await writeAudit(tx, {
      actorUserId: input.actorUserId,
      entity: 'driver',
      entityId: input.driverId,
      before: { name: existing.name, retiredAt: existing.retiredAt?.toISOString() ?? null },
      after: { name: existing.name, retired: input.retired },
    });
  });
}

/* --------------------------- merge candidates --------------------------- */

/**
 * Finds app-created drivers whose name matches a Samsara-backed one.
 *
 * Called by the worker after the roster sync. It RECORDS, it does not act:
 * name is the only signal Samsara gives us (no phone, and licence data is
 * never stored), and two drivers called J. Martinez in a 24-driver fleet is
 * not hypothetical. A wrong automatic merge silently rewrites assignment
 * history, and nobody would find it — the whole point of merging is that the
 * rows stop being distinguishable.
 *
 * Already-dismissed pairs are left alone by the unique index: re-detection
 * conflicts on the pair and updates nothing.
 */
export async function detectMergeCandidates(db: Db): Promise<number> {
  /**
   * Matched in TypeScript, for the same reason as the clash check above: one
   * rule, one implementation. `namesMatch` is what the tests exercise, so it
   * is what runs.
   */
  const all = await db
    .select({
      id: drivers.id,
      name: drivers.name,
      source: drivers.source,
      samsaraDriverId: drivers.samsaraDriverId,
      retiredAt: drivers.retiredAt,
    })
    .from(drivers);

  const app = all.filter(
    (d) => d.source === 'app' && d.samsaraDriverId === null && d.retiredAt === null,
  );
  const samsara = all.filter((d) => d.source === 'samsara' && d.samsaraDriverId !== null);

  const pairs: { appDriverId: string; samsaraDriverId: string }[] = [];
  for (const a of app) {
    for (const s of samsara) {
      if (a.id !== s.id && namesMatch(a.name, s.name)) {
        pairs.push({ appDriverId: a.id, samsaraDriverId: s.id });
      }
    }
  }
  if (pairs.length === 0) return 0;

  await db
    .insert(driverMergeCandidates)
    .values(pairs)
    // A dismissed candidate must not resurrect itself on the next poll.
    .onConflictDoNothing({
      target: [driverMergeCandidates.appDriverId, driverMergeCandidates.samsaraDriverId],
    });

  return pairs.length;
}

export interface OpenMergeCandidate {
  id: string;
  appDriverId: string;
  appDriverName: string;
  appDriverCreatedAt: string;
  samsaraDriverId: string;
  samsaraDriverName: string;
}

/** What the assignment board asks about. Open candidates only. */
export async function openMergeCandidates(db: Db | Tx): Promise<OpenMergeCandidate[]> {
  const rows = (await db.execute(sql`
    select c.id::text as id,
           app.id::text as app_driver_id, app.name as app_driver_name,
           to_char(app.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
             as app_driver_created_at,
           sam.id::text as samsara_driver_id, sam.name as samsara_driver_name
    from driver_merge_candidates c
    join drivers app on app.id = c.app_driver_id
    join drivers sam on sam.id = c.samsara_driver_id
    where c.dismissed_at is null
      and app.samsara_driver_id is null
    order by c.detected_at
  `)) as unknown as Record<string, string>[];

  return rows.map((r) => ({
    id: r.id!,
    appDriverId: r.app_driver_id!,
    appDriverName: r.app_driver_name!,
    appDriverCreatedAt: r.app_driver_created_at!,
    samsaraDriverId: r.samsara_driver_id!,
    samsaraDriverName: r.samsara_driver_name!,
  }));
}

export async function dismissMergeCandidate(
  db: Db,
  input: { actorUserId: string | null; candidateId: string },
): Promise<void> {
  await db
    .update(driverMergeCandidates)
    .set({ dismissedAt: sql`now()`, dismissedBy: input.actorUserId })
    .where(eq(driverMergeCandidates.id, input.candidateId));
}

/* -------------------------------- the link ------------------------------ */

/**
 * Merges an app-created driver into the Samsara row that is the same person.
 *
 * ONE transaction, and the order matters. `assignments.driver_id` is
 * ON DELETE RESTRICT, so the history has to be repointed BEFORE the app row
 * can go — which is also what keeps the history intact rather than orphaning
 * it.
 *
 * Rewriting which row past assignments point at is deliberate: the meaning of
 * the merge is that these were always one person, and a history that keeps
 * them apart lies in the other direction. The audit entry naming BOTH ids is
 * the condition that makes it recoverable — without it a wrong link is
 * invisible, because afterwards the rows are indistinguishable.
 */
export async function linkDriver(
  db: Db,
  input: { actorUserId: string | null; appDriverId: string; samsaraDriverId: string },
): Promise<{ movedAssignments: number }> {
  return db.transaction(async (tx) => {
    const [app] = await tx
      .select({
        id: drivers.id,
        name: drivers.name,
        phone: drivers.phone,
        source: drivers.source,
        samsaraDriverId: drivers.samsaraDriverId,
        retiredAt: drivers.retiredAt,
      })
      .from(drivers)
      .where(eq(drivers.id, input.appDriverId))
      .limit(1);

    const [sam] = await tx
      .select({
        id: drivers.id,
        name: drivers.name,
        phone: drivers.phone,
        source: drivers.source,
        samsaraDriverId: drivers.samsaraDriverId,
      })
      .from(drivers)
      .where(eq(drivers.id, input.samsaraDriverId))
      .limit(1);

    if (!app || !sam) throw new DriverError('That driver no longer exists.', 'driverId');
    if (app.source !== 'app') {
      throw new DriverError('Only a driver added here can be linked.', 'appDriverId');
    }
    if (sam.samsaraDriverId === null) {
      throw new DriverError('The other driver is not in Samsara.', 'samsaraDriverId');
    }

    /**
     * Both on a truck at once means the fleet-wide one-driver-per-truck rule
     * would be violated by the merge itself. Refuse rather than pick one.
     */
    const open = await tx
      .select({ id: assignments.id, driverId: assignments.driverId })
      .from(assignments)
      .where(
        and(
          isNull(assignments.endedAt),
          sql`${assignments.driverId} in (${input.appDriverId}, ${input.samsaraDriverId})`,
        ),
      );
    if (open.length > 1) {
      throw new DriverError(
        'Both drivers are currently on trucks. Clear one assignment first.',
        'appDriverId',
      );
    }

    // 1. The history moves first — ON DELETE RESTRICT depends on it.
    const moved = await tx
      .update(assignments)
      .set({ driverId: sam.id })
      .where(eq(assignments.driverId, app.id))
      .returning({ id: assignments.id });

    // 2. The phone is ours and Samsara has none, so it must not be lost.
    if (sam.phone === null && app.phone !== null) {
      await tx.update(drivers).set({ phone: app.phone }).where(eq(drivers.id, sam.id));
    }

    // 3. A retirement an admin made is a local decision and outlives the merge.
    if (app.retiredAt !== null) {
      await tx.update(drivers).set({ retiredAt: app.retiredAt }).where(eq(drivers.id, sam.id));
    }

    // 4. The candidate rows for this pair are spent either way.
    await tx
      .delete(driverMergeCandidates)
      .where(eq(driverMergeCandidates.appDriverId, app.id));

    // 5. Now nothing references it.
    await tx.delete(drivers).where(eq(drivers.id, app.id));

    await writeAudit(tx, {
      actorUserId: input.actorUserId,
      entity: 'driver',
      entityId: sam.id,
      /**
       * BOTH ids, by name, on both sides. This entry is the only record that
       * two rows were ever one person, and the only way back if the link was
       * wrong — afterwards the rows are indistinguishable by design.
       */
      before: {
        appDriverId: app.id,
        appDriverName: app.name,
        appDriverPhone: app.phone,
        samsaraDriverId: sam.id,
        samsaraDriverName: sam.name,
        samsaraDriverExternalId: sam.samsaraDriverId,
      },
      after: {
        mergedInto: sam.id,
        removed: app.id,
        movedAssignments: moved.length,
        phoneCarriedOver: sam.phone === null && app.phone !== null,
      },
    });

    return { movedAssignments: moved.length };
  });
}

/** Drivers the assignment board can offer. Retired ones are gone from it. */
export function selectableDrivers() {
  return and(isNull(drivers.retiredAt), eq(drivers.active, true));
}

