import type { SentLine } from '@/lib/ratecon/redact';

/**
 * The language-model reader's vendor seam (docs/llm-reader-design.md §6).
 * Types only. Every module with code behind this seam — the fake, each real
 * adapter, the route — imports 'server-only', so a client import fails the
 * build; tests mock it, as every server test here does.
 *
 * Each adapter turns the shared instruction and JSON schema
 * (`model-read.ts`) into its vendor's request, sets its vendor's no-storage
 * and region options in code, and maps every outcome to a result. The
 * route validates `output` with `ModelRead`; the adapter never interprets it.
 */

/**
 * `vendor_capped`: the vendor refused because the account's own spending
 * limit is reached — only an admin can clear it.
 */
export type AdapterFailure = 'timeout' | 'unavailable' | 'refused' | 'malformed' | 'vendor_capped';

export interface AdapterUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * A failure carries `usage` when the vendor answered and billed for it — a
 * refusal, a reply cut off at its token limit, a reply that is not JSON — so
 * the counts row records what was spent.
 */
export type AdapterResult =
  | { ok: true; output: unknown; usage: AdapterUsage }
  | { ok: false; code: AdapterFailure; vendorStatus: number | null; usage?: AdapterUsage };

/** One read: the redacted, numbered lines, and today's date in the dispatch zone (YYYY-MM-DD). */
export interface ReaderRequest {
  lines: readonly SentLine[];
  today: string;
}

export interface ReaderAdapter {
  readonly vendor: string;
  readonly model: string;
  /**
   * Never throws, never logs, never retries. An aborted `signal` is
   * `timeout`. No error text from the vendor is ever carried out: it can
   * quote the document. A real adapter sends `modelInput(lines, today)`
   * (`model-read.ts`) and nothing else from the request.
   */
  read(request: ReaderRequest, signal: AbortSignal): Promise<AdapterResult>;
}
