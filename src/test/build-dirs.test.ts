import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextConfig } from 'next';

/**
 * §12.72. The e2e suite builds with `next build` and serves with `next start`;
 * a developer's `next dev` writes into `.next`. When both used `.next`, every
 * e2e run left the running dev server serving 500s. Two halves hold the fix,
 * and a regression in either brings the bug back, so both are asserted.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** withSentryConfig may hand back the config or a function producing it. */
async function resolvedNextConfig(): Promise<NextConfig> {
  const mod = (await import('../../next.config')) as { default: unknown };
  const cfg = mod.default;
  return typeof cfg === 'function'
    ? await (cfg as (phase: string, ctx: { defaultConfig: NextConfig }) => Promise<NextConfig>)(
        'phase-production-build',
        { defaultConfig: {} },
      )
    : (cfg as NextConfig);
}

describe('the e2e build never shares a directory with next dev', () => {
  it('playwright builds and serves from its own directory, not .next', async () => {
    const { default: config, E2E_DIST_DIR } = await import('../../playwright.config');
    const server = Array.isArray(config.webServer) ? config.webServer[0] : config.webServer;
    expect(E2E_DIST_DIR).not.toBe('.next');
    expect(server?.env?.['NEXT_DIST_DIR']).toBe(E2E_DIST_DIR);
  });

  it('next.config builds where NEXT_DIST_DIR says', async () => {
    vi.stubEnv('NEXT_DIST_DIR', '.next-e2e');
    expect((await resolvedNextConfig()).distDir).toBe('.next-e2e');
  });

  it('and falls back to .next, which is what next dev uses', async () => {
    vi.stubEnv('NEXT_DIST_DIR', '');
    expect((await resolvedNextConfig()).distDir).toBe('.next');
  });
});
