import { describe, expect, it, vi } from 'vitest';
import { SamsaraClient, type Logger } from './client';
import { CircuitOpenError, SamsaraBadRequestError } from './errors';

const silent: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const feedBody = (cursor: string, hasNextPage = false) => ({
  data: [
    {
      id: '212014918912099',
      name: 'Truck #147',
      gps: [
        {
          time: '2026-09-16T16:53:43.007Z',
          latitude: 41.548277,
          longitude: -87.980377,
          headingDegrees: 0,
          speedMilesPerHour: 0,
          reverseGeo: { formattedLocation: 'Maple Road, New Lenox, IL, 60451' },
          isEcuSpeed: false,
        },
      ],
    },
  ],
  pagination: { endCursor: cursor, hasNextPage },
});

const fast = {
  token: 't',
  logger: silent,
  backoffBaseMs: 1,
  backoffMaxMs: 2,
  bucketCapacity: 100,
  bucketRefillPerSecond: 1000,
};

describe('SamsaraClient', () => {
  it('sends the bearer token and parses a feed page', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => jsonResponse(feedBody('abc')));
    const client = new SamsaraClient({ ...fast, fetchImpl });

    const page = await client.vehicleStatsFeed();
    expect(page.rows).toHaveLength(1);
    expect(page.endCursor).toBe('abc');

    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe('/fleet/vehicles/stats/feed');
    expect(url.searchParams.get('types')).toBe('gps');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
  });

  it('passes the cursor as ?after', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => jsonResponse(feedBody('next')));
    await new SamsaraClient({ ...fast, fetchImpl }).vehicleStatsFeed('prev-cursor');
    const [url] = fetchImpl.mock.calls[0] as [URL];
    expect(url.searchParams.get('after')).toBe('prev-cursor');
  });

  it('retries a 429 and then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'slow down' }, 429))
      .mockResolvedValueOnce(jsonResponse(feedBody('abc')));

    const page = await new SamsaraClient({ ...fast, fetchImpl }).vehicleStatsFeed();
    expect(page.endCursor).toBe('abc');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('logs a throttle line for every retry', async () => {
    const warn = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse(feedBody('abc')));

    await new SamsaraClient({
      ...fast,
      logger: { ...silent, warn },
      fetchImpl,
    }).vehicleStatsFeed();

    expect(warn).toHaveBeenCalledWith(
      'samsara throttle: retrying after error',
      expect.objectContaining({ status: 503, attempt: 1 }),
    );
  });

  it('honours Retry-After over its own backoff', async () => {
    const warn = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429, { 'retry-after': '0' }))
      .mockResolvedValueOnce(jsonResponse(feedBody('abc')));

    await new SamsaraClient({
      ...fast,
      logger: { ...silent, warn },
      fetchImpl,
    }).vehicleStatsFeed();

    expect(warn).toHaveBeenCalledWith(
      'samsara throttle: retrying after error',
      expect.objectContaining({ honouredRetryAfter: true, delayMs: 0 }),
    );
  });

  it('does not retry a 401 — a bad token will not fix itself', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => jsonResponse({ message: 'nope' }, 401));
    await expect(
      new SamsaraClient({ ...fast, fetchImpl }).vehicleStatsFeed(),
    ).rejects.toThrow(/401/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('calls a 400 a parameter error, not a scope error', async () => {
    // /fleet/driver-vehicle-assignments 400s without filterBy. The message
    // exists so nobody goes asking for a broader token.
    // A factory, not mockResolvedValue: a Response body can only be read
    // once, so reusing one object makes the second call fail for the wrong
    // reason.
    const fetchImpl = vi.fn().mockImplementation(() => jsonResponse({}, 400));
    const client = new SamsaraClient({ ...fast, fetchImpl });
    await expect(client.vehicleStatsFeed()).rejects.toBeInstanceOf(
      SamsaraBadRequestError,
    );
    await expect(client.vehicleStatsFeed()).rejects.toThrow(/NOT a scope error/);
  });

  it('opens the breaker after repeated failures and then stops calling out', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => jsonResponse({}, 500));
    const client = new SamsaraClient({
      ...fast,
      fetchImpl,
      maxRetries: 0,
      breakerThreshold: 2,
      breakerCooldownMs: 60_000,
    });

    await expect(client.vehicleStatsFeed()).rejects.toThrow();
    await expect(client.vehicleStatsFeed()).rejects.toThrow();
    expect(client.breakerState).toBe('open');

    const callsBefore = fetchImpl.mock.calls.length;
    await expect(client.vehicleStatsFeed()).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fetchImpl.mock.calls.length).toBe(callsBefore); // no network call
  });

  it('rejects a response that does not match the verified shape', async () => {
    const fetchImpl = vi.fn().mockImplementation(() =>
      // gps as an object — the /stats shape arriving on the feed endpoint.
      jsonResponse({
        data: [
          { id: '1', name: 'Truck #1', gps: { time: 'x', latitude: 1, longitude: 2 } },
        ],
        pagination: { endCursor: 'a', hasNextPage: false },
      }),
    );
    await expect(
      new SamsaraClient({ ...fast, fetchImpl }).vehicleStatsFeed(),
    ).rejects.toThrow(/did not match the verified shape/);
  });

  it('retries network failures, not just HTTP errors', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(jsonResponse(feedBody('abc')));
    const page = await new SamsaraClient({ ...fast, fetchImpl }).vehicleStatsFeed();
    expect(page.endCursor).toBe('abc');
  });

  it('drains every page while hasNextPage is true', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(feedBody('p1', true)))
      .mockResolvedValueOnce(jsonResponse(feedBody('p2', true)))
      .mockResolvedValueOnce(jsonResponse(feedBody('p3', false)));
    const client = new SamsaraClient({ ...fast, fetchImpl });
    const rows = await client.drainAll((after) => client.vehicleStatsFeed(after));
    expect(rows).toHaveLength(3);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
