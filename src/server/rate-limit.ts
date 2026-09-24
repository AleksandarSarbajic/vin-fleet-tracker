import { TokenBucket } from '@/samsara/rate-limit';

/**
 * Inbound rate limiting (phase 6, item 3).
 *
 * `samsara/client.ts` limits the calls we make TO Samsara. Nothing limited the
 * calls made to US. Every mutating route is behind auth, so the blast radius is
 * a signed-in dispatcher rather than the internet — but `/api/stops` geocodes
 * through an external service on every save and `/api/fleet` runs the full
 * lateral join, and neither should be reachable in a tight loop by a buggy
 * client or a stuck retry.
 *
 * **The algorithm is a token bucket, and that is not an accident.** The
 * standing rule about rates (§12.60) is that `total / elapsed` is nonsense
 * early in any window — twelve calls at 00:05 on the 1st is 0.003 days, which
 * extrapolates to millions — and that a `> 0` check does not save it. A token
 * bucket never divides by time-since-start. It holds a level, refills it at a
 * fixed rate, and is therefore immune to that shape by construction rather
 * than by remembering to floor a denominator. It is also the same
 * `TokenBucket` the outbound limiter uses, so there is one implementation of
 * this algorithm in the codebase and not two.
 */

export interface RateLimitSpec {
  /** Maximum burst before refusal. */
  capacity: number;
  /** Sustained requests per second once the burst is spent. */
  refillPerSecond: number;
}

export interface RateLimitVerdict {
  ok: boolean;
  /** Milliseconds until one more request would be allowed. 0 when ok. */
  retryAfterMs: number;
  /** Whole tokens left, for the response headers. */
  remaining: number;
}

/**
 * Where the counters live.
 *
 * An interface because WHERE the app is deployed is not settled. On one
 * long-lived Node server the in-memory store below is genuinely correct —
 * shared state, no cold starts, no extra dependency. On a serverless host it
 * is close to useless: each instance gets its own buckets and they reset
 * constantly, and the real implementation is a shared counter in Postgres over
 * the connection we already have.
 *
 * Route handlers do not know which. That is the point of the seam: swapping
 * the store must not touch a single route.
 */
export interface RateLimitStore {
  take(key: string, spec: RateLimitSpec): Promise<RateLimitVerdict>;
}

/**
 * In-process token buckets.
 *
 * Correct for a single long-lived server, and honest about being wrong for
 * anything else — see the interface above.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<
    string,
    { bucket: TokenBucket; spec: RateLimitSpec; seen: number }
  >();

  constructor(
    /**
     * A cap, because the key space is not bounded.
     *
     * Per-user keys are a handful of dispatchers. Pre-auth keys are per client
     * address and an attacker picks those, so an unbounded Map is a memory
     * leak with a remote control attached. Eviction prefers FULL buckets,
     * which is safe in a way that evicting an arbitrary entry is not: a bucket
     * back at capacity holds no rate-limiting information, so dropping it
     * cannot hand anybody a fresh allowance they had not already earned.
     */
    private readonly maxKeys = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  async take(key: string, spec: RateLimitSpec): Promise<RateLimitVerdict> {
    let entry = this.buckets.get(key);
    if (!entry) {
      if (this.buckets.size >= this.maxKeys) this.evict();
      entry = {
        bucket: new TokenBucket({ ...spec, now: this.now }),
        // Kept beside the bucket rather than read back out of it: `capacity`
        // is private to TokenBucket, and reaching through a cast to find it
        // would make eviction depend on that class's internals.
        spec,
        seen: this.now(),
      };
      this.buckets.set(key, entry);
    }
    entry.seen = this.now();

    const ok = entry.bucket.tryTake();
    return {
      ok,
      retryAfterMs: ok ? 0 : entry.bucket.msUntilToken(),
      remaining: Math.floor(entry.bucket.available),
    };
  }

  private evict(): void {
    // Full buckets first: they carry no state anyone can be deprived of.
    for (const [key, entry] of this.buckets) {
      if (entry.bucket.available >= entry.spec.capacity) this.buckets.delete(key);
    }
    if (this.buckets.size < this.maxKeys) return;

    // Still over: drop the least recently seen. These are throttled keys, so
    // this does hand back an allowance — which is the right way to fail when
    // the alternative is unbounded growth.
    const oldest = [...this.buckets.entries()]
      .sort((a, b) => a[1].seen - b[1].seen)
      .slice(0, Math.ceil(this.maxKeys / 10));
    for (const [key] of oldest) this.buckets.delete(key);
  }

  /** Test seam. */
  get size(): number {
    return this.buckets.size;
  }
}

/**
 * What each kind of route costs.
 *
 * Sized against what the console ACTUALLY does, with an order of magnitude of
 * headroom, because a limit a real dispatcher can reach is a bug report rather
 * than a guard. The console polls `/api/fleet` every 20 seconds per open tab —
 * about 3/min for one dispatcher, 9/min with three tabs open — so `read.heavy`
 * at 60/min sustained clears normal use by roughly seven times while still
 * stopping a runaway `setInterval`.
 */
export const LIMITS = {
  /** Lists and aggregates that are cheap to serve. */
  read: { capacity: 60, refillPerSecond: 2 },

  /** `/api/fleet`'s lateral join, and the per-truck history queries. */
  'read.heavy': { capacity: 40, refillPerSecond: 1 },

  /** Anything that writes. Human-paced by nature; this catches stuck retries. */
  write: { capacity: 20, refillPerSecond: 0.5 },

  /**
   * `/api/stops`, which geocodes through an external service on every save.
   * There is deliberately no cache layer (§ the never-build list), so each
   * call is a real request to somebody else and the tightest limit belongs
   * here.
   */
  geocode: { capacity: 15, refillPerSecond: 0.25 },

  /**
   * Per client address, checked BEFORE authentication and therefore spent by
   * every request, signed in or not.
   *
   * It exists because `requireUser()` revalidates the token with Supabase over
   * the network: an unauthenticated loop costs us a round trip per request
   * even though it never gets past the 401, so a limit that only applies after
   * auth does not cover the cheapest way to make us work.
   *
   * Deliberately loose. A whole dispatch office shares one address — five
   * dispatchers at nine fleet polls a minute is 45/min against 240/min
   * sustained — and the per-user limits are the ones meant to bind. This is a
   * backstop, not the mechanism.
   */
  address: { capacity: 120, refillPerSecond: 4 },
} as const satisfies Record<string, RateLimitSpec>;

export type LimitName = keyof typeof LIMITS;

/** Thrown by `enforceRateLimit`; every route's failure mapper answers 429. */
export class RateLimitError extends Error {
  readonly status = 429 as const;
  constructor(readonly retryAfterSeconds: number) {
    super(
      `Too many requests. Retry in ${retryAfterSeconds}s. This is our own ` +
        `limit, not Samsara's — the console is asking faster than anything a ` +
        `person does, which usually means a retry loop rather than a user.`,
    );
    this.name = 'RateLimitError';
  }
}

/**
 * The 429, shaped the same way from every route.
 *
 * `retry-after` is a real HTTP header that clients and proxies already know
 * how to obey, so a well-behaved caller backs off without anyone writing
 * bespoke handling. The seconds are repeated in the body because the console's
 * fetch layer reads JSON, not headers.
 */
export function rateLimitResponse(error: RateLimitError): Response {
  return Response.json(
    { error: error.message, retryAfterSeconds: error.retryAfterSeconds },
    {
      status: 429,
      headers: {
        'retry-after': String(error.retryAfterSeconds),
        'cache-control': 'no-store',
      },
    },
  );
}

/** The process-wide store. Swapped wholesale if the app leaves one server. */
let store: RateLimitStore = new MemoryRateLimitStore();

/** Replaces the backing store. For tests, and for a serverless deployment. */
export function setRateLimitStore(next: RateLimitStore): void {
  store = next;
}

/**
 * Takes a token or throws.
 *
 * `subject` is the signed-in user's id where there is one. Per-user rather
 * than per-address: dispatchers share an office IP, and one person's stuck tab
 * must not throttle the rest of the room.
 */
export async function enforceRateLimit(limit: LimitName, subject: string): Promise<void> {
  const verdict = await store.take(`${limit}:${subject}`, LIMITS[limit]);
  if (verdict.ok) return;
  throw new RateLimitError(Math.max(1, Math.ceil(verdict.retryAfterMs / 1000)));
}

/**
 * The client address, as far as it can be trusted.
 *
 * `x-forwarded-for` is client-controlled unless a proxy we own overwrites it,
 * so this is a best effort used ONLY for the pre-auth limit — never for
 * anything that grants access. The per-user limit is the one that matters and
 * it keys on an id the client cannot choose.
 */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || request.headers.get('x-real-ip') || 'unknown';
}
