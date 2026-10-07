import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { auditLog, loads, stops } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import { makeTruck } from '@/test/fleet';
import type { Tx } from '@/server/audit';

/**
 * §12.118. `stops.departed_source`: its paired check (0024), the backfill
 * guard (0024), and the rule with no bridge left (0025).
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

/**
 * Since 0025 the bridge is gone, and the paired check is the whole rule: the
 * two writes it used to translate — the pre-0024 worker's time-only departure
 * and the pre-0024 app's time-only clear — are refused. That is why 0025 is
 * applied only once the worker and the app that write the source are live.
 */
describeDb('a departure and its source, since 0025 (§12.118)', () => {
  it('has no bridge left', async () => {
    const triggers = await rolledBack(async (tx) =>
      tx.execute(sql`select tgname from pg_trigger where tgname = 'stops_departure_source_bridge'`),
    );
    expect([...triggers]).toEqual([]);
  });

  it('refuses a departure written the way the old worker wrote it — time only', async () => {
    const message = await refusal(
      rolledBack(async (tx) => {
        const stopId = await arrivedStop(tx);
        return tx.execute(sql`update stops set departed_at = now() where id = ${stopId}::uuid`);
      }),
    );
    expect(message).toMatch(/stops_departed_source_paired/);
  });

  it('refuses a clear written the way the old app wrote it — time only', async () => {
    const message = await refusal(
      rolledBack(async (tx) => {
        const stopId = await arrivedStop(tx);
        await tx
          .update(stops)
          .set({ departedAt: new Date(), departedSource: 'detected' })
          .where(eq(stops.id, stopId));
        return tx.execute(sql`update stops set departed_at = null where id = ${stopId}::uuid`);
      }),
    );
    expect(message).toMatch(/stops_departed_source_paired/);
  });

  it('keeps a source that was written, and clears both together', async () => {
    const seen = await rolledBack(async (tx) => {
      const stopId = await arrivedStop(tx);
      await tx
        .update(stops)
        .set({ departedAt: new Date(), departedSource: 'dispatcher' })
        .where(eq(stops.id, stopId));
      const written = await departure(tx, stopId);
      await tx
        .update(stops)
        .set({ departedAt: null, departedSource: null })
        .where(eq(stops.id, stopId));
      return { written, cleared: await departure(tx, stopId) };
    });
    expect(seen.written.source).toBe('dispatcher');
    expect(seen.cleared).toEqual({ at: null, source: null });
  });

  it('refuses a source with no departure', async () => {
    const message = await refusal(
      rolledBack(async (tx) => {
        const stopId = await arrivedStop(tx);
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
        await tx.execute(
          sql`update stops set departed_at = now(), departed_source = 'detected' where id = ${stopId}::uuid`,
        );
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
      await tx.execute(
        sql`update stops set departed_at = ${at}::timestamptz, departed_source = 'detected' where id = ${stopId}::uuid`,
      );
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
