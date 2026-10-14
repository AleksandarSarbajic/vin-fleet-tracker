import 'server-only';
import { AuthError, requireRole } from '@/lib/auth';
import { ModelRead } from '@/lib/ratecon/model-read';
import {
  READ_BODY_LIMIT_BYTES,
  ReadRequestBody,
  type ReadFailCode,
  type ReadResponse,
} from '@/lib/ratecon/read-codes';
import { REDACTION_VERSION, SEND_LIMITS, residue } from '@/lib/ratecon/redact';
import type { Db } from '@/server/audit';
import { RateLimitError, clientAddress, enforceRateLimit, rateLimitResponse } from '@/server/rate-limit';
import type { AdapterFailure, AdapterResult, AdapterUsage, ReaderAdapter } from './adapter';
import { logReadFailure } from './log';
import { finishRead, reserveRead, type ReadOutcome, type ReadVendor } from './reads';

/**
 * `POST /api/ratecon/read` (docs/llm-reader-design.md §4, §5). The route
 * file only wires the live dependencies to this.
 *
 * The order of checks: the address limit; a dispatcher or admin; the flag;
 * the user's rate limit; the body — its size, its shape, its redaction's
 * version, a second redaction scan — and only then the daily cap's
 * reservation, so a request refused for its body never spends a read; then
 * the vendor, under the server's own timeout; then the reply's schema.
 *
 * A read is a PAIR (two-read agreement, §3–§5; Alex, 2026-10-14): ONE
 * reservation, then TWO vendor calls with the same lines, made at once, each
 * under the server's timeout and the request's cancellation. The pair FAILS
 * AS A WHOLE when either call fails — at the adapter or at the schema — with
 * read A's code, else read B's, and returns neither reply: there is never a
 * read to fall back to. The counts row is the pair's: one row, the pair's
 * outcome, both calls' tokens.
 *
 * Never lets an error escape (an escaping error reaches Sentry with its
 * message), never returns or logs text from a document or a vendor, and
 * stores nothing but the counts row. It does not verify the reply: the
 * browser does, against exactly the lines it sent.
 */

export interface ReadSettings {
  enabled: boolean;
  vendor: ReadVendor | null;
  userCap: number;
  dailyCap: number;
  /** The dispatch zone: today's date for the request, and the caps' day. */
  tz: string;
}

export interface ReadDeps {
  db: Db;
  settings: ReadSettings;
  adapter: () => ReaderAdapter;
  timeoutMs: number;
  now: () => Date;
}

const STATUS: Record<ReadFailCode, number> = {
  disabled: 404,
  forbidden: 403,
  rate_limited: 429,
  capped: 429,
  too_large: 413,
  bad_request: 400,
  outdated: 409,
  not_redacted: 422,
  timeout: 504,
  unavailable: 503,
  // The account's own spending limit: nothing the dispatcher can retry.
  vendor_capped: 503,
  refused: 422,
  invalid_output: 502,
  // The dispatcher has gone; the status is for the log, not for them.
  cancelled: 499,
  nothing_confirmed: 422,
  error: 500,
};

const ADAPTER_CODE: Record<AdapterFailure, ReadFailCode & ReadOutcome> = {
  timeout: 'timeout',
  unavailable: 'unavailable',
  refused: 'refused',
  malformed: 'invalid_output',
  vendor_capped: 'vendor_capped',
};

const reply = (body: ReadResponse, status: number, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });
const fail = (code: ReadFailCode) => reply({ ok: false, code }, STATUS[code]);

export const newReference = (status: number) => `RATECON-${status}-${Date.now().toString(36).toUpperCase()}`;

/** The dispatch zone's calendar date, YYYY-MM-DD. */
const dayIn = (tz: string, at: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

/** The body as text, or null past the limit — read in chunks, so a body with no length cannot run past it. */
export async function bodyWithin(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > limit) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Refused for its body, before any read is reserved. Null when it may go on. */
function judgeBody(raw: string): { code: ReadFailCode } | { body: ReadRequestBody } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // The parse error is not kept: it can quote the body.
    return { code: 'bad_request' };
  }
  // Size first, so a document that is merely long says so rather than "malformed".
  const lines = (parsed as { lines?: unknown }).lines;
  if (Array.isArray(lines)) {
    const texts = lines.map((l) => (l as { text?: unknown }).text).filter((t): t is string => typeof t === 'string');
    const total = texts.reduce((n, t) => n + t.length, 0);
    if (lines.length > SEND_LIMITS.lines || texts.some((t) => t.length > SEND_LIMITS.lineChars) || total > SEND_LIMITS.totalChars) {
      return { code: 'too_large' };
    }
  }
  const body = ReadRequestBody.safeParse(parsed);
  if (!body.success) return { code: 'bad_request' };
  if (body.data.redactionVersion !== REDACTION_VERSION) return { code: 'outdated' };
  if (body.data.lines.some((l) => residue(l.text).length > 0)) return { code: 'not_redacted' };
  return { body: body.data };
}

/** One call of a pair, as the route sees it: its reply (schema-valid), or the code it failed with. */
type Side =
  | { ok: true; read: ModelRead }
  | { ok: false; code: ReadFailCode & ReadOutcome; vendorStatus: number | null; fromAdapter: boolean };

function judgeSide(result: AdapterResult, cancelled: boolean): Side {
  if (!result.ok) {
    return { ok: false, code: cancelled ? 'cancelled' : ADAPTER_CODE[result.code], vendorStatus: result.vendorStatus, fromAdapter: true };
  }
  const parsed = ModelRead.safeParse(result.output);
  // The issues are not kept: a Zod message quotes the value it received.
  return parsed.success ? { ok: true, read: parsed.data } : { ok: false, code: 'invalid_output', vendorStatus: null, fromAdapter: false };
}

/** The reply of a side known to have succeeded (the caller has checked both). */
function sideRead(side: Side | undefined): ModelRead {
  if (!side || !side.ok) throw new Error('A pair that succeeded lacks a read.');
  return side.read;
}

/** What both calls billed, summed: nothing when neither said (the row then holds no count, not a zero). */
function billed(results: readonly AdapterResult[]): Partial<AdapterUsage> {
  const reported = results.map((r) => r.usage).filter((u): u is AdapterUsage => u !== undefined);
  if (reported.length === 0) return {};
  return {
    inputTokens: reported.reduce((n, u) => n + u.inputTokens, 0),
    outputTokens: reported.reduce((n, u) => n + u.outputTokens, 0),
  };
}

export async function handleRead(request: Request, deps: ReadDeps): Promise<Response> {
  let reservation: string | null = null;
  let vendorStatus: number | null = null;
  try {
    await enforceRateLimit('address', clientAddress(request));
    const user = await requireRole('dispatcher');
    const { settings } = deps;
    if (!settings.enabled || settings.vendor === null) return fail('disabled');
    await enforceRateLimit('llm', user.id);

    const raw = await bodyWithin(request, READ_BODY_LIMIT_BYTES);
    if (raw === null) return fail('too_large');
    const judged = judgeBody(raw);
    if ('code' in judged) return fail(judged.code);
    const { lines } = judged.body;

    const reserved = await reserveRead(deps.db, {
      userId: user.id,
      vendor: settings.vendor,
      linesSent: lines.length,
      tz: settings.tz,
      userCap: settings.userCap,
      dailyCap: settings.dailyCap,
    });
    if ('capped' in reserved) return fail('capped');
    reservation = reserved.id;

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), deps.timeoutMs);
    const signal = AbortSignal.any([timeout.signal, request.signal]);
    const adapter = deps.adapter();
    const readRequest = { lines: lines.map(({ n, text }) => ({ n, text })), today: dayIn(settings.tz, deps.now()) };
    // Two calls at once, so a read takes about as long as one. An adapter never throws.
    const results = await Promise.all([adapter.read(readRequest, signal), adapter.read(readRequest, signal)]).finally(() => clearTimeout(timer));
    const sides = results.map((result) => judgeSide(result, request.signal.aborted));
    const usage = billed(results);

    // The pair's code: read A's when A failed, else read B's. Nothing of either reply is returned.
    const failed = sides.find((side) => !side.ok);
    if (failed && !failed.ok) {
      vendorStatus = failed.vendorStatus;
      // A refusal or a cut-off reply was billed: its tokens, and the other call's, go in the row.
      await finishRead(deps.db, reservation, { outcome: failed.code, ...usage });
      // The vendor's status is the only way to tell a revoked key (401) from
      // an outage (5xx) after the fact. Code and status only, never text.
      if (failed.fromAdapter && failed.code !== 'cancelled') {
        logReadFailure({ reference: newReference(STATUS[failed.code]), code: failed.code, errorName: 'AdapterFailure', vendorStatus });
      }
      return fail(failed.code);
    }
    await finishRead(deps.db, reservation, { outcome: 'ok', ...usage });
    return reply({ ok: true, reads: [sideRead(sides[0]), sideRead(sides[1])], readId: reservation }, 200);
  } catch (error: unknown) {
    // The 429 every route gives; the browser reads a 429 with no code as rate_limited.
    if (error instanceof RateLimitError) return rateLimitResponse(error);
    if (error instanceof AuthError) return reply({ ok: false, code: 'forbidden' }, error.status);
    const reference = newReference(500);
    logReadFailure({
      reference,
      code: 'error',
      errorName: error instanceof Error ? error.name : typeof error,
      vendorStatus,
    });
    if (reservation !== null) {
      // The read still counts; its row says it failed. If even this write
      // fails, the 500 below still stands, and the row stays 'pending' —
      // counted, as a crashed read must be.
      await finishRead(deps.db, reservation, { outcome: 'error' }).catch((rowError: unknown) =>
        logReadFailure({
          reference,
          code: 'error',
          errorName: rowError instanceof Error ? rowError.name : typeof rowError,
          vendorStatus,
        }),
      );
    }
    return reply({ ok: false, code: 'error', reference }, 500);
  }
}
