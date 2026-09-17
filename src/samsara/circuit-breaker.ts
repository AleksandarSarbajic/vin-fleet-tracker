/**
 * Circuit breaker. Stops hammering a dead API.
 *
 *   closed    → normal.
 *   open      → fail fast for cooldownMs. The feed is already stale; adding
 *               load to a struggling API does not make it less stale.
 *   half-open → let exactly one probe through. Success closes; failure
 *               re-opens with a fresh cooldown.
 */
export type BreakerState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  cooldownMs: number;
  now?: () => number;
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private probing = false;
  private readonly now: () => number;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.now = options.now ?? Date.now;
  }

  get state(): BreakerState {
    if (this.openedAt === null) return 'closed';
    if (this.now() - this.openedAt >= this.options.cooldownMs) return 'half-open';
    return 'open';
  }

  /** False means fail fast without making the call. */
  canRequest(): boolean {
    const state = this.state;
    if (state === 'closed') return true;
    if (state === 'open') return false;
    if (this.probing) return false;
    this.probing = true;
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
    this.probing = false;
  }

  recordFailure(): void {
    this.probing = false;
    this.failures += 1;
    if (this.failures >= this.options.failureThreshold) {
      this.openedAt = this.now();
    }
  }

  get consecutiveFailures(): number {
    return this.failures;
  }
}
