/**
 * An HTTP failure that still knows what the server said (phase 6, item 3).
 *
 * The console's fetchers threw a bare `Error` carrying only a message, which
 * made every failure look alike to anything downstream. That was tolerable
 * until inbound rate limiting existed, and then it was not: TanStack Query is
 * configured to retry once, so a 429 was answered by immediately spending
 * another token. A limiter whose client reacts by asking again is not a
 * limiter — it deepens exactly the hole it is meant to stop digging.
 *
 * Carrying the status is what lets `retry` tell "the network blipped, try
 * again" apart from "you are going too fast" and "you are not allowed".
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** From the `retry-after` header, when the server sent one. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  /**
   * Would asking again plausibly produce a different answer?
   *
   * 429 is the case this exists for. 401 and 403 are included because they are
   * decisions, not accidents: a retry cannot change the caller's role, and
   * retrying a 401 during an expired session just doubles the requests the
   * login redirect is already handling.
   */
  get retryable(): boolean {
    return ![429, 401, 403].includes(this.status);
  }
}

/** Reads the server's error shape, whatever failed. */
export async function httpErrorFrom(response: Response): Promise<HttpError> {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
    reference?: string;
    retryAfterSeconds?: number;
  } | null;

  const message = body?.reference
    ? `${body.error ?? 'Request failed'} (${body.reference})`
    : (body?.error ?? `Request failed: ${response.status}`);

  const header = response.headers.get('retry-after');
  const retryAfter = body?.retryAfterSeconds ?? (header ? Number(header) : undefined);

  return new HttpError(
    response.status,
    message,
    Number.isFinite(retryAfter) ? retryAfter : undefined,
  );
}
