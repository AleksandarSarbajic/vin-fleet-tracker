/**
 * Token bucket. Self-imposed: this org's responses carry no X-RateLimit-*
 * and no Retry-After header (docs/samsara.md §7), so there is no budget to
 * read. One 30s poller is nowhere near Samsara's published limits — the
 * limiter exists so a retry storm or an accidental second worker instance
 * cannot get there either.
 *
 * Pure except for the clock, which is injected so it can be tested without
 * waiting.
 */
export interface TokenBucketOptions {
  /** Maximum burst. */
  capacity: number;
  /** Sustained rate. */
  refillPerSecond: number;
  now?: () => number;
}

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly now: () => number;

  constructor(private readonly options: TokenBucketOptions) {
    this.now = options.now ?? Date.now;
    this.tokens = options.capacity;
    this.lastRefill = this.now();
  }

  private refill(): void {
    const at = this.now();
    const elapsedSeconds = (at - this.lastRefill) / 1000;
    if (elapsedSeconds <= 0) return;
    this.tokens = Math.min(
      this.options.capacity,
      this.tokens + elapsedSeconds * this.options.refillPerSecond,
    );
    this.lastRefill = at;
  }

  /** Takes a token if one is available. Does not wait. */
  tryTake(): boolean {
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  /** Milliseconds until the next token, or 0 if one is available now. */
  msUntilToken(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    const deficit = 1 - this.tokens;
    return Math.ceil((deficit / this.options.refillPerSecond) * 1000);
  }

  get available(): number {
    this.refill();
    return this.tokens;
  }
}
