import { describe, expect, it } from 'vitest';
import { HttpError, httpErrorFrom } from './http-error';

/**
 * Inbound rate limiting made the client's retry policy matter.
 *
 * `retry: 1` answered our own 429 by immediately spending another token —
 * the one response guaranteed to make being throttled worse. Telling those
 * apart needs the status, which a bare `Error` did not carry.
 */

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('which failures are worth asking about again', () => {
  it('does not retry 429 — the whole point', () => {
    expect(new HttpError(429, 'slow down').retryable).toBe(false);
  });

  it('does not retry 401 or 403, which are decisions rather than accidents', () => {
    expect(new HttpError(401, 'not signed in').retryable).toBe(false);
    expect(new HttpError(403, 'requires dispatcher').retryable).toBe(false);
  });

  it('does retry the failures a second attempt could genuinely fix', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(new HttpError(status, 'server').retryable, `status ${status}`).toBe(true);
    }
  });
});

describe('reading what the server said', () => {
  it('keeps the reference code, which is how a 500 is traced', async () => {
    const error = await httpErrorFrom(
      json(500, { error: 'Could not load the fleet.', reference: 'FLEET-500-ABC' }),
    );
    expect(error.message).toBe('Could not load the fleet. (FLEET-500-ABC)');
    expect(error.status).toBe(500);
  });

  it('takes retry-after from the header', async () => {
    const error = await httpErrorFrom(json(429, { error: 'Too many' }, { 'retry-after': '7' }));
    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(7);
  });

  it('takes it from the body when the header is absent', async () => {
    // The console's fetch layer reads JSON, not headers, which is why the
    // route sends the number both ways.
    const error = await httpErrorFrom(json(429, { error: 'Too many', retryAfterSeconds: 3 }));
    expect(error.retryAfterSeconds).toBe(3);
  });

  it('survives a body that is not JSON at all', async () => {
    const error = await httpErrorFrom(new Response('<html>502</html>', { status: 502 }));
    expect(error.status).toBe(502);
    expect(error.message).toBe('Request failed: 502');
    expect(error.retryAfterSeconds).toBeUndefined();
  });
});
