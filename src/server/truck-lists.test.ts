import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { auditLog, truckListMembers, truckLists, trucks } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import { makeDispatcher, makeTruck } from '@/test/fleet';
import type { Role } from '@/lib/roles';
import {
  TruckListError,
  addToTruckList,
  createTruckList,
  deleteTruckList,
  loadTruckLists,
  updateTruckList,
  type Actor,
} from './truck-lists';
import type { Tx } from './audit';

/**
 * §12.90 against the real database, inside transactions that always roll
 * back: the constraints, the caps, the foreign keys, the permission rule and
 * the version check.
 */

const TZ = 'America/Chicago';

/** Refusal kind and message, or 'ok'. */
async function outcome(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (error: unknown) {
    if (error instanceof TruckListError) return `${error.kind}: ${error.message}`;
    throw error;
  }
}

async function fleet(tx: Tx, numbers: number[]) {
  const out: { id: string; truckNumber: number }[] = [];
  for (const n of numbers) {
    const t = await makeTruck(tx, { truckNumber: n });
    out.push({ id: t.id, truckNumber: n });
  }
  return out;
}

async function actor(tx: Tx, role: Role): Promise<Actor> {
  const p = await makeDispatcher(tx, `Vitest ${role}`);
  return { id: p.id, role };
}

const BOBS = [113, 116, 124, 128, 133, 135, 137, 138, 139, 141, 143, 145];

describeDb('shared truck lists (§12.90)', () => {
  it('creates "Bob\'s trucks" with the 12 trucks, and reads it back by id', async () => {
    const seen = await rolledBack(async (tx) => {
      const trucksMade = await fleet(tx, BOBS);
      const me = await actor(tx, 'dispatcher');
      const made = await createTruckList(tx, {
        actor: me,
        request: { name: "Bob's trucks", truckIds: trucksMade.map((t) => t.id) },
      });
      const [audit] = await tx
        .select({
          before: auditLog.before,
          after: auditLog.after,
          actor: auditLog.actorUserId,
        })
        .from(auditLog)
        .where(and(eq(auditLog.entity, 'truck_list'), eq(auditLog.entityId, made.id)));
      return { made, lists: await loadTruckLists(tx), trucksMade, audit, me };
    });
    const list = seen.lists.find((l) => l.id === seen.made.id)!;
    expect(list.name).toBe("Bob's trucks");
    expect(list.version).toBe(1);
    expect(new Set(list.truckIds)).toEqual(new Set(seen.trucksMade.map((t) => t.id)));
    expect(seen.audit!.actor).toBe(seen.me.id);
    expect(seen.audit!.before).toBeNull();
    expect(seen.audit!.after).toMatchObject({ name: "Bob's trucks", trucks: BOBS });
  });

  describe('the constraints', () => {
    it('refuses a second list whose name differs only in case or spacing', async () => {
      const seen = await rolledBack(async (tx) => {
        const me = await actor(tx, 'dispatcher');
        await createTruckList(tx, {
          actor: me,
          request: { name: "Bob's trucks", truckIds: [] },
        });
        const again = await outcome(
          createTruckList(tx, {
            actor: me,
            request: { name: "bob's  TRUCKS", truckIds: [] },
          }),
        );
        // And the database refuses it too, not only the server's pre-check.
        const raw = await tx
          .insert(truckLists)
          .values({ name: "BOB'S TRUCKS" })
          .then(
            () => 'inserted',
            (e: unknown) => String((e as { cause?: unknown }).cause ?? e),
          );
        return { again, raw };
      });
      expect(seen.again).toBe("duplicate: A list called “Bob's trucks” already exists.");
      expect(seen.raw).toContain('truck_lists_name_unique');
    });

    it('refuses an un-normalised or over-long name at the database', async () => {
      const seen = await rolledBack(async (tx) => {
        const attempt = (name: string) =>
          tx.execute(sql`savepoint s`).then(async () => {
            const r = await tx
              .insert(truckLists)
              .values({ name })
              .then(
                () => 'inserted',
                (e: unknown) => String((e as { cause?: unknown }).cause ?? e),
              );
            await tx.execute(sql`rollback to savepoint s`);
            return r;
          });
        return {
          spaced: await attempt('  Bob  '),
          long: await attempt('x'.repeat(41)),
          empty: await attempt(''),
        };
      });
      for (const r of Object.values(seen)) expect(r).toContain('truck_lists_name_shape');
    });

    it('holds at most 50 lists — the 51st is refused by the database trigger', async () => {
      const seen = await rolledBack(async (tx) => {
        const me = await actor(tx, 'admin');
        for (let i = 1; i <= 50; i += 1) {
          await createTruckList(tx, {
            actor: me,
            request: { name: `List ${i}`, truckIds: [] },
          });
        }
        return outcome(
          createTruckList(tx, { actor: me, request: { name: 'List 51', truckIds: [] } }),
        );
      });
      expect(seen).toBe('limit: There can be at most 50 lists. Delete one first.');
    });

    it('holds at most 200 trucks — the 201st is refused by the database trigger', async () => {
      const seen = await rolledBack(async (tx) => {
        const me = await actor(tx, 'dispatcher');
        const many = await fleet(
          tx,
          Array.from({ length: 201 }, (_, i) => 5000 + i),
        );
        const made = await createTruckList(tx, {
          actor: me,
          request: { name: 'Big', truckIds: many.slice(0, 200).map((t) => t.id) },
        });
        return outcome(
          addToTruckList(tx, {
            actor: me,
            request: { op: 'add', id: made.id, truckIds: [many[200]!.id] },
          }),
        );
      });
      expect(seen).toBe('limit: A list can hold at most 200 trucks.');
    });

    it('stores trucks by id: a truck that is not in the fleet is refused', async () => {
      const seen = await rolledBack(async (tx) => {
        const me = await actor(tx, 'dispatcher');
        const viaServer = await outcome(
          createTruckList(tx, {
            actor: me,
            request: {
              name: 'Ghost',
              truckIds: ['00000000-0000-4000-8000-000000000000'],
            },
          }),
        );
        const made = await createTruckList(tx, {
          actor: me,
          request: { name: 'Real', truckIds: [] },
        });
        const viaDb = await tx
          .insert(truckListMembers)
          .values({ listId: made.id, truckId: '00000000-0000-4000-8000-000000000000' })
          .then(
            () => 'inserted',
            (e: unknown) => String((e as { cause?: unknown }).cause ?? e),
          );
        return { viaServer, viaDb };
      });
      expect(seen.viaServer).toBe(
        'invalid: 1 of these trucks no longer exist. Nothing was saved — refresh and try again.',
      );
      expect(seen.viaDb).toContain('truck_list_members_truck_id_trucks_id_fk');
    });

    it('a deleted truck leaves its lists; a deactivated one stays', async () => {
      const seen = await rolledBack(async (tx) => {
        const me = await actor(tx, 'dispatcher');
        const [a, b] = await fleet(tx, [701, 702]);
        const made = await createTruckList(tx, {
          actor: me,
          request: { name: 'Two', truckIds: [a!.id, b!.id] },
        });
        await tx.update(trucks).set({ active: false }).where(eq(trucks.id, a!.id));
        await tx.delete(trucks).where(eq(trucks.id, b!.id));
        return {
          list: (await loadTruckLists(tx)).find((l) => l.id === made.id)!,
          a: a!.id,
        };
      });
      expect(seen.list.truckIds).toEqual([seen.a]);
    });

    it('a deleted list takes its members with it', async () => {
      const seen = await rolledBack(async (tx) => {
        const me = await actor(tx, 'dispatcher');
        const [a] = await fleet(tx, [801]);
        const made = await createTruckList(tx, {
          actor: me,
          request: { name: 'Gone', truckIds: [a!.id] },
        });
        await deleteTruckList(tx, {
          actor: me,
          request: { id: made.id, expectedVersion: 1 },
          dispatchTz: TZ,
        });
        return (
          await tx
            .select()
            .from(truckListMembers)
            .where(eq(truckListMembers.listId, made.id))
        ).length;
      });
      expect(seen).toBe(0);
    });
  });

  /**
   * Addition 3: an admin passes the dispatcher check on EVERY write, and a
   * viewer is refused on every one — with nothing written.
   */
  describe('who may change a list', () => {
    const writes = (
      tx: Tx,
      who: Actor,
      listId: string,
      truckId: string,
      version: number,
    ) => ({
      create: () =>
        createTruckList(tx, {
          actor: who,
          request: { name: `By ${who.role}`, truckIds: [truckId] },
        }),
      update: () =>
        updateTruckList(tx, {
          actor: who,
          request: {
            op: 'update',
            id: listId,
            expectedVersion: version,
            name: 'Renamed',
            truckIds: [],
          },
          dispatchTz: TZ,
        }),
      add: () =>
        addToTruckList(tx, {
          actor: who,
          request: { op: 'add', id: listId, truckIds: [truckId] },
        }),
      delete: () =>
        deleteTruckList(tx, {
          actor: who,
          request: { id: listId, expectedVersion: version },
          dispatchTz: TZ,
        }),
    });

    it.each(['admin', 'dispatcher'] as const)(
      'lets an %s create, edit, add to and delete',
      async (role) => {
        const seen = await rolledBack(async (tx) => {
          const who = await actor(tx, role);
          const [t] = await fleet(tx, [901]);
          const base = await createTruckList(tx, {
            actor: who,
            request: { name: 'Base', truckIds: [] },
          });
          const w = writes(tx, who, base.id, t!.id, 1);
          return {
            create: await outcome(w.create()),
            add: await outcome(w.add()),
            // `add` moved the version to 2.
            update: await outcome(writes(tx, who, base.id, t!.id, 2).update()),
            delete: await outcome(writes(tx, who, base.id, t!.id, 3).delete()),
          };
        });
        expect(seen).toEqual({ create: 'ok', add: 'ok', update: 'ok', delete: 'ok' });
      },
    );

    it('refuses a viewer on every write, and writes nothing', async () => {
      const seen = await rolledBack(async (tx) => {
        const owner = await actor(tx, 'dispatcher');
        const viewer = await actor(tx, 'viewer');
        const [t] = await fleet(tx, [902]);
        const base = await createTruckList(tx, {
          actor: owner,
          request: { name: 'Base', truckIds: [] },
        });
        const w = writes(tx, viewer, base.id, t!.id, 1);
        const results = {
          create: await outcome(w.create()),
          update: await outcome(w.update()),
          add: await outcome(w.add()),
          delete: await outcome(w.delete()),
        };
        const lists = await loadTruckLists(tx);
        const audits = await tx
          .select({ actor: auditLog.actorUserId })
          .from(auditLog)
          .where(
            and(eq(auditLog.entity, 'truck_list'), eq(auditLog.actorUserId, viewer.id!)),
          );
        return { results, lists, audits };
      });
      const refused =
        'forbidden: Only dispatchers and admins can change lists; your role is viewer.';
      expect(seen.results).toEqual({
        create: refused,
        update: refused,
        add: refused,
        delete: refused,
      });
      expect(seen.lists).toHaveLength(1);
      expect(seen.lists[0]).toMatchObject({ name: 'Base', version: 1, truckIds: [] });
      expect(seen.audits).toEqual([]);
    });

    /**
     * And the ROUTE gate in front of these: every exported write handler
     * requires `dispatcher` (which an admin outranks — `requireRole` compares
     * rank), and the read handler requires only a signed-in user.
     */
    it('puts requireRole("dispatcher") in front of every write handler', () => {
      const route = readFileSync(
        join(import.meta.dirname, '..', 'app', 'api', 'truck-lists', 'route.ts'),
        'utf8',
      );
      const handlers = [
        ...route.matchAll(/export async function (GET|POST|PATCH|DELETE)\([^]*?\n\}/g),
      ];
      const gate = Object.fromEntries(
        handlers.map((m) => [
          m[1],
          /requireRole\('dispatcher'\)/.test(m[0])
            ? 'dispatcher'
            : /requireUser\(\)/.test(m[0])
              ? 'signed-in'
              : 'none',
        ]),
      );
      expect(gate).toEqual({
        GET: 'signed-in',
        POST: 'dispatcher',
        PATCH: 'dispatcher',
        DELETE: 'dispatcher',
      });
    });
  });

  describe('two people editing one list', () => {
    it('refuses the second edit made from the same starting version', async () => {
      const seen = await rolledBack(async (tx) => {
        const ana = await actor(tx, 'dispatcher');
        const marko = await actor(tx, 'admin');
        const [a, b, c] = await fleet(tx, [611, 612, 613]);
        const made = await createTruckList(tx, {
          actor: ana,
          request: { name: 'Shared', truckIds: [a!.id] },
        });
        // Both opened the list at version 1.
        const first = await updateTruckList(tx, {
          actor: ana,
          request: {
            op: 'update',
            id: made.id,
            expectedVersion: 1,
            name: 'Shared',
            truckIds: [a!.id, b!.id],
          },
          dispatchTz: TZ,
        });
        let second: TruckListError | null = null;
        try {
          await updateTruckList(tx, {
            actor: marko,
            request: {
              op: 'update',
              id: made.id,
              expectedVersion: 1,
              name: 'Shared',
              truckIds: [a!.id, c!.id],
            },
            dispatchTz: TZ,
          });
        } catch (e: unknown) {
          if (!(e instanceof TruckListError)) throw e;
          second = e;
        }
        const deleteStale = await outcome(
          deleteTruckList(tx, {
            actor: marko,
            request: { id: made.id, expectedVersion: 1 },
            dispatchTz: TZ,
          }),
        );
        const list = (await loadTruckLists(tx)).find((l) => l.id === made.id)!;
        return { first, second, deleteStale, list, ids: { a: a!.id, b: b!.id } };
      });
      expect(seen.first.version).toBe(2);
      expect(seen.second?.kind).toBe('conflict');
      expect(seen.second?.message).toMatch(
        /^“Shared” was changed by Vitest dispatcher at .+ \(now 2 trucks\)\. Nothing was saved — reload the list and make your change again\.$/,
      );
      expect(seen.second?.current?.version).toBe(2);
      expect(seen.deleteStale.startsWith('conflict: ')).toBe(true);
      // The first edit stands, untouched by the refused second.
      expect(seen.list.version).toBe(2);
      expect(new Set(seen.list.truckIds)).toEqual(new Set([seen.ids.a, seen.ids.b]));
    });

    it('lets "Add to list" land without a version, and skips trucks already there', async () => {
      const seen = await rolledBack(async (tx) => {
        const me = await actor(tx, 'dispatcher');
        const [a, b] = await fleet(tx, [621, 622]);
        const made = await createTruckList(tx, {
          actor: me,
          request: { name: 'Adds', truckIds: [a!.id] },
        });
        const first = await addToTruckList(tx, {
          actor: me,
          request: { op: 'add', id: made.id, truckIds: [a!.id, b!.id] },
        });
        const again = await addToTruckList(tx, {
          actor: me,
          request: { op: 'add', id: made.id, truckIds: [a!.id] },
        });
        const audits = await tx
          .select({ after: auditLog.after })
          .from(auditLog)
          .where(and(eq(auditLog.entity, 'truck_list'), eq(auditLog.entityId, made.id)));
        return { first, again, audits };
      });
      expect(seen.first).toMatchObject({ added: 1, version: 2 });
      expect(seen.again).toMatchObject({ added: 0, version: 2 });
      // Create + one real add. The empty add wrote nothing.
      expect(seen.audits).toHaveLength(2);
      expect(seen.audits[1]!.after).toMatchObject({
        added: [622],
        trucks: [621, 622],
        source: 'truck-lists-add',
      });
    });

    it('audits an edit and a delete with the truck numbers before and after', async () => {
      const seen = await rolledBack(async (tx) => {
        const me = await actor(tx, 'dispatcher');
        const [a, b, c] = await fleet(tx, [631, 632, 633]);
        const made = await createTruckList(tx, {
          actor: me,
          request: { name: 'Audit', truckIds: [a!.id, b!.id] },
        });
        await updateTruckList(tx, {
          actor: me,
          request: {
            op: 'update',
            id: made.id,
            expectedVersion: 1,
            name: 'Audit 2',
            truckIds: [b!.id, c!.id],
          },
          dispatchTz: TZ,
        });
        await deleteTruckList(tx, {
          actor: me,
          request: { id: made.id, expectedVersion: 2 },
          dispatchTz: TZ,
        });
        return tx
          .select({ before: auditLog.before, after: auditLog.after })
          .from(auditLog)
          .where(and(eq(auditLog.entity, 'truck_list'), eq(auditLog.entityId, made.id)))
          .orderBy(auditLog.createdAt);
      });
      expect(seen).toHaveLength(3);
      expect(seen[1]).toMatchObject({
        before: { name: 'Audit', trucks: [631, 632] },
        after: { name: 'Audit 2', trucks: [632, 633], added: [633], removed: [631] },
      });
      expect(seen[2]).toMatchObject({
        before: { name: 'Audit 2', trucks: [632, 633] },
        after: { trucks: [], deleted: true },
      });
    });
  });
});
