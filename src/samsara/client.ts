import { z } from 'zod';
import { backoffDelayMs, retryAfterMs, sleep } from './backoff';
import { CircuitBreaker } from './circuit-breaker';
import { DEFAULT_SAMSARA_CONFIG, type SamsaraConfig } from './config';
import { CircuitOpenError, SamsaraBadRequestError, SamsaraError } from './errors';
import { TokenBucket } from './rate-limit';
import {
  DriverRow,
  VehicleFeedRow,
  VehicleRow,
  VehicleStatsRow,
  envelope,
} from './schemas';

export interface Logger {
  info: (message: string, fields?: Record<string, unknown>) => void;
  warn: (message: string, fields?: Record<string, unknown>) => void;
  error: (message: string, fields?: Record<string, unknown>) => void;
}

export interface SamsaraClientOptions extends Partial<SamsaraConfig> {
  token: string;
  logger?: Logger;
  fetchImpl?: typeof fetch;
}

export interface Page<T> {
  rows: T[];
  endCursor: string;
  hasNextPage: boolean;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * The only thing in this codebase that talks to Samsara. Browsers never do —
 * one server-side poller writes to our DB and every client reads from there.
 * Ten open tabs must not mean ten times the Samsara traffic.
 */
export class SamsaraClient {
  private readonly config: SamsaraConfig;
  private readonly bucket: TokenBucket;
  private readonly breaker: CircuitBreaker;
  private readonly log: Logger;
  private readonly doFetch: typeof fetch;

  constructor(options: SamsaraClientOptions) {
    this.config = { ...DEFAULT_SAMSARA_CONFIG, ...options };
    this.log = options.logger ?? console;
    this.doFetch = options.fetchImpl ?? fetch;
    this.bucket = new TokenBucket({
      capacity: this.config.bucketCapacity,
      refillPerSecond: this.config.bucketRefillPerSecond,
    });
    this.breaker = new CircuitBreaker({
      failureThreshold: this.config.breakerThreshold,
      cooldownMs: this.config.breakerCooldownMs,
    });
  }

  get breakerState() {
    return this.breaker.state;
  }

  /** Waits for a token. Every wait is logged — a throttle must be visible. */
  private async waitForToken(endpoint: string): Promise<void> {
    let waited = 0;
    while (!this.bucket.tryTake()) {
      const ms = Math.max(this.bucket.msUntilToken(), 10);
      waited += ms;
      this.log.warn('samsara throttle: waiting for rate-limit token', {
        endpoint,
        waitMs: ms,
        totalWaitedMs: waited,
        tokensAvailable: Number(this.bucket.available.toFixed(2)),
      });
      await sleep(ms);
    }
  }

  private async request<T extends z.ZodTypeAny>(
    path: string,
    params: Record<string, string | undefined>,
    schema: T,
  ): Promise<z.infer<T>> {
    const url = new URL(path, this.config.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, value);
    }
    const endpoint = `${path}`;

    if (!this.breaker.canRequest()) {
      this.log.error('samsara circuit open: skipping call', {
        endpoint,
        consecutiveFailures: this.breaker.consecutiveFailures,
        cooldownMs: this.config.breakerCooldownMs,
      });
      throw new CircuitOpenError(endpoint);
    }

    let lastError: SamsaraError | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      await this.waitForToken(endpoint);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

      try {
        const response = await this.doFetch(url, {
          headers: {
            Authorization: `Bearer ${this.config.token}`,
            Accept: 'application/json',
          },
          signal: controller.signal,
        });

        if (response.ok) {
          const json: unknown = await response.json();
          const parsed = schema.safeParse(json);
          if (!parsed.success) {
            this.breaker.recordFailure();
            throw new SamsaraError(
              `Response from ${endpoint} did not match the verified shape ` +
                `(see docs/samsara.md): ${parsed.error.issues
                  .map((i) => `${i.path.join('.')} ${i.message}`)
                  .join('; ')}`,
              response.status,
              endpoint,
            );
          }
          this.breaker.recordSuccess();
          return parsed.data;
        }

        const body = (await response.text()).slice(0, 400);

        if (response.status === 400) {
          this.breaker.recordFailure();
          throw new SamsaraBadRequestError(endpoint, body);
        }

        if (!RETRYABLE.has(response.status)) {
          this.breaker.recordFailure();
          throw new SamsaraError(
            `${response.status} from ${endpoint}: ${body}`,
            response.status,
            endpoint,
          );
        }

        lastError = new SamsaraError(
          `${response.status} from ${endpoint}: ${body}`,
          response.status,
          endpoint,
        );

        const serverAsked = retryAfterMs(response.headers.get('retry-after'));
        const delay =
          serverAsked ??
          backoffDelayMs(attempt, {
            baseMs: this.config.backoffBaseMs,
            maxMs: this.config.backoffMaxMs,
          });

        this.log.warn('samsara throttle: retrying after error', {
          endpoint,
          status: response.status,
          attempt: attempt + 1,
          maxRetries: this.config.maxRetries,
          delayMs: delay,
          honouredRetryAfter: serverAsked !== null,
        });

        if (attempt < this.config.maxRetries) await sleep(delay);
      } catch (error: unknown) {
        if (error instanceof SamsaraError) throw error;

        // Network failure or timeout. Retryable, same as a 5xx.
        lastError = new SamsaraError(
          `Request to ${endpoint} failed: ${error instanceof Error ? error.message : String(error)}`,
          null,
          endpoint,
          { cause: error },
        );

        const delay = backoffDelayMs(attempt, {
          baseMs: this.config.backoffBaseMs,
          maxMs: this.config.backoffMaxMs,
        });
        this.log.warn('samsara throttle: retrying after network failure', {
          endpoint,
          attempt: attempt + 1,
          delayMs: delay,
          reason: lastError.message,
        });
        if (attempt < this.config.maxRetries) await sleep(delay);
      } finally {
        clearTimeout(timer);
      }
    }

    this.breaker.recordFailure();
    throw (
      lastError ?? new SamsaraError(`Exhausted retries for ${endpoint}`, null, endpoint)
    );
  }

  /**
   * The 30s poll. `gps` on this endpoint is an ARRAY of readings since the
   * cursor — not the object /fleet/vehicles/stats returns. See
   * docs/samsara.md §4.
   */
  async vehicleStatsFeed(after?: string): Promise<Page<VehicleFeedRow>> {
    const result = await this.request(
      '/fleet/vehicles/stats/feed',
      { types: 'gps', after },
      envelope(VehicleFeedRow),
    );
    return {
      rows: result.data,
      endCursor: result.pagination.endCursor,
      hasNextPage: result.pagination.hasNextPage,
    };
  }

  /** Seeding only. `gps` here is a single OBJECT. */
  async vehicleStatsSnapshot(after?: string): Promise<Page<VehicleStatsRow>> {
    const result = await this.request(
      '/fleet/vehicles/stats',
      { types: 'gps', after },
      envelope(VehicleStatsRow),
    );
    return {
      rows: result.data,
      endCursor: result.pagination.endCursor,
      hasNextPage: result.pagination.hasNextPage,
    };
  }

  async vehicles(after?: string): Promise<Page<VehicleRow>> {
    const result = await this.request('/fleet/vehicles', { after }, envelope(VehicleRow));
    return {
      rows: result.data,
      endCursor: result.pagination.endCursor,
      hasNextPage: result.pagination.hasNextPage,
    };
  }

  async drivers(after?: string): Promise<Page<DriverRow>> {
    const result = await this.request('/fleet/drivers', { after }, envelope(DriverRow));
    return {
      rows: result.data,
      endCursor: result.pagination.endCursor,
      hasNextPage: result.pagination.hasNextPage,
    };
  }

  /** Drains every page, honouring hasNextPage. */
  async drainAll<T>(fetchPage: (after?: string) => Promise<Page<T>>): Promise<T[]> {
    const all: T[] = [];
    let cursor: string | undefined;
    // Samsara has ~34 vehicles here; the cap is a runaway guard, not a limit.
    for (let page = 0; page < 100; page += 1) {
      const result: Page<T> = await fetchPage(cursor);
      all.push(...result.rows);
      if (!result.hasNextPage || !result.endCursor) return all;
      cursor = result.endCursor;
    }
    this.log.error('samsara pagination did not terminate after 100 pages');
    return all;
  }
}
