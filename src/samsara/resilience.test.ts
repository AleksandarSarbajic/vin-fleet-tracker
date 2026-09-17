import { describe, expect, it } from 'vitest';
import { backoffDelayMs, retryAfterMs } from './backoff';
import { CircuitBreaker } from './circuit-breaker';
import { TokenBucket } from './rate-limit';

describe('TokenBucket', () => {
  it('allows a burst up to capacity, then refuses', () => {
    const t = 0;
    const b = new TokenBucket({ capacity: 3, refillPerSecond: 1, now: () => t });
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(false);
  });

  it('refills at the configured rate', () => {
    let t = 0;
    const b = new TokenBucket({ capacity: 2, refillPerSecond: 2, now: () => t });
    b.tryTake();
    b.tryTake();
    expect(b.tryTake()).toBe(false);
    t += 500; // 0.5s at 2/s = one token
    expect(b.tryTake()).toBe(true);
  });

  it('never exceeds capacity however long it idles', () => {
    let t = 0;
    const b = new TokenBucket({ capacity: 2, refillPerSecond: 10, now: () => t });
    t += 60_000;
    expect(b.available).toBe(2);
  });

  it('reports how long until the next token', () => {
    const t = 0;
    const b = new TokenBucket({ capacity: 1, refillPerSecond: 2, now: () => t });
    b.tryTake();
    expect(b.msUntilToken()).toBe(500); // one token at 2/s
  });
});

describe('backoffDelayMs', () => {
  it('grows exponentially in its upper bound', () => {
    const atMax = (attempt: number) =>
      backoffDelayMs(attempt, { baseMs: 100, maxMs: 100_000, random: () => 0.999999 });
    expect(atMax(0)).toBeGreaterThanOrEqual(99);
    expect(atMax(1)).toBeGreaterThanOrEqual(199);
    expect(atMax(2)).toBeGreaterThanOrEqual(399);
    expect(atMax(3)).toBeGreaterThanOrEqual(799);
  });

  it('respects the cap', () => {
    const d = backoffDelayMs(20, { baseMs: 500, maxMs: 30_000, random: () => 0.999999 });
    expect(d).toBeLessThanOrEqual(30_000);
  });

  it('uses FULL jitter — the floor is 0, not the cap', () => {
    // Equal-length sleeps re-synchronise every retrying client into one
    // spike. The whole interval is randomised precisely to avoid that.
    expect(backoffDelayMs(5, { baseMs: 500, maxMs: 30_000, random: () => 0 })).toBe(0);
  });
});

describe('retryAfterMs', () => {
  it('reads a seconds value', () => expect(retryAfterMs('12')).toBe(12_000));
  it('reads an HTTP date', () => {
    const now = Date.parse('2026-09-17T08:00:00Z');
    expect(retryAfterMs('Thu, 17 Sep 2026 08:00:30 GMT', now)).toBe(30_000);
  });
  it('is null when absent or unparseable', () => {
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs('soon')).toBeNull();
  });
  it('never returns a negative wait for a past date', () => {
    const now = Date.parse('2026-09-17T08:00:00Z');
    expect(retryAfterMs('Thu, 17 Sep 2026 07:00:00 GMT', now)).toBe(0);
  });
});

describe('CircuitBreaker', () => {
  const make = (now: () => number) =>
    new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, now });

  it('stays closed below the threshold', () => {
    const b = make(() => 0);
    b.recordFailure();
    b.recordFailure();
    expect(b.state).toBe('closed');
    expect(b.canRequest()).toBe(true);
  });

  it('opens at the threshold and fails fast', () => {
    const b = make(() => 0);
    for (let i = 0; i < 3; i += 1) b.recordFailure();
    expect(b.state).toBe('open');
    expect(b.canRequest()).toBe(false);
  });

  it('half-opens after the cooldown and admits exactly one probe', () => {
    let t = 0;
    const b = make(() => t);
    for (let i = 0; i < 3; i += 1) b.recordFailure();
    t = 1000;
    expect(b.state).toBe('half-open');
    expect(b.canRequest()).toBe(true); // the probe
    expect(b.canRequest()).toBe(false); // nothing else gets through
  });

  it('closes on a successful probe', () => {
    let t = 0;
    const b = make(() => t);
    for (let i = 0; i < 3; i += 1) b.recordFailure();
    t = 1000;
    b.canRequest();
    b.recordSuccess();
    expect(b.state).toBe('closed');
    expect(b.consecutiveFailures).toBe(0);
  });

  it('re-opens with a fresh cooldown when the probe fails', () => {
    let t = 0;
    const b = make(() => t);
    for (let i = 0; i < 3; i += 1) b.recordFailure();
    t = 1000;
    b.canRequest();
    b.recordFailure();
    expect(b.state).toBe('open');
    t = 1999;
    expect(b.state).toBe('open');
    t = 2000;
    expect(b.state).toBe('half-open');
  });

  it('a success resets the failure count, so blips do not accumulate', () => {
    const b = make(() => 0);
    b.recordFailure();
    b.recordFailure();
    b.recordSuccess();
    b.recordFailure();
    b.recordFailure();
    expect(b.state).toBe('closed');
  });
});
