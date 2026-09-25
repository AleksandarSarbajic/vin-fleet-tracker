import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

/**
 * The browser suite (phase 6, item 5).
 *
 * Scope is deliberately narrow. Components render in Vitest since §12.37, so
 * modals, focus traps, chip toggles and pickers run there in milliseconds and
 * do NOT belong here. What is left is the set of things a browser is the only
 * way to observe: server rendering and hydration, the middleware redirect, a
 * real Supabase session, WebGL, and a write that crosses the route handler and
 * comes back through revalidation.
 *
 * It runs against a PRODUCTION build, not `next dev`. This is a deploy gate,
 * and the two differ in exactly the places that have bitten this project —
 * §12.29's `useSearchParams` bug discarded a server-side prefetch, which is a
 * production-render concern that dev mode is more forgiving about.
 */
loadEnv({ path: '.env.local' });

const PORT = Number(process.env.E2E_PORT ?? 3100);
/** The e2e build's own directory — never `.next`, which `next dev` owns. */
export const E2E_DIST_DIR = '.next-e2e';
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  `postgres://postgres@127.0.0.1:${process.env.TEST_PGPORT ?? '55432'}/fleet_test`;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  /**
   * One worker, no parallelism. Every spec truncates and re-seeds one shared
   * database, so parallel files would be rewriting each other's fixtures and
   * the failures would look like flakes rather than like the collision they
   * are.
   */
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    /*
     * The viewport is set per-project, below: a device preset overrides
     * anything declared here, so putting it in this block does nothing.
     */
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        /*
         * AFTER the device spread, not before, and not in the top-level `use`.
         *
         * `devices['Desktop Chrome']` carries its own `viewport: 1280x720`,
         * and a project's `use` beats the top-level one — so the 1920x1080 set
         * above was silently discarded and every spec ran at 720px high. It
         * looked configured and was not, which is the same shape of defect as
         * an assertion that cannot fail.
         */
        viewport: { width: 1920, height: 1080 },
        storageState: 'e2e/.auth/dispatcher.json',
      },
      dependencies: ['setup'],
      // auth.spec.ts asserts the redirect and the login itself, so it must
      // start signed OUT. It sets its own storageState.
      testIgnore: /auth\.setup\.ts/,
    },
  ],

  webServer: {
    /**
     * Built and started fresh. `reuseExistingServer` is off even locally: a
     * stale server from a previous edit passing this suite is the exact
     * failure mode a deploy gate must not have.
     */
    command: `npm run build && npx next start -p ${PORT}`,
    /*
     * The build goes to its own directory (see `env` below). Sharing `.next`
     * with a running `next dev` broke that dev server on every run (§12.72).
     */
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      /** Read by next.config.ts for BOTH halves — the build and the start. */
      NEXT_DIST_DIR: E2E_DIST_DIR,
      /**
       * DATA is local and disposable; AUTH is the real hosted Supabase.
       *
       * `NEXT_PUBLIC_SUPABASE_URL` and the publishable key are inherited from
       * .env.local unchanged, so the login the browser performs is a real one
       * and the middleware redirect being tested is the real middleware. Only
       * the two Postgres connections are redirected — which is why the env
       * schema now permits a loopback cluster.
       */
      DATABASE_URL: TEST_DATABASE_URL,
      DIRECT_URL: TEST_DATABASE_URL,
      /** Off: the suite deliberately provokes 500s and 429s. */
      NEXT_PUBLIC_SENTRY_DSN: '',
      SENTRY_WORKER_DSN: '',
    },
  },
});
