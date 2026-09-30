import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { profiles, truckListMembers, truckLists, trucks } from '@/db/schema';
import { timeInZone } from '@/lib/format';
import { can, type Role } from '@/lib/roles';
import {
  LIST_CAP,
  LIST_TRUCK_CAP,
  normalizeListName,
  truckLabel,
  type AddToListRequest,
  type CreateListRequest,
  type DeleteListRequest,
  type TruckList,
  type UpdateListRequest,
} from '@/lib/truck-lists';
import { writeAudit, type Db, type Writer } from './audit';

/**
 * §12.90 — shared truck lists, the writes.
 *
 * Every write checks the ROLE here, not only in the route: dispatchers and
 * admins may create, edit and delete; a viewer may only read. The route's
 * `requireRole('dispatcher')` is the first gate and this is the second, so a
 * future caller that forgets the first is still refused — and so a database
 * test can prove the rule by calling these directly as a viewer.
 *
 * Each write is one transaction that locks the list row, so two saves to one
 * list are taken in turn; edits and deletes then compare the version they
 * started from, and refuse rather than overwrite.
 */

export interface Actor {
  id: string | null;
  role: Role;
}

export type TruckListErrorKind =
  'forbidden' | 'not-found' | 'conflict' | 'duplicate' | 'limit' | 'invalid';

const STATUS: Record<TruckListErrorKind, number> = {
  forbidden: 403,
  'not-found': 404,
  conflict: 409,
  duplicate: 409,
  limit: 422,
  invalid: 422,
};

export class TruckListError extends Error {
  readonly status: number;
  constructor(
    message: string,
    readonly kind: TruckListErrorKind,
    /** On a conflict: the list as it is now, so the client can show it. */
    readonly current: TruckList | null = null,
  ) {
    super(message);
    this.name = 'TruckListError';
    this.status = STATUS[kind];
  }
}

function assertCanWrite(actor: Actor): void {
  if (!can(actor.role, 'dispatcher')) {
    throw new TruckListError(
      `Only dispatchers and admins can change lists; your role is ${actor.role}.`,
      'forbidden',
    );
  }
}

/* --------------------------------- read --------------------------------- */

export async function loadTruckLists(db: Db | Writer): Promise<TruckList[]> {
  const lists = await db
    .select({
      id: truckLists.id,
      name: truckLists.name,
      version: truckLists.version,
      updatedAt: truckLists.updatedAt,
      updatedByName: profiles.fullName,
    })
    .from(truckLists)
    .leftJoin(profiles, eq(profiles.id, truckLists.updatedBy))
    .orderBy(asc(sql`lower(${truckLists.name})`));
  if (lists.length === 0) return [];
  const members = await db
    .select({ listId: truckListMembers.listId, truckId: truckListMembers.truckId })
    .from(truckListMembers)
    .where(
      inArray(
        truckListMembers.listId,
        lists.map((l) => l.id),
      ),
    );
  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    version: l.version,
    truckIds: members.filter((m) => m.listId === l.id).map((m) => m.truckId),
    updatedAt: l.updatedAt.toISOString(),
    updatedByName: l.updatedByName ?? null,
  }));
}

/* -------------------------------- helpers ------------------------------- */

/** Labels for the audit row: the truck NUMBERS, which is what a person reads. */
async function labels(tx: Writer, ids: readonly string[]): Promise<(number | string)[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ truckNumber: trucks.truckNumber, samsaraName: trucks.samsaraName })
    .from(trucks)
    .where(inArray(trucks.id, [...ids]));
  return rows
    .map((r) => (r.truckNumber === null ? truckLabel(r) : r.truckNumber))
    .sort((a, b) => String(a).localeCompare(String(b), 'en', { numeric: true }));
}

/** Every id is a real truck, or the whole write is refused naming how many are not. */
async function assertTrucksExist(tx: Writer, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const found = await tx
    .select({ id: trucks.id })
    .from(trucks)
    .where(inArray(trucks.id, [...ids]));
  const missing = ids.length - new Set(found.map((f) => f.id)).size;
  if (missing > 0) {
    throw new TruckListError(
      `${missing} of these trucks no longer exist. Nothing was saved — refresh and try again.`,
      'invalid',
    );
  }
}

async function assertNameFree(
  tx: Writer,
  name: string,
  exceptId: string | null,
): Promise<void> {
  const [clash] = await tx
    .select({ id: truckLists.id, name: truckLists.name })
    .from(truckLists)
    .where(sql`lower(${truckLists.name}) = lower(${name})`)
    .limit(1);
  if (clash && clash.id !== exceptId) {
    throw new TruckListError(
      `A list called “${clash.name}” already exists.`,
      'duplicate',
    );
  }
}

/** The list row, locked for the rest of the transaction; refused if gone. */
async function lockList(tx: Writer, id: string) {
  const [row] = await tx
    .select({
      id: truckLists.id,
      name: truckLists.name,
      version: truckLists.version,
      updatedAt: truckLists.updatedAt,
      updatedBy: truckLists.updatedBy,
    })
    .from(truckLists)
    .where(eq(truckLists.id, id))
    .for('update')
    .limit(1);
  if (!row) {
    throw new TruckListError(
      'This list no longer exists — someone deleted it.',
      'not-found',
    );
  }
  const members = await tx
    .select({ truckId: truckListMembers.truckId })
    .from(truckListMembers)
    .where(eq(truckListMembers.listId, id));
  return { ...row, truckIds: members.map((m) => m.truckId) };
}

/** Refuses a save that did not start from the version stored now. */
async function assertVersion(
  tx: Writer,
  list: Awaited<ReturnType<typeof lockList>>,
  expected: number,
  dispatchTz: string,
): Promise<void> {
  if (list.version === expected) return;
  const [by] = list.updatedBy
    ? await tx
        .select({ name: profiles.fullName })
        .from(profiles)
        .where(eq(profiles.id, list.updatedBy))
    : [];
  const current: TruckList = {
    id: list.id,
    name: list.name,
    version: list.version,
    truckIds: list.truckIds,
    updatedAt: list.updatedAt.toISOString(),
    updatedByName: by?.name ?? null,
  };
  throw new TruckListError(
    `“${list.name}” was changed by ${by?.name ?? 'someone else'} at ` +
      `${timeInZone(list.updatedAt, dispatchTz)} (now ${list.truckIds.length} trucks). ` +
      'Nothing was saved — reload the list and make your change again.',
    'conflict',
    current,
  );
}

/**
 * The database's own refusals — the unique name and the two caps — as the
 * sentences a dispatcher reads. The pre-checks above catch these first; this
 * is for the race where two people save at the same moment.
 */
function translate(error: unknown): unknown {
  const text = `${error instanceof Error ? error.message : String(error)} ${String(
    (error as { cause?: unknown }).cause ?? '',
  )}`;
  if (text.includes('truck_lists_name_unique')) {
    return new TruckListError('A list with that name already exists.', 'duplicate');
  }
  if (text.includes('truck_lists_cap')) {
    return new TruckListError(
      `There can be at most ${LIST_CAP} lists. Delete one first.`,
      'limit',
    );
  }
  if (text.includes('truck_list_members_cap')) {
    return new TruckListError(
      `A list can hold at most ${LIST_TRUCK_CAP} trucks.`,
      'limit',
    );
  }
  return error;
}

async function inTx<T>(db: Db | Writer, body: (tx: Writer) => Promise<T>): Promise<T> {
  try {
    return await db.transaction(body);
  } catch (error: unknown) {
    throw translate(error);
  }
}

/* -------------------------------- writes -------------------------------- */

export async function createTruckList(
  db: Db | Writer,
  input: { actor: Actor; request: CreateListRequest },
): Promise<{ id: string; version: number }> {
  assertCanWrite(input.actor);
  // Normalised here too, not only by the route's schema: a caller that skips
  // the schema would otherwise meet the database's shape check as a 500.
  const name = normalizeListName(input.request.name);
  const ids = [...new Set(input.request.truckIds)];
  return inTx(db, async (tx) => {
    await assertNameFree(tx, name, null);
    await assertTrucksExist(tx, ids);
    const [list] = await tx
      .insert(truckLists)
      .values({ name, createdBy: input.actor.id, updatedBy: input.actor.id })
      .returning({ id: truckLists.id, version: truckLists.version });
    if (ids.length > 0) {
      await tx
        .insert(truckListMembers)
        .values(
          ids.map((truckId) => ({ listId: list!.id, truckId, addedBy: input.actor.id })),
        );
    }
    await writeAudit(tx, {
      actorUserId: input.actor.id,
      entity: 'truck_list',
      entityId: list!.id,
      before: null,
      after: { name, trucks: await labels(tx, ids), source: 'truck-lists' },
    });
    return { id: list!.id, version: list!.version };
  });
}

/** The whole list as the editor now wants it, from the version it started at. */
export async function updateTruckList(
  db: Db | Writer,
  input: { actor: Actor; request: UpdateListRequest; dispatchTz: string },
): Promise<{ id: string; version: number }> {
  assertCanWrite(input.actor);
  const { id, expectedVersion } = input.request;
  const name = normalizeListName(input.request.name);
  const wanted = [...new Set(input.request.truckIds)];
  return inTx(db, async (tx) => {
    const list = await lockList(tx, id);
    await assertVersion(tx, list, expectedVersion, input.dispatchTz);
    await assertNameFree(tx, name, id);
    await assertTrucksExist(tx, wanted);

    const removed = list.truckIds.filter((t) => !wanted.includes(t));
    const added = wanted.filter((t) => !list.truckIds.includes(t));
    const beforeLabels = await labels(tx, list.truckIds);

    if (removed.length > 0) {
      await tx
        .delete(truckListMembers)
        .where(
          and(
            eq(truckListMembers.listId, id),
            inArray(truckListMembers.truckId, removed),
          ),
        );
    }
    if (added.length > 0) {
      await tx
        .insert(truckListMembers)
        .values(
          added.map((truckId) => ({ listId: id, truckId, addedBy: input.actor.id })),
        );
    }
    const [next] = await tx
      .update(truckLists)
      .set({
        name,
        version: sql`${truckLists.version} + 1`,
        updatedBy: input.actor.id,
        updatedAt: sql`now()`,
      })
      .where(eq(truckLists.id, id))
      .returning({ version: truckLists.version });

    await writeAudit(tx, {
      actorUserId: input.actor.id,
      entity: 'truck_list',
      entityId: id,
      before: { name: list.name, trucks: beforeLabels },
      after: {
        name,
        trucks: await labels(tx, wanted),
        added: await labels(tx, added),
        removed: await labels(tx, removed),
        source: 'truck-lists',
      },
    });
    return { id, version: next!.version };
  });
}

/**
 * "Add to list…". Only ever adds, so it cannot overwrite anyone's work and
 * carries no version check (§12.90). Trucks already in the list are skipped;
 * a call that adds nothing changes nothing and writes no audit row.
 */
export async function addToTruckList(
  db: Db | Writer,
  input: { actor: Actor; request: AddToListRequest },
): Promise<{ id: string; version: number; added: number }> {
  assertCanWrite(input.actor);
  const { id } = input.request;
  const ids = [...new Set(input.request.truckIds)];
  return inTx(db, async (tx) => {
    const list = await lockList(tx, id);
    await assertTrucksExist(tx, ids);
    const added = ids.filter((t) => !list.truckIds.includes(t));
    if (added.length === 0) return { id, version: list.version, added: 0 };

    await tx
      .insert(truckListMembers)
      .values(added.map((truckId) => ({ listId: id, truckId, addedBy: input.actor.id })));
    const [next] = await tx
      .update(truckLists)
      .set({
        version: sql`${truckLists.version} + 1`,
        updatedBy: input.actor.id,
        updatedAt: sql`now()`,
      })
      .where(eq(truckLists.id, id))
      .returning({ version: truckLists.version });
    await writeAudit(tx, {
      actorUserId: input.actor.id,
      entity: 'truck_list',
      entityId: id,
      before: { name: list.name, trucks: await labels(tx, list.truckIds) },
      after: {
        name: list.name,
        trucks: await labels(tx, [...list.truckIds, ...added]),
        added: await labels(tx, added),
        source: 'truck-lists-add',
      },
    });
    return { id, version: next!.version, added: added.length };
  });
}

export async function deleteTruckList(
  db: Db | Writer,
  input: { actor: Actor; request: DeleteListRequest; dispatchTz: string },
): Promise<void> {
  assertCanWrite(input.actor);
  const { id, expectedVersion } = input.request;
  await inTx(db, async (tx) => {
    const list = await lockList(tx, id);
    await assertVersion(tx, list, expectedVersion, input.dispatchTz);
    const beforeLabels = await labels(tx, list.truckIds);
    // Members go with it (ON DELETE CASCADE).
    await tx.delete(truckLists).where(eq(truckLists.id, id));
    await writeAudit(tx, {
      actorUserId: input.actor.id,
      entity: 'truck_list',
      entityId: id,
      before: { name: list.name, trucks: beforeLabels },
      after: { name: list.name, trucks: [], deleted: true, source: 'truck-lists' },
    });
  });
}
