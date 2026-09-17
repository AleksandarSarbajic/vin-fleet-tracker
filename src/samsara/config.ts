/** Every Samsara tuning number lives here. No magic numbers in the client. */
export interface SamsaraConfig {
  baseUrl: string;
  token: string;
  /** Token bucket — self-imposed; the API sends no budget headers. */
  bucketCapacity: number;
  bucketRefillPerSecond: number;
  /** Retries on 429 and 5xx. 0 disables retrying. */
  maxRetries: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  /** Consecutive failures before the breaker opens. */
  breakerThreshold: number;
  breakerCooldownMs: number;
  requestTimeoutMs: number;
}

export const DEFAULT_SAMSARA_CONFIG: Omit<SamsaraConfig, 'token'> = {
  baseUrl: 'https://api.samsara.com',
  bucketCapacity: 10,
  bucketRefillPerSecond: 2,
  maxRetries: 4,
  backoffBaseMs: 500,
  backoffMaxMs: 30_000,
  breakerThreshold: 5,
  breakerCooldownMs: 60_000,
  requestTimeoutMs: 20_000,
};
