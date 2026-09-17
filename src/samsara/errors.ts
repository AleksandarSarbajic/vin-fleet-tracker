export class SamsaraError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly endpoint: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'SamsaraError';
  }
}

/** The breaker is open — we did not call out at all. */
export class CircuitOpenError extends SamsaraError {
  constructor(endpoint: string) {
    super(`Circuit open, not calling ${endpoint}`, null, endpoint);
    this.name = 'CircuitOpenError';
  }
}

/**
 * 400 on /fleet/driver-vehicle-assignments means a missing `filterBy`, not a
 * missing scope. Stated here so nobody goes asking for a broader token.
 */
export class SamsaraBadRequestError extends SamsaraError {
  constructor(endpoint: string, body: string) {
    super(
      `400 from ${endpoint} — a parameter error, NOT a scope error. ` +
        `Check required query params before touching the token. Body: ${body}`,
      400,
      endpoint,
    );
    this.name = 'SamsaraBadRequestError';
  }
}
