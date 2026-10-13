import type { SentLine } from '@/lib/ratecon/redact';

/**
 * The language-model reader's vendor seam (docs/llm-reader-design.md §6).
 * TYPES ONLY in phase 1: no vendor, no network, no route.
 *
 * Phase 2: every real adapter, and the route that calls one, imports
 * 'server-only' so a client import fails the build. Not imported here: this
 * file holds no code, and vitest cannot import that module outside a server
 * build.
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

export interface ReaderAdapter {
  readonly vendor: string;
  readonly model: string;
  /**
   * Never throws, never logs, never retries. An aborted `signal` is
   * `timeout`. No error text from the vendor is ever carried out: it can
   * quote the document.
   */
  read(lines: readonly SentLine[], signal: AbortSignal): Promise<AdapterResult>;
}
