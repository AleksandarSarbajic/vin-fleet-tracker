import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  LIMITS,
  MemoryRateLimitStore,
  RateLimitError,
  clientAddress,
  enforceRateLimit,
  setRateLimitStore,
} from './rate-limit';

/**
 * Inbound limiting (phase 6, item 3). `samsara/client.ts` limited what we send;
 * nothing limited what we receive.
 */

/** A clock we control, so nothing here waits on real seconds. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('the token bucket, used inbound', () => {
  it('allows a burst up to capacity and then refuses', async () => {
    const c = clock();
    const store = new MemoryRateLimitStore(100, c.now);
    const spec = { capacity: 3, refillPerSecond: 1 };

    for (let i = 0; i < 3; i += 1) {
      expect((await store.take('k', spec)).ok, `request ${i + 1} of 3`).toBe(true);
    }
    const refused = await store.take('k', spec);
    expect(refused.ok).toBe(false);
    expect(refused.retryAfterMs).toBeGreaterThan(0);
  });

  it('refills at the stated rate rather than all at once', async () => {
    const c = clock();
    const store = new MemoryRateLimitStore(100, c.now);
    const spec = { capacity: 2, refillPerSecond: 1 };

    await store.take('k', spec);
    await store.take('k', spec);
    expect((await store.take('k', spec)).ok).toBe(false);

    c.advance(1_000); // exactly one token
    expect((await store.take('k', spec)).ok).toBe(true);
    expect((await store.take('k', spec)).ok).toBe(false);
  });

  it('keeps one subject from spending another subject’s allowance', async () => {
    // Dispatchers share an office address; one stuck tab must not throttle the
    // room. This is why the per-user key is the one that matters.
    const c = clock();
    const store = new MemoryRateLimitStore(100, c.now);
    const spec = { capacity: 1, refillPerSecond: 0.1 };

    expect((await store.take('write:alice', spec)).ok).toBe(true);
    expect((await store.take('write:alice', spec)).ok).toBe(false);
    expect((await store.take('write:bob', spec)).ok).toBe(true);
  });

  it('keeps each limit class separate for the same subject', async () => {
    const c = clock();
    const store = new MemoryRateLimitStore(100, c.now);
    const spec = { capacity: 1, refillPerSecond: 0.1 };
    expect((await store.take('geocode:alice', spec)).ok).toBe(true);
    // Spending the geocode allowance must not close the board to them.
    expect((await store.take('read.heavy:alice', spec)).ok).toBe(true);
  });
});

describe('the key space is bounded', () => {
  /**
   * Pre-auth keys are client addresses, which an attacker chooses. An
   * unbounded Map is a memory leak with a remote control attached.
   */
  it('does not grow past its cap', async () => {
    const c = clock();
    const store = new MemoryRateLimitStore(50, c.now);
    const spec = { capacity: 5, refillPerSecond: 1 };
    for (let i = 0; i < 500; i += 1) await store.take(`addr-${i}`, spec);
    expect(store.size).toBeLessThanOrEqual(50);
  });

  it('evicts full buckets, which cannot hand anyone a fresh allowance', async () => {
    const c = clock();
    const store = new MemoryRateLimitStore(3, c.now);

    /**
     * Two different specs on purpose. The first draft gave every key the same
     * refill rate and then advanced the clock to fill the disposable buckets —
     * which refilled the throttled one too, so the test proved nothing. The
     * throttled key has to STAY throttled for the assertion to mean anything.
     */
    const sticky = { capacity: 1, refillPerSecond: 0.0001 }; // effectively never
    const disposable = { capacity: 2, refillPerSecond: 1_000 }; // instantly full

    await store.take('spent', sticky);
    expect((await store.take('spent', sticky)).ok).toBe(false);

    await store.take('full-a', disposable);
    await store.take('full-b', disposable);
    c.advance(50); // the disposable buckets are back at capacity; 'spent' is not
    await store.take('trigger-eviction', disposable);

    expect(store.size).toBeLessThanOrEqual(3);
    // The one carrying real state survived and is still refused.
    expect((await store.take('spent', sticky)).ok).toBe(false);
  });
});

describe('enforceRateLimit', () => {
  beforeEach(() => setRateLimitStore(new MemoryRateLimitStore()));

  it('throws a 429 carrying a Retry-After a client can act on', async () => {
    const c = clock();
    setRateLimitStore(new MemoryRateLimitStore(100, c.now));
    const spend = LIMITS.geocode.capacity;
    for (let i = 0; i < spend; i += 1) await enforceRateLimit('geocode', 'alice');

    const error = await enforceRateLimit('geocode', 'alice').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    const limit = error as RateLimitError;
    expect(limit.status).toBe(429);
    expect(limit.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    // The message says whose limit it is: "rate limited" next to a Samsara
    // integration sends the reader to the wrong system entirely.
    expect(limit.message).toMatch(/our own limit, not Samsara/);
  });
});

describe('the limits clear what the console actually does', () => {
  /**
   * A limit a real dispatcher can reach is a bug report, not a guard. The
   * console polls /api/fleet every 20s per open tab — 3/min for one, 9/min
   * with three tabs. These assertions are the headroom, stated so that
   * tightening a limit has to argue with the traffic it would break.
   */
  it('leaves room for three tabs polling the fleet for a full minute', async () => {
    const c = clock();
    setRateLimitStore(new MemoryRateLimitStore(100, c.now));
    // 9 polls a minute, for five minutes, all from one dispatcher.
    for (let minute = 0; minute < 5; minute += 1) {
      for (let poll = 0; poll < 9; poll += 1) {
        await expect(enforceRateLimit('read.heavy', 'alice')).resolves.toBeUndefined();
        c.advance(60_000 / 9);
      }
    }
  });

  it('still stops a runaway loop inside a second', async () => {
    const c = clock();
    setRateLimitStore(new MemoryRateLimitStore(100, c.now));
    let allowed = 0;
    // A `setInterval` that fires with no delay at all.
    for (let i = 0; i < 500; i += 1) {
      const ok = await enforceRateLimit('read.heavy', 'bob').then(
        () => true,
        () => false,
      );
      if (ok) allowed += 1;
    }
    expect(allowed).toBe(LIMITS['read.heavy'].capacity);
  });
});

describe('clientAddress', () => {
  const req = (headers: Record<string, string>) =>
    new Request('https://example.test/api/fleet', { headers });

  it('takes the first x-forwarded-for entry', () => {
    expect(clientAddress(req({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe('203.0.113.9');
  });

  it('falls back to x-real-ip, then to a constant', () => {
    expect(clientAddress(req({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
    expect(clientAddress(req({}))).toBe('unknown');
  });
});

/**
 * The failure that matters is not a wrong limit — it is route number fifteen.
 *
 * Wiring this in touched eleven files, and the next route added will be
 * written by copying one of them. If the copy source is right the new route is
 * right, and if nothing checks, the one that gets copied from will eventually
 * be the one that was missed. So the coverage is asserted rather than
 * remembered. Same reasoning as the Sentry `dataCollection` scan.
 */
describe('every route handler is rate limited', () => {
  const API = join(import.meta.dirname, '..', 'app', 'api');

  function routeFiles(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) routeFiles(full, found);
      else if (entry === 'route.ts') found.push(full);
    }
    return found;
  }

  const files = routeFiles(API).map((f) => ({ path: f, body: readFileSync(f, 'utf8') }));

  it('finds the API routes, so the scan cannot pass by finding nothing', () => {
    // A directory rename would otherwise turn every assertion below green.
    expect(files.length).toBeGreaterThanOrEqual(11);
  });

  it('spends an address token in every exported handler', () => {
    const offenders = files
      .map(({ path, body }) => {
        const handlers = body.match(/^export async function (GET|POST|PATCH|PUT|DELETE)/gm) ?? [];
        const guards = body.match(/enforceRateLimit\('address'/g) ?? [];
        return handlers.length === guards.length
          ? null
          : `${path.split('/api/')[1]}: ${handlers.length} handler(s), ${guards.length} address guard(s)`;
      })
      .filter((x): x is string => x !== null);

    expect(
      offenders,
      'Each exported handler must spend an address token before requireUser(), ' +
        'which costs a Supabase round trip whether or not the caller is signed in.',
    ).toEqual([]);
  });

  it('applies a per-user limit wherever it authenticates', () => {
    const offenders = files
      .filter(({ body }) => /require(User|Role)\(/.test(body))
      .filter(({ body }) => !/enforceRateLimit\('(read|read\.heavy|write|geocode)'/.test(body))
      .map(({ path }) => path.split('/api/')[1]!);

    expect(
      offenders,
      'Per-user is the limit that binds: dispatchers share an office address, ' +
        'so one stuck tab must not throttle the room.',
    ).toEqual([]);
  });

  it('answers 429 rather than 500 in every failure path', () => {
    const offenders = files
      .filter(({ body }) => !body.includes('rateLimitResponse'))
      .map(({ path }) => path.split('/api/')[1]!);

    expect(
      offenders,
      'A route that enforces a limit but does not map RateLimitError reports ' +
        'its own throttling as an unexplained 500.',
    ).toEqual([]);
  });
});
