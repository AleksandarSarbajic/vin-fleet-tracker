import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  /**
   * The automatic JSX runtime (§12.37).
   *
   * tsconfig says `"jsx": "preserve"` because Next compiles the app, and
   * esbuild then defaulted to the CLASSIC runtime for tests — which needs
   * `React` in scope and throws "React is not defined" for any component that
   * contains JSX. So no component could be rendered in a test at all, and the
   * only .tsx test in the suite was a hook exercised through createElement.
   *
   * That is the structural reason a whole feature shipped with no UI and
   * every test passing: nothing could render a screen, so nothing did.
   */
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    // .tsx too: the console's render-phase bugs (§12.29) need a React
    // renderer to catch, and those tests are components.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Database-backed tests need the real connection strings.
    setupFiles: ['./vitest.setup.ts'],
    // GUARD 2 (§12.32): empties the local test cluster once per run, and
    // refuses to start if it is not there.
    globalSetup: ['./vitest.globalSetup.ts'],
    /**
     * 20s, not vitest's 5s default.
     *
     * The DB-backed suites talk to Supabase in eu-west-1 over the public
     * internet, and a single test is a transaction of a dozen round trips.
     * The same test measured 1.0s and then 3.3s on consecutive runs, and the
     * heaviest one — a two-sided reassignment plus a stop save — crossed 5s
     * and failed on latency alone. A timeout that fires on a slow network
     * teaches people to re-run the suite until it passes, which is how a real
     * failure gets ignored.
     */
    testTimeout: 20_000,
    hookTimeout: 20_000,

  },
});
