import { z } from 'zod/v4';
import { ModelRead } from './model-read';
import { READ_MESSAGES, READ_ROUTE, type ReadFailCode } from './read-codes';
import { REDACTION_VERSION, type PreparedLine } from './redact';

/**
 * The browser's half of "Read with AI" (docs/llm-reader-design.md §4, §5).
 *
 * Sends the redaction's version and each prepared line as `n` and `text` —
 * never its page — and turns every answer into a code from the closed set.
 * Never throws. A read is a PAIR (Alex, 2026-10-14): the server answers with
 * both model reads or with a code. Each is checked against the schema again
 * here, and a pair with anything else in it — one reply, three, a reply that
 * fails — is `invalid_output`: the pair fails as a whole. `readPair` verifies
 * and merges them next, against exactly these lines.
 */

/** Past the server's own 25 s, so the server's timeout is the one that usually speaks. */
export const BROWSER_TIMEOUT_MS = 35_000;

export type ClientReadOutcome =
  | {
      ok: true;
      replies: [ModelRead, ModelRead];
      /** The read's counts row, to link what the dispatcher does with it; null when the server named none. */
      readId: string | null;
    }
  | { ok: false; code: ReadFailCode; reference?: string };

/** Every code the server can send: the keys of its messages, so a new code cannot be missed here. */
const CODES: ReadonlySet<string> = new Set(Object.keys(READ_MESSAGES));

/** When the body names no code this side knows: the status alone. */
function byStatus(status: number): ReadFailCode {
  if (status === 401 || status === 403) return 'forbidden';
  if (status === 404) return 'disabled';
  if (status === 413) return 'too_large';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'unavailable';
  return 'error';
}

async function bodyOf(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await response.json();
    return body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    // Not JSON — a gateway's page. The status alone decides (byStatus).
    return null;
  }
}

export async function requestModelReads(
  lines: readonly PreparedLine[],
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<ClientReadOutcome> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), BROWSER_TIMEOUT_MS);
  try {
    const response = await fetcher(READ_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redactionVersion: REDACTION_VERSION, lines: lines.map(({ n, text }) => ({ n, text })) }),
      signal: AbortSignal.any([signal, timeout.signal]),
    });
    const body = await bodyOf(response);
    if (response.ok && body?.ok === true) {
      const replies = z.tuple([ModelRead, ModelRead]).safeParse(body.reads);
      const readId = z.string().uuid().safeParse(body.readId);
      return replies.success ? { ok: true, replies: replies.data, readId: readId.success ? readId.data : null } : { ok: false, code: 'invalid_output' };
    }
    const code = typeof body?.code === 'string' && CODES.has(body.code) ? (body.code as ReadFailCode) : byStatus(response.status);
    return typeof body?.reference === 'string' ? { ok: false, code, reference: body.reference } : { ok: false, code };
  } catch {
    // An abort, or the network: which one is in the signals, not the error.
    if (timeout.signal.aborted) return { ok: false, code: 'timeout' };
    if (signal.aborted) return { ok: false, code: 'cancelled' };
    return { ok: false, code: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}
