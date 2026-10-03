import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { describeDb } from '@/test/db';

/**
 * §12.107 — `/api/stops/reopen`, the real handler with the real rate limiter
 * and the test database. Only the session is replaced; `requireRole` keeps
 * the real rank check. Nothing here writes a row.
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
const { GET, POST } = await import('./route');

let address = 0;
const headers = () => ({ 'content-type': 'application/json', 'x-forwarded-for': `10.2.0.${address}` });
const post = (body: unknown) =>
  POST(new Request('http://localhost/api/stops/reopen', { method: 'POST', headers: headers(), body: JSON.stringify(body) }));
const as = (role: 'viewer' | 'dispatcher', id: string) => ({
  id,
  email: null,
  fullName: role === 'viewer' ? 'Vera Viewer' : 'Dee Dispatcher',
  role,
});
const NOBODY = '00000000-0000-4000-8000-000000000000';
const request = { truckId: NOBODY, loadId: NOBODY, closeAuditId: NOBODY };

beforeEach(() => {
  address += 1;
});
afterEach(() => vi.mocked(requireUser).mockReset());

describeDb('/api/stops/reopen (§12.107)', () => {
  it('refuses a viewer (403)', async () => {
    vi.mocked(requireUser).mockResolvedValue(as('viewer', '00000000-0000-4000-8000-0000000000c1'));
    expect((await post(request)).status).toBe(403);
  });

  it('lets a viewer read the list, which is empty for a truck with nothing closed', async () => {
    vi.mocked(requireUser).mockResolvedValue(as('viewer', '00000000-0000-4000-8000-0000000000c2'));
    const response = await GET(new Request(`http://localhost/api/stops/reopen?truckId=${NOBODY}`, { headers: headers() }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ loads: [] });
  });

  it('refuses a request without a close to undo (400), and a load that is not there (409)', async () => {
    vi.mocked(requireUser).mockResolvedValue(as('dispatcher', '00000000-0000-4000-8000-0000000000c3'));
    expect((await post({ truckId: NOBODY, loadId: NOBODY })).status).toBe(400);
    const missing = await post(request);
    expect(missing.status).toBe(409);
    expect(((await missing.json()) as { error: string }).error).toBe('That load no longer exists. Nothing was changed.');
  });
});
