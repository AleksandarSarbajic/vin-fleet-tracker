import { expect, it } from 'vitest';
import { routingBudget } from '@/db/schema';
import { describeDb, rolledBack } from '@/test/db';
import { readBudgetDay } from './budget-day';

/** §12.113. The daily counter line reads the month the finished day was in. */
describeDb('the daily routing-budget line', () => {
  it('reports the month that just ended, not the one just begun', async () => {
    const out = await rolledBack(async (tx) => {
      await tx.insert(routingBudget).values([
        { month: '2031-01', calls: 4_321 },
        { month: '2031-02', calls: 3 },
      ]);
      // Written just after midnight on 1 Feb, about the 31st of January.
      return readBudgetDay(tx, new Date(Date.UTC(2031, 0, 31)), 5_000);
    });
    expect(out).toEqual({ day: '2031-01-31', month: '2031-01', calls: 4_321, ceiling: 5_000 });
  });

  it('reads a month with no calls as zero, not as missing', async () => {
    const out = await rolledBack(async (tx) => readBudgetDay(tx, new Date(Date.UTC(2031, 5, 3)), 5_000));
    expect(out).toMatchObject({ month: '2031-06', calls: 0 });
  });
});
