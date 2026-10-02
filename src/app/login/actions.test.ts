import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * §12.96. Sign-out ends this device's session only. Supabase's default scope
 * is global, which signed a dispatcher's desktop out when they signed out on
 * their phone. The e2e spec proves it against the real auth server; this
 * holds the call itself.
 */

const signOut = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { signOut } }),
}));
const redirect = vi.fn();
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }));

const { signOut: signOutAction } = await import('./actions');

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('signOut', () => {
  it('ends the local session only, then goes to the login page', async () => {
    signOut.mockResolvedValue({ error: null });
    await signOutAction();
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(redirect).toHaveBeenCalledWith('/login');
  });

  it('reports a refusal instead of swallowing it, and still leaves', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    signOut.mockResolvedValue({ error: { message: 'session not found', status: 404 } });
    await signOutAction();
    expect(logged).toHaveBeenCalledWith('sign-out failed', {
      message: 'session not found',
      status: 404,
    });
    expect(redirect).toHaveBeenCalledWith('/login');
  });
});
