import 'server-only';
import { AuthError, requireRole } from '@/lib/auth';
import { OUTCOME_BODY_LIMIT_BYTES, OutcomeBody, type OutcomeFailCode, type OutcomeResponse } from '@/lib/ratecon/outcome-codes';
import { RateLimitError, clientAddress, enforceRateLimit, rateLimitResponse } from '@/server/rate-limit';
import { bodyWithin, newReference, type ReadDeps } from './handle-read';
import { logOutcomeFailure } from './log';
import { recordOutcome } from './outcomes';

/**
 * `POST /api/ratecon/outcome` (docs/llm-reader-design.md §4; Alex,
 * 2026-10-14): what the dispatcher did with an AI read, as counts. The route
 * file only wires the live dependencies to this.
 *
 * The browser is UNTRUSTED. The body is a read id, counts per field name
 * from a fixed list, and the read's layout as at most 64 hashes of 8 hex
 * characters (2026-10-15), parsed strictly, bounded by what a read can fill;
 * nothing in it drives behaviour beyond being stored. The read must be the caller's
 * own and have answered. The order: the address limit; a dispatcher or admin;
 * the reader on (when it is off there is nothing to record); the user's
 * write limit — its own, not the reader's three-a-minute; the body.
 *
 * It is never on the path of a save: the modal sends it AFTER the load has
 * saved, and a failure here is one log line of a code, never the request's
 * contents, and never an error that escapes.
 */

type Deps = Pick<ReadDeps, 'db' | 'settings'>;

const STATUS: Record<OutcomeFailCode, number> = {
  disabled: 404,
  forbidden: 403,
  rate_limited: 429,
  too_large: 413,
  bad_request: 400,
  unknown_read: 404,
  error: 500,
};

const reply = (body: OutcomeResponse, status: number) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const fail = (code: OutcomeFailCode) => reply({ ok: false, code }, STATUS[code]);

export async function handleOutcome(request: Request, deps: Deps): Promise<Response> {
  try {
    await enforceRateLimit('address', clientAddress(request));
    const user = await requireRole('dispatcher');
    if (!deps.settings.enabled || deps.settings.vendor === null) return fail('disabled');
    await enforceRateLimit('write', user.id);

    const raw = await bodyWithin(request, OUTCOME_BODY_LIMIT_BYTES);
    if (raw === null) return fail('too_large');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // The parse error is not kept: it can quote the body.
      return fail('bad_request');
    }
    // Zod's issues are not kept either: a message quotes the value it received.
    const body = OutcomeBody.safeParse(parsed);
    if (!body.success) return fail('bad_request');

    const result = await recordOutcome(deps.db, { userId: user.id, readId: body.data.readId, fields: body.data.fields, layout: body.data.layout ?? [] });
    return result === 'unknown_read' ? fail('unknown_read') : reply({ ok: true, recorded: result === 'recorded' }, 200);
  } catch (error: unknown) {
    if (error instanceof RateLimitError) return rateLimitResponse(error);
    if (error instanceof AuthError) return reply({ ok: false, code: 'forbidden' }, error.status);
    const reference = newReference(500);
    logOutcomeFailure({ reference, code: 'error', errorName: error instanceof Error ? error.name : typeof error });
    return reply({ ok: false, code: 'error', reference }, 500);
  }
}
