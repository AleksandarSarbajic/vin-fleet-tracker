import { eq } from 'drizzle-orm';
import { routingBudget } from '@/db/schema';
import { budgetMonth } from '@/lib/routing';
import type { Db, Tx } from '@/server/audit';
import { countCall } from './routing';

/**
 * Routing calls made by hand — `npm run route:compare` — counted like the
 * worker's (§12.113).
 *
 * On 22 September HERE billed 24 truck transactions the counter never saw:
 * the comparison script and a scratch probe called HERE directly. With the
 * ceiling at exactly HERE's free 5,000 (§12.61), an uncounted call in a month
 * the worker reaches the ceiling is a billed one. So a hand run now asks the
 * budget first, and counts each call with the worker's own `countCall`
 * immediately before making it.
 */

type Conn = Db | Tx;

export interface RunBudget {
  month: string;
  spent: number;
  ceiling: number;
  remaining: number;
  needed: number;
  /** False when the month's remaining calls cannot cover the run. */
  ok: boolean;
}

/** Whether a run of `needed` calls fits in what is left this month. */
export async function checkRunBudget(
  db: Conn,
  needed: number,
  ceiling: number,
  now: Date = new Date(),
): Promise<RunBudget> {
  const month = budgetMonth(now);
  const [row] = await db
    .select({ calls: routingBudget.calls })
    .from(routingBudget)
    .where(eq(routingBudget.month, month))
    .limit(1);
  const spent = row?.calls ?? 0;
  const remaining = Math.max(0, ceiling - spent);
  return { month, spent, ceiling, remaining, needed, ok: needed <= remaining };
}

/**
 * One call, counted first. A call that then fails still counted — it may
 * still have been billed, which is the worker's rule too — and a call never
 * made is never counted, because nothing is counted ahead of time.
 */
export async function meteredCall<T>(db: Conn, month: string, call: () => Promise<T>): Promise<T> {
  await countCall(db, month);
  return call();
}
