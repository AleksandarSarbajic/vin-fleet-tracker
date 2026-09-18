import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
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

    /**
     * ONE FILE AT A TIME. The database-backed suites share one database, and
     * `applyReassignment` deliberately takes a FLEET-WIDE lock —
     * `select 1 from assignments where ended_at is null for update` — so that
     * the one-driver-per-truck invariant cannot be raced.
     *
     * That lock is correct and worth keeping. What it means for tests is that
     * two suites touching assignments at the same time will block or deadlock,
     * which showed up as a reassignment test that failed only in a full run
     * and passed every single time it was run alone. Slicing the fixtures to
     * different trucks did not help, because the lock is not per row.
     *
     * The cost is wall time. The alternative is an intermittently red suite,
     * which is worse: it teaches people to re-run until green.
     */
    fileParallelism: false,
  },
});
