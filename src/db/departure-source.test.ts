import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { auditLog, loads, stops } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import { makeTruck } from '@/test/fleet';
import type { Tx } from '@/server/audit';

/**
 * §12.118. Migration 0024: `stops.departed_source`, its paired check, the
 * backfill guard, and the bridge that keeps writers older than the column
 * working until 0025 removes it.
 */

/** Drizzle wraps the driver's error; Postgres's own message is the cause. */
async function refusal(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof Error ? cause.message : String(error);
  }
  return 'NOT REFUSED';
}

/** An arrived, not departed stop on a fresh truck. */
async function arrivedStop(tx: Tx) {
  const truck = await makeTruck(tx);
  const [load] = await tx
    .insert(loads)
    .values({ truckId: truck.id, status: 'DISPATCHED' })
    .returning({ id: loads.id });
  const [stop] = await tx
    .insert(stops)
    .values({
      loadId: load!.id,
      type: 'DEL',
      sequence: 1,
      arrivedAt: new Date(Date.now() - 2 * 3_600_000),
      arrivedSource: 'detected',
    })
    .returning({ id: stops.id });
  return stop!.id;
}

async function departure(tx: Tx, stopId: string) {
  const [row] = await tx
    .select({ at: stops.departedAt, source: stops.departedSource })
    .from(stops)
    .where(eq(stops.id, stopId));
  return row!;
}

/** The guard block, exactly as 0024 runs it. */
const GUARD = (() => {
  const text = readFileSync(join(process.cwd(), 'drizzle', '0024_departure_source.sql'), 'utf8');
  const start = text.indexOf('DO $$');
  return text.slice(start, text.indexOf('END $$;', start) + 'END $$;'.length);
})();

describeDb('the departure source bridge, until 0025 (§12.118)', () => {
  it('labels a departure written the way the old worker writes it — time only — as detected', async () => {
    const seen = await rolledBack(async (tx) => {
      const stopId = await arrivedStop(tx);
      // The deployed worker's statement: `update stops set departed_at = …`.
      await tx.execute(sql`update stops set departed_at = now() where id = ${stopId}::uuid`);
      return departure(tx, stopId);
    });
    expect(seen.at).not.toBeNull();
    expect(seen.source).toBe('detected');
  });

  it('clears the source when the old app clears the departure', async () => {
    const seen = await rolledBack(async (tx) => {
      const stopId = await arrivedStop(tx);
      await tx.execute(sql`update stops set departed_at = now() where id = ${stopId}::uuid`);
      // The deployed app's arrival clear: departed_at -> null, source untouched.
      await tx.execute(sql`update stops set departed_at = null where id = ${stopId}::uuid`);
      return departure(tx, stopId);
    });
    expect(seen).toEqual({ at: null, source: null });
  });

  it('keeps a source that was written', async () => {
    const seen = await rolledBack(async (tx) => {
      const stopId = await arrivedStop(tx);
      await tx
        .update(stops)
        .set({ departedAt: new Date(), departedSource: 'dispatcher' })
        .where(eq(stops.id, stopId));
      return departure(tx, stopId);
    });
    expect(seen.source).toBe('dispatcher');
  });

  it('pairs the two columns in the database, bridge or not', async () => {
    const message = await refusal(
      rolledBack(async (tx) => {
        const stopId = await arrivedStop(tx);
        // Lifted for this one statement, inside a transaction that rolls back.
        await tx.execute(sql`alter table stops disable trigger stops_departure_source_bridge`);
        return tx.execute(
          sql`update stops set departed_source = 'dispatcher' where id = ${stopId}::uuid`,
        );
      }),
    );
    expect(message).toMatch(/stops_departed_source_paired/);
  });
});

describeDb('the 0024 backfill guard (§12.118)', () => {
  it('refuses while a departure has no worker audit row for that instant', async () => {
    const message = await refusal(
      rolledBack(async (tx) => {
        const stopId = await arrivedStop(tx);
        await tx.execute(sql`update stops set departed_at = now() where id = ${stopId}::uuid`);
        return tx.execute(sql.raw(GUARD));
      }),
    );
    expect(message).toMatch(/1 departure\(s\) have no worker audit row/);
  });

  it('passes once the worker’s row for exactly that instant is there', async () => {
    const outcome = await rolledBack(async (tx) => {
      const stopId = await arrivedStop(tx);
      // An hour ago, after the fixture's arrival, at the millisecond the worker logs.
      const at = new Date(Date.now() - 3_600_000).toISOString();
      await tx.execute(sql`update stops set departed_at = ${at}::timestamptz where id = ${stopId}::uuid`);
      await tx.insert(auditLog).values({
        entity: 'stop',
        entityId: stopId,
        before: {},
        after: { departedAt: at, source: 'worker' },
      });
      await tx.execute(sql.raw(GUARD));
      return 'passed';
    });
    expect(outcome).toBe('passed');
  });
});
