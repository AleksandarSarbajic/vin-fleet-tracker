import { z } from 'zod/v4';
import { SEND_LIMITS } from './redact';

/**
 * The language-model reader's wire contract between the strip and
 * `POST /api/ratecon/read` (docs/llm-reader-design.md §4, §5). Shared, pure.
 *
 * Every failure is a code from a closed set. The words the dispatcher sees
 * are constants here, chosen by the browser from the code — never text the
 * server or a vendor sent.
 */

export const READ_ROUTE = '/api/ratecon/read';

/** The whole request body, read through a capped reader. */
export const READ_BODY_LIMIT_BYTES = 64 * 1024;

/** What the browser sends: the redaction's version, and the numbered lines — `n` and `text`, nothing else. */
export const ReadRequestBody = z.strictObject({
  redactionVersion: z.string().min(1).max(100),
  lines: z
    .array(z.strictObject({ n: z.number().int().min(1), text: z.string().max(SEND_LIMITS.lineChars) }))
    .min(1)
    .max(SEND_LIMITS.lines),
});
export type ReadRequestBody = z.infer<typeof ReadRequestBody>;

export type ReadFailCode =
  | 'disabled'
  | 'forbidden'
  | 'rate_limited'
  | 'capped'
  | 'too_large'
  | 'bad_request'
  | 'outdated'
  | 'not_redacted'
  | 'timeout'
  | 'unavailable'
  | 'vendor_capped'
  | 'refused'
  | 'invalid_output'
  | 'cancelled'
  | 'nothing_confirmed'
  | 'error';

export const READ_MESSAGES: Readonly<Record<ReadFailCode, string>> = {
  disabled: 'Reading with AI is turned off.',
  forbidden: 'Reading with AI needs a dispatcher’s sign-in.',
  rate_limited: 'Wait a minute and try again.',
  capped: 'Today’s AI reads are used up. Type the load, or try tomorrow.',
  too_large: 'This document is too long to send.',
  bad_request: 'This read could not be sent. Reload the page and try again.',
  outdated: 'This page is out of date. Reload it and try again.',
  not_redacted: 'This document could not be prepared for reading; nothing was sent.',
  timeout: 'The AI read took too long. Nothing was filled.',
  unavailable: 'The AI reader is not available right now. Nothing was filled.',
  vendor_capped: 'The AI reader’s spending limit is reached. Tell an admin.',
  refused: 'The AI reader declined this document. Nothing was filled.',
  invalid_output: 'The AI read came back unusable. Nothing was filled.',
  cancelled: 'Cancelled. Nothing was filled.',
  nothing_confirmed: 'The AI read could not be confirmed against the text. Nothing was filled.',
  error: 'The AI read failed. Nothing was filled.',
};

export type ReadResponse = { ok: true; read: unknown } | { ok: false; code: ReadFailCode; reference?: string };
