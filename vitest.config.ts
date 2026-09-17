import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Database-backed tests need the real connection strings.
    setupFiles: ['./vitest.setup.ts'],
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
