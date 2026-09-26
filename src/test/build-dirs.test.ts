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
    ? await (
        cfg as (phase: string, ctx: { defaultConfig: NextConfig }) => Promise<NextConfig>
      )('phase-production-build', { defaultConfig: {} })
    : (cfg as NextConfig);
}

describe('the e2e build never shares a directory with next dev', () => {
  it('playwright builds and serves from its own directory, not .next', async () => {
    const { default: config, E2E_DIST_DIR } = await import('../../playwright.config');
    const server = Array.isArray(config.webServer)
      ? config.webServer[0]
      : config.webServer;
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

/**
 * §12.84. Each e2e run keeps its own results folder, so a flaky failure's
 * trace survives the next run instead of being emptied by it.
 */
describe('e2e results are kept per run', () => {
  it('writes this run to test-results/<run id>, and the id is shared with workers', async () => {
    const { default: config, E2E_RUN_ID } = await import('../../playwright.config');
    expect(config.outputDir).toBe(`test-results/${E2E_RUN_ID}`);
    expect(process.env['E2E_RUN_ID']).toBe(E2E_RUN_ID);
    expect(config.retries).toBe(0);
  });

  it('prunes to the newest N run folders and touches nothing else', async () => {
    const { mkdtempSync, mkdirSync, readdirSync, writeFileSync } =
      await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { newRunId, pruneRuns } = await import('../../e2e/results');
    const root = mkdtempSync(join(tmpdir(), 'e2e-results-'));
    const ids = [0, 1, 2, 3].map((d) =>
      newRunId(new Date(Date.UTC(2026, 8, 20 + d, 12))),
    );
    for (const id of ids) mkdirSync(join(root, id));
    mkdirSync(join(root, 'someone-elses-folder'));
    writeFileSync(join(root, '.last-run.json'), '{}');

    expect(pruneRuns(root, 2).sort()).toEqual([ids[0], ids[1]].sort());
    expect(readdirSync(root).sort()).toEqual(
      ['.last-run.json', ids[2], ids[3], 'someone-elses-folder'].sort(),
    );
  });
});
