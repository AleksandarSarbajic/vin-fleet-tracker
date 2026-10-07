import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { describeDb } from '@/test/db';

/**
 * §12.117 — `GET /api/loads/:id` and `POST /api/stops`, the real handlers with
 * the real rate limiter and the test database. Only the session is replaced;
 * `requireRole` keeps the real rank check. Nothing here writes a row.
 */

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', async () => {
  const { rankOf } = await import('@/lib/roles');
  class AuthError extends Error {
    constructor(
      message: string,
      readonly status: 401 | 403,
    ) {
      super(message);
      this.name = 'AuthError';
    }
  }
  const requireUser = vi.fn();
  const requireRole = async (minimum: Parameters<typeof rankOf>[0]) => {
    const user = (await requireUser()) as { role: Parameters<typeof rankOf>[0]; fullName: string };
    if (rankOf(user.role) < rankOf(minimum)) {
      throw new AuthError(`Requires ${minimum}; ${user.fullName} is ${user.role}`, 403);
    }
    return user;
  };
  return { AuthError, requireUser, requireRole };
});

const { requireUser } = await import('@/lib/auth');
const { GET } = await import('./route');
const { POST } = await import('../../stops/route');

let address = 0;
const headers = () => ({ 'content-type': 'application/json', 'x-forwarded-for': `10.3.0.${address}` });
const as = (role: 'viewer' | 'dispatcher' | 'admin', id: string) => ({
  id,
  email: null,
  fullName: `${role} user`,
  role,
});
const NOBODY = '00000000-0000-4000-8000-000000000000';
const read = (id: string) =>
  GET(new Request(`http://localhost/api/loads/${id}`, { headers: headers() }), {
    params: Promise.resolve({ id }),
  });
const save = (body: unknown) =>
  POST(new Request('http://localhost/api/stops', { method: 'POST', headers: headers(), body: JSON.stringify(body) }));
const oneStop = {
  loadId: NOBODY,
  truckId: NOBODY,
  loadStatus: 'DISPATCHED',
  stops: [
    { stopId: NOBODY, stopType: 'DEL', addressLine: null, city: null, state: null, zip: null, appointment: null },
  ],
};

beforeEach(() => {
  address += 1;
});
afterEach(() => vi.mocked(requireUser).mockReset());

describeDb('GET /api/loads/:id (§12.117)', () => {
  it('lets a viewer read, and says 404 for a load that is not there', async () => {
    vi.mocked(requireUser).mockResolvedValue(as('viewer', '00000000-0000-4000-8000-0000000000d1'));
    expect((await read(NOBODY)).status).toBe(404);
  });

  it('refuses an id that is not one (400)', async () => {
    vi.mocked(requireUser).mockResolvedValue(as('viewer', '00000000-0000-4000-8000-0000000000d2'));
    expect((await read('not-a-load')).status).toBe(400);
  });
});

describeDb('POST /api/stops takes a load (§12.117)', () => {
  it('refuses a viewer (403), as it always has', async () => {
    vi.mocked(requireUser).mockResolvedValue(as('viewer', '00000000-0000-4000-8000-0000000000d3'));
    expect((await save({ ...oneStop, version: '0'.repeat(32) })).status).toBe(403);
  });

  it('refuses an edit of an existing load that names no version (400, on the version)', async () => {
    vi.mocked(requireUser).mockResolvedValue(as('dispatcher', '00000000-0000-4000-8000-0000000000d4'));
    const response = await save(oneStop);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { fields: { field: string }[] };
    expect(body.fields.map((f) => f.field)).toEqual(['version']);
  });

  it('lets an admin through to the save, which then finds no such load', async () => {
    vi.mocked(requireUser).mockResolvedValue(as('admin', '00000000-0000-4000-8000-0000000000d5'));
    const response = await save({ ...oneStop, version: '0'.repeat(32) });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe(
      'That load no longer exists. Nothing was saved.',
    );
  });
});
