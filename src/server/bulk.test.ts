import { eq, inArray } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { overrides, stops } from '@/db/schema';
import { BulkNoteInput } from '@/lib/override';
import { describeDb, rolledBack } from '@/test/db';
import { makeRoutableLane } from '@/test/fleet';
import { BulkError, bulkNote, bulkOverride } from './bulk';
import type { Tx } from './audit';

/**
 * §14 feature 2, against the real database, always rolled back.
 *
 * The property under test is the one that made this a route rather than a
 * loop of existing ones: all of them, or none.
 */

const withDb = describeDb;

async function lanes(tx: Tx, n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const lane = await makeRoutableLane(tx, { zip: String(60400 + i) });
    ids.push(lane.stopId);
  }
  return ids;
}

const OVERRIDE = {
  forcedStatus: 'LATE' as const,
  reason: 'RECEIVER_CONFIRMED_DETENTION' as const,
  reasonNote: null,
  expiry: 'PLUS_4H' as const,
  customExpiry: null,
};

withDb('bulk override and note (§14 feature 2)', () => {
  it('applies one override to every stop given', async () => {
    const seen = await rolledBack(async (tx) => {
      const stopIds = await lanes(tx, 3);
      const result = await bulkOverride(tx as never, {
        actorUserId: null,
        dispatchTz: 'America/Chicago',
        override: { stopIds, ...OVERRIDE },
      });
      const written = await tx
        .select({ stopId: overrides.stopId })
        .from(overrides)
        .where(inArray(overrides.stopId, stopIds));
      return { result, written: written.length, asked: stopIds.length };
    });
    expect(seen.result.applied).toBe(3);
    expect(seen.written).toBe(seen.asked);
  });

  it('writes nothing at all when one stop has gone', async () => {
    // The reason this is a transaction: four requests can half-succeed, and
    // a dispatcher left with two of four overridden has no record of which.
    const written = await rolledBack(async (tx) => {
      const stopIds = await lanes(tx, 3);
      const missing = '00000000-0000-4000-8000-000000000000';
      await expect(
        bulkOverride(tx as never, {
          actorUserId: null,
          dispatchTz: 'America/Chicago',
          override: { stopIds: [...stopIds, missing], ...OVERRIDE },
        }),
      ).rejects.toBeInstanceOf(BulkError);
      return tx
        .select({ stopId: overrides.stopId })
        .from(overrides)
        .where(inArray(overrides.stopId, stopIds));
    });
    expect(written).toHaveLength(0);
  });

  it('says how many are missing, so the message is actionable', async () => {
    await rolledBack(async (tx) => {
      const stopIds = await lanes(tx, 1);
      await expect(
        bulkOverride(tx as never, {
          actorUserId: null,
          dispatchTz: 'America/Chicago',
          override: {
            stopIds: [
              ...stopIds,
              '00000000-0000-4000-8000-000000000001',
              '00000000-0000-4000-8000-000000000002',
            ],
            ...OVERRIDE,
          },
        }),
      ).rejects.toThrow(/2 of these 3 stops/);
    });
  });

  it('writes the note to every stop', async () => {
    const notes = await rolledBack(async (tx) => {
      const stopIds = await lanes(tx, 2);
      // Through the schema, because that is where the trim lives: bulkNote
      // takes parsed input and must not re-implement the boundary's rules.
      await bulkNote(tx as never, {
        actorUserId: null,
        note: BulkNoteInput.parse({ stopIds, note: '  Detained at gate  ' }),
      });
      return tx
        .select({ note: stops.dispatcherNote })
        .from(stops)
        .where(inArray(stops.id, stopIds));
    });
    // Trimmed at the boundary, so the stored value is what was meant.
    expect(notes.map((n) => n.note)).toEqual(['Detained at gate', 'Detained at gate']);
  });

  it('records what the note replaced, not merely that it changed', async () => {
    const audit = await rolledBack(async (tx) => {
      const [stopId] = await lanes(tx, 1);
      await tx
        .update(stops)
        .set({ dispatcherNote: 'the old note' })
        .where(eq(stops.id, stopId!));
      await bulkNote(tx as never, {
        actorUserId: null,
        note: BulkNoteInput.parse({ stopIds: [stopId!], note: 'the new note' }),
      });
      const rows = await tx.execute(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (await import('drizzle-orm')).sql`
          select before::text as before, after::text as after
          from audit_log where entity_id = ${stopId}::uuid
          order by created_at desc limit 1`,
      );
      return rows as unknown as { before: string; after: string }[];
    });
    expect(audit[0]?.before).toContain('the old note');
    expect(audit[0]?.after).toContain('the new note');
  });
});
