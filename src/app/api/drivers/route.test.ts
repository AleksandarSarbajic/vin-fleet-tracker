import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { describeDb } from '@/test/db';

/**
 * §12.106 — `POST /api/drivers` with `action: 'phone'`, the real handler with
 * the real rate limiter and the test database. Only the session is replaced;
 * `requireRole` keeps the real rank check, so a viewer is refused by the same
 * rule production uses. Nothing here writes a row.
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
const { POST } = await import('./route');

let address = 0;
const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/drivers', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.1.0.${address}` },
      body: JSON.stringify(body),
    }),
  );
const as = (role: 'viewer' | 'dispatcher', id: string) => ({
  id,
  email: null,
  fullName: role === 'viewer' ? 'Vera Viewer' : 'Dee Dispatcher',
  role,
});
/** No such driver: every refusal below happens before a row would be read. */
const NOBODY = '00000000-0000-4000-8000-000000000000';

beforeEach(() => {
  address += 1;
});
afterEach(() => vi.mocked(requireUser).mockReset());

describeDb("POST /api/drivers — a driver's phone (§12.106)", () => {
  it('refuses a viewer (403), however good the number', async () => {
    vi.mocked(requireUser).mockResolvedValue(as('viewer', '00000000-0000-4000-8000-0000000000b1'));
    const response = await post({ action: 'phone', driverId: NOBODY, phone: '708-555-0123' });
    expect(response.status).toBe(403);
  });

  it('refuses a number it cannot dial (400) with the reason, not the number', async () => {
    vi.mocked(requireUser).mockResolvedValue(as('dispatcher', '00000000-0000-4000-8000-0000000000b2'));
    const response = await post({ action: 'phone', driverId: NOBODY, phone: '708-555-01234' });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; field: string };
    expect(body.field).toBe('phone');
    expect(body.error).toMatch(/Not a dialable US number/);
    expect(JSON.stringify(body)).not.toContain('5550123');
    expect(JSON.stringify(body)).not.toContain('555-01234');
  });

  it('takes a dispatcher through to the driver (400 when there is none)', async () => {
    vi.mocked(requireUser).mockResolvedValue(as('dispatcher', '00000000-0000-4000-8000-0000000000b3'));
    const response = await post({ action: 'phone', driverId: NOBODY, phone: '(708) 555 0123' });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe('That driver no longer exists.');
  });
});
