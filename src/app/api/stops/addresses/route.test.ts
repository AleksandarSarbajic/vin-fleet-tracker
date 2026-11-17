import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { describeDb } from '@/test/db';

/**
 * Phase 3bx, QoL 2 (§12.164). `GET /api/stops/addresses`, the real handler with the real rate
 * limiter and the test database. Only the session is replaced. What the list holds is
 * `server/stop-addresses.test.ts`'s (rolled back, so this route's own connection sees none).
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

const { AuthError, requireUser } = await import('@/lib/auth');
const { GET } = await import('./route');

let address = 0;
const get = () =>
  GET(new Request('http://localhost/api/stops/addresses', { headers: { 'x-forwarded-for': `10.3.0.${address}` } }));
const as = (role: 'viewer' | 'dispatcher' | 'admin') => ({
  id: `00000000-0000-4000-8000-0000000000${role === 'viewer' ? 'a1' : role === 'dispatcher' ? 'a2' : 'a3'}`,
  email: null,
  fullName: `A ${role}`,
  role,
});

beforeEach(() => {
  address += 1;
});
afterEach(() => vi.mocked(requireUser).mockReset());

describeDb('GET /api/stops/addresses (§12.164)', () => {
  it.each(['dispatcher', 'admin'] as const)('answers a %s with the list, never cached', async (role) => {
    vi.mocked(requireUser).mockResolvedValue(as(role));
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ addresses: [] });
  });

  it('refuses a viewer (403): the route asks, whatever the window does', async () => {
    vi.mocked(requireUser).mockResolvedValue(as('viewer'));
    const response = await get();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Requires dispatcher; A viewer is viewer' });
  });

  it('refuses nobody (401)', async () => {
    vi.mocked(requireUser).mockRejectedValue(new AuthError('Not signed in', 401));
    expect((await get()).status).toBe(401);
  });
});
