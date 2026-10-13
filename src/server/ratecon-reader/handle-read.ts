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
import type { AdapterFailure, ReaderAdapter } from './adapter';
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

const newReference = (status: number) => `RATECON-${status}-${Date.now().toString(36).toUpperCase()}`;

/** The dispatch zone's calendar date, YYYY-MM-DD. */
const dayIn = (tz: string, at: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

/** The body as text, or null past the limit — read in chunks, so a body with no length cannot run past it. */
async function bodyWithin(request: Request, limit: number): Promise<string | null> {
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
    const result = await deps
      .adapter()
      .read({ lines: lines.map(({ n, text }) => ({ n, text })), today: dayIn(settings.tz, deps.now()) }, signal)
      .finally(() => clearTimeout(timer));

    if (!result.ok) {
      vendorStatus = result.vendorStatus;
      const code: ReadFailCode & ReadOutcome = request.signal.aborted ? 'cancelled' : ADAPTER_CODE[result.code];
      // A refusal or a cut-off reply was billed: its tokens go in the row.
      await finishRead(deps.db, reservation, { outcome: code, ...result.usage });
      // The vendor's status is the only way to tell a revoked key (401) from
      // an outage (5xx) after the fact. Code and status only, never text.
      if (code !== 'cancelled') logReadFailure({ reference: newReference(STATUS[code]), code, errorName: 'AdapterFailure', vendorStatus });
      return fail(code);
    }
    const parsed = ModelRead.safeParse(result.output);
    if (!parsed.success) {
      // The issues are not kept: a Zod message quotes the value it received.
      await finishRead(deps.db, reservation, { outcome: 'invalid_output', ...result.usage });
      return fail('invalid_output');
    }
    await finishRead(deps.db, reservation, { outcome: 'ok', ...result.usage });
    return reply({ ok: true, read: parsed.data }, 200);
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
