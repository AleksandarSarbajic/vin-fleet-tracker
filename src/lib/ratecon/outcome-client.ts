import { z } from 'zod/v4';
import { OUTCOME_ROUTE, type OutcomeBody } from './outcome-codes';

/**
 * The browser's half of "what the dispatcher did with an AI read"
 * (docs/llm-reader-design.md §4): sends the read id and the counts, and says
 * whether they were recorded. It runs AFTER a load has saved and NEVER throws
 * or rejects: any failure is `false`, for the caller to count. `keepalive`
 * lets the browser finish the request if the page moves on.
 */

const Answer = z.object({ ok: z.literal(true) });

export async function postOutcome(body: OutcomeBody, fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetcher(OUTCOME_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    });
    return response.ok && Answer.safeParse(await response.json()).success;
  } catch {
    // The network, or an answer that is not JSON: not recorded. The caller counts it.
    return false;
  }
}
