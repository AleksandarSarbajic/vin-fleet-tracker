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

/**
 * THE REFUSAL LIVES HERE, not in vitest.setup.ts.
 *
 * It was in setup.ts first, and that was wrong in the way that costs data:
 * vitest runs globalSetup BEFORE the test workers, so the truncate below had
 * already happened by the time the guard in the worker got to refuse. The
 * refusal printed after the damage and read exactly like a refusal that had
 * prevented it. It did not. It truncated the production database.
 *
 * Anything that decides whether to truncate has to run before the truncate,
 * in this process. Two conditions, both hard:
 *
 *   1. The host is loopback. Production is remote and the test cluster is
 *      local, so this alone is sufficient and does not depend on anyone
 *      configuring anything correctly.
 *   2. It is not the database DATABASE_URL names — kept as well, because it
 *      gives the better message in the case people will actually hit.
 */
function identity(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return url;
  }
}

export function refuseUnlessDisposable(
  url = TEST_DATABASE_URL,
  production: string | null | undefined = process.env.DATABASE_URL,
): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`TEST_DATABASE_URL is not a URL: ${url}`);
  }

  if (production && identity(production) === identity(url)) {
    throw new Error(
      `TEST_DATABASE_URL points at the same database as DATABASE_URL ` +
        `(${identity(url)}). Every table in public is about to ` +
        `be truncated. Refusing to run.`,
    );
  }

  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `TEST_DATABASE_URL is not on this machine (${host}). The test suite ` +
        `truncates every table in public before it runs, so it will only do ` +
        `that to a local, disposable cluster. Refusing to run.`,
    );
  }
}

/**
 * GUARD 2 (§12.32): the database starts empty, once per run.
 *
 * This is the guard that turns the recurring fault into a loud failure rather
 * than a silent wrong answer. Six fixtures open with
 * `select … from trucks limit 1` — against production that quietly picks
 * whichever truck happens to exist, so the test's subject is chosen by the
 * state of the fleet. Against an empty database the same line returns
 * undefined and the fixture throws on the spot.
 *
 * The consequence is deliberate: a fixture must create everything it reads.
 */
