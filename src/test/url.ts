/**
 * Where the tests' database lives (§12.32).
 *
 * A literal default rather than a required environment variable, because the
 * guard in vitest.setup.ts has to be able to say "this is not production"
 * without depending on anyone having set anything. Override with
 * TEST_DATABASE_URL to point at a different cluster.
 *
 * Loopback, a port nothing else uses, and a database name that could not be
 * mistaken for a real one.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  `postgres://postgres@127.0.0.1:${process.env.TEST_PGPORT ?? '55432'}/fleet_test`;

/** Hosts a test may talk to. Everything else is somebody's production system. */
export const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
