/**
 * Exponential backoff with FULL jitter.
 *
 * Full jitter — a uniform pick from [0, cap] rather than cap itself — is the
 * point. Equal-length sleeps re-synchronise every retrying client into the
 * same instant, so the second attempt arrives as one spike just like the
 * first. Randomising the whole interval spreads them.
 */
export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  /** Injected for tests. */
  random?: () => number;
}

export function backoffDelayMs(
  attempt: number,
  { baseMs, maxMs, random = Math.random }: BackoffOptions,
): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.floor(random() * exponential);
}

/** Honours Retry-After (seconds, or an HTTP date) when the server sends one. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const at = Date.parse(header);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
