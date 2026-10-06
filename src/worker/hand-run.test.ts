import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { routingBudget } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import type { Tx } from '@/server/audit';
import { checkRunBudget, meteredCall } from './hand-run';

/**
 * §12.113. Hand-run routing calls are counted in `routing_budget`, by the
 * worker's own `countCall`, before each call is made.
 *
 * A month nobody else writes to, so the counter's starting value is known.
 */
const NOW = new Date(Date.UTC(2031, 0, 15));
const MONTH = '2031-01';

async function spent(tx: Tx): Promise<number> {
  const [row] = await tx
    .select({ calls: routingBudget.calls })
    .from(routingBudget)
    .where(eq(routingBudget.month, MONTH));
  return row?.calls ?? 0;
}

async function startAt(tx: Tx, calls: number) {
  await tx.insert(routingBudget).values({ month: MONTH, calls });
}

describeDb('hand-run routing calls', () => {
  it('raises the month count by exactly the calls the run made', async () => {
    const seen = await rolledBack(async (tx) => {
      await startAt(tx, 100);
      const budget = await checkRunBudget(tx, 4, 5_000, NOW);
      const answers: number[] = [];
      for (let i = 0; i < 4; i += 1) answers.push(await meteredCall(tx, budget.month, async () => i));
      return { budget, answers, after: await spent(tx) };
    });
    expect(seen.budget).toMatchObject({ month: MONTH, spent: 100, remaining: 4_900, needed: 4, ok: true });
    expect(seen.answers).toEqual([0, 1, 2, 3]);
    expect(seen.after).toBe(104);
  });

  it('counts the first call of a month that has no row yet', async () => {
    const after = await rolledBack(async (tx) => {
      await meteredCall(tx, MONTH, async () => null);
      return spent(tx);
    });
    expect(after).toBe(1);
  });

  it('refuses a run the month cannot cover, and says what it needs and has', async () => {
    const budget = await rolledBack(async (tx) => {
      await startAt(tx, 4_997);
      return checkRunBudget(tx, 4, 5_000, NOW);
    });
    expect(budget).toMatchObject({ spent: 4_997, needed: 4, remaining: 3, ok: false });
  });

  it('reads a month already past the ceiling as nothing left, not negative', async () => {
    const budget = await rolledBack(async (tx) => {
      await startAt(tx, 5_012);
      return checkRunBudget(tx, 2, 5_000, NOW);
    });
    expect(budget).toMatchObject({ remaining: 0, ok: false });
  });

  it('never counts a call it did not make: a failure stops the count with the run', async () => {
    const seen = await rolledBack(async (tx) => {
      await startAt(tx, 10);
      let made = 0;
      let error: unknown = null;
      try {
        for (let i = 0; i < 4; i += 1) {
          await meteredCall(tx, MONTH, async () => {
            made += 1;
            if (i === 1) throw new Error('HERE timed out');
          });
        }
      } catch (e) {
        error = e;
      }
      return { made, error, after: await spent(tx) };
    });
    // Two calls were made — the second failed, and still counts, as in the
    // worker — and the two never made are not counted.
    expect(seen.made).toBe(2);
    expect(seen.error).toBeInstanceOf(Error);
    expect(seen.after).toBe(12);
  });
});
