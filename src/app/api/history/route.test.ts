import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { describeDb } from '@/test/db';

/**
 * §12.101 — `GET /api/history`, the real handler with the real rate limiter
 * and the test database. Only `requireUser` is replaced, to stand in for a
 * signed-in viewer or for nobody.
 */

vi.mock('server-only', () => ({}));
// The real module reads the Supabase client's environment, which the test
// guards strip on purpose (vitest.setup.ts). The handler only needs these two.
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
  return { AuthError, requireUser: vi.fn() };
});

const { AuthError, requireUser } = await import('@/lib/auth');
const { GET } = await import('./route');

let address = 0;
/** A fresh address per test, so one test's requests cannot spend another's. */
const get = (query: string, ip: string) =>
  GET(new Request(`http://localhost/api/history${query}`, { headers: { 'x-forwarded-for': ip } }));

const viewer = (id: string) => ({ id, email: null, fullName: 'Vera Viewer', role: 'viewer' as const });

beforeEach(() => {
  address += 1;
});
afterEach(() => vi.mocked(requireUser).mockReset());

describeDb('GET /api/history (§12.101)', () => {
  it('answers a viewer with the week (200) — reading needs no dispatcher', async () => {
    vi.mocked(requireUser).mockResolvedValue(viewer('viewer-200'));
    const response = await get('?week=2026-W40', `10.0.0.${address}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { week: string; range: string };
    expect(body).toMatchObject({ week: '2026-W40', range: 'Sep 28 – Oct 4, 2026' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('refuses nobody (401)', async () => {
    vi.mocked(requireUser).mockRejectedValue(new AuthError('Not signed in', 401));
    const response = await get('?week=2026-W40', `10.0.0.${address}`);
    expect(response.status).toBe(401);
  });

  it('refuses a week that is not a week (400)', async () => {
    vi.mocked(requireUser).mockResolvedValue(viewer('viewer-400'));
    const response = await get('?week=2026-W99', `10.0.0.${address}`);
    expect(response.status).toBe(400);
  });

  it('stops answering past the read limit (429), with a Retry-After', async () => {
    vi.mocked(requireUser).mockResolvedValue(viewer('viewer-429'));
    const statuses: number[] = [];
    let last: Response | null = null;
    for (let i = 0; i < 45; i += 1) {
      last = await get('?week=2026-W40', `10.0.0.${address}`);
      statuses.push(last.status);
    }
    expect(statuses.slice(0, 40).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    expect(last!.headers.get('retry-after')).not.toBeNull();
  });
});
