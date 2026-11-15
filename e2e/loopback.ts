/**
 * Phase 3bw. The e2e suite truncates every table it can reach, so it refuses any database that
 * is not on this machine, and now it refuses before anything else runs: `playwright.config.ts`
 * calls this when the config loads, before Playwright starts the web servers (in 1.63 the
 * plugin setup, the servers among it, runs BEFORE global setup: 3bv's found wrong 2). Global
 * setup calls it again, for a runner that skips the config's own call. §12.32 is the record of
 * what a refusal that runs after the damage costs.
 *
 * Pure: the URL in, the host or a refusal out. No connection is made to find out.
 *
 * **IPv6 loopback is refused.** `new URL('http://[::1]:5432/x').hostname` is `[::1]`, with the
 * brackets, so the old list's `'::1'` never matched and a `[::1]` run was always refused. It
 * stays refused, on purpose: the disposable cluster listens on 127.0.0.1 only
 * (`scripts/test-db.sh`, `listen_addresses`), and the app's own loopback check
 * (`LOCAL_HOSTS` in `src/env/schema.ts`) has the same unbracketed `'::1'`, so a `[::1]` run
 * would fail at the app's env check anyway. Failing here says why, before a build.
 */

/** The hosts a WHATWG URL names a database on this machine by. */
export const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', 'localhost'];

/** The host a `postgres://` URL names, as the WHATWG URL parser reads it (brackets kept). */
export function databaseHost(url: string): string {
  return new URL(url.replace(/^postgres(ql)?:/, 'http:')).hostname;
}

/** Throws unless `url` names a loopback database. Returns the host when it does. */
export function refuseUnlessLoopback(url: string): string {
  let host: string;
  try {
    host = databaseHost(url);
  } catch {
    throw new Error('The e2e database URL could not be read as a URL. Refusing to run.');
  }
  if (!LOOPBACK_HOSTS.includes(host)) {
    throw new Error(
      `The e2e suite truncates every table it can reach and this database is ` +
        `not on this machine (${host}). Refusing to run.`,
    );
  }
  return host;
}
