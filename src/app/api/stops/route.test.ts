import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { describeDb } from '@/test/db';

/**
 * §12.119 — what `POST /api/stops` answers when the save needs the
 * reached-stop answer. The save itself is replaced, so nothing is written;
 * the session is replaced, and the real rate limiter runs against the test
 * database. The save's own suite proves when it throws; this proves what the
 * modal is told.
 */

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => {
  class AuthError extends Error {
    constructor(
      message: string,
      readonly status: 401 | 403,
    ) {
      super(message);
      this.name = 'AuthError';
    }
  }
  return {
    AuthError,
    requireRole: vi.fn(async () => ({
      id: '00000000-0000-4000-8000-0000000000d1',
      email: null,
      fullName: 'Dee Dispatcher',
      role: 'dispatcher',
    })),
  };
});
vi.mock('@/server/stop-edit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/stop-edit')>();
  return { ...actual, saveLoadEdit: vi.fn() };
});

const { ReachedStopError, saveLoadEdit } = await import('@/server/stop-edit');
const { POST } = await import('./route');

const LOAD = '33333333-3333-4333-8333-333333333333';
const TRUCK = '11111111-1111-4111-8111-111111111111';
const STOP = '22222222-2222-4222-8222-222222222222';
const VERSION = '0123456789abcdef0123456789abcdef';

let address = 0;
const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/stops', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.3.0.${address}` },
      body: JSON.stringify(body),
    }),
  );

const edit = {
  loadId: LOAD,
  truckId: TRUCK,
  version: VERSION,
  loadStatus: 'DISPATCHED',
  stops: [
    {
      stopId: STOP,
      stopType: 'DEL',
      addressLine: null,
      city: 'Joliet',
      state: 'IL',
      zip: null,
      appointment: null,
    },
  ],
};

beforeEach(() => {
  address += 1;
});
afterEach(() => vi.mocked(saveLoadEdit).mockReset());

describeDb('POST /api/stops, a reached stop (§12.119)', () => {
  it('answers 409 with the arrival, the stop’s id and its place in the request', async () => {
    vi.mocked(saveLoadEdit).mockRejectedValue(
      new ReachedStopError('2026-09-18T11:44:00.000Z', STOP, 0),
    );
    const response = await post(edit);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'This stop has been reached. Say whether this is a correction or the next trip.',
      reachedStop: { arrivedAt: '2026-09-18T11:44:00.000Z', stopId: STOP, stopIndex: 0 },
    });
  });

  it('says null for a stop the request did not include', async () => {
    vi.mocked(saveLoadEdit).mockRejectedValue(
      new ReachedStopError('2026-09-18T11:44:00.000Z', STOP, null),
    );
    const body = (await (await post(edit)).json()) as { reachedStop: unknown };
    expect(body.reachedStop).toEqual({
      arrivedAt: '2026-09-18T11:44:00.000Z',
      stopId: STOP,
      stopIndex: null,
    });
  });
});
