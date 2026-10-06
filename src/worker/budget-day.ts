import { eq } from 'drizzle-orm';
import { routingBudget } from '@/db/schema';
import { budgetMonth } from '@/lib/routing';
import type { Db, Tx } from '@/server/audit';

/**
 * The routing counter's month total, once a day (§12.113), for setting beside
 * HERE's usage report.
 *
 * Reported for the month the finished DAY belongs to, not the month it is
 * now: the line written just after midnight on the 1st carries the previous
 * month's final count, which is the figure HERE's monthly report is compared
 * against. Read-only; the routing job is untouched.
 */
export interface BudgetDay {
  /** The UTC day just finished, `YYYY-MM-DD`. */
  day: string;
  /** `YYYY-MM`, the month that day belongs to. */
  month: string;
  calls: number;
  ceiling: number;
}

export async function readBudgetDay(
  db: Db | Tx,
  dayStart: Date,
  ceiling: number,
): Promise<BudgetDay> {
  const month = budgetMonth(dayStart);
  const [row] = await db
    .select({ calls: routingBudget.calls })
    .from(routingBudget)
    .where(eq(routingBudget.month, month))
    .limit(1);
  return { day: dayStart.toISOString().slice(0, 10), month, calls: row?.calls ?? 0, ceiling };
}
