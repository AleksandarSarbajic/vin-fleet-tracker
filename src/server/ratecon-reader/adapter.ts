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

export type AdapterFailure = 'timeout' | 'unavailable' | 'refused' | 'malformed';

export type AdapterResult =
  | { ok: true; output: unknown; usage: { inputTokens: number; outputTokens: number } }
  | { ok: false; code: AdapterFailure; vendorStatus: number | null };

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
