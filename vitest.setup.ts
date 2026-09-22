import { config as loadEnv } from 'dotenv';
import { afterEach, beforeEach } from 'vitest';
import { LOCAL_HOSTS, TEST_DATABASE_URL } from './src/test/url';

/**
 * GUARD 1 and GUARD 4 (§12.32). Runs before every test file.
 *
 * Four separate faults in one session came from tests reading the state of
 * the world rather than their own setup: a geocode cache serving a real row
 * instead of the mock, a fixture asserting against a stale cache row,
 * assignment fixtures claiming whichever driver happened to be free, and a
 * sweep counting rows the live worker was committing concurrently. Every one
 * was found by accident. The fifth was already written.
 *
 * The fix is not to repair those four. It is to make the production database
 * unreachable from a test process, by removing the credentials rather than by
 * asking tests not to use them. There is no string here to reach for.
 */

loadEnv({ path: '.env.local' });

// ---------------------------------------------------------------------------
// GUARD 1: production credentials do not exist in this process.
// ---------------------------------------------------------------------------

const productionUrl = process.env.DATABASE_URL;

/**
 * The one case where pointing the suite at production is possible: someone
 * sets TEST_DATABASE_URL to it. Compared by host and database name, not by
 * string equality, because the two Supabase URLs differ only in port and
 * would otherwise slip past.
 */
function identity(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return url;
  }
}

/**
 * The same refusal as vitest.globalSetup.ts, kept as a second line rather
 * than the first one.
 *
 * This check USED to live only here, and that cost a production database:
 * globalSetup runs before the test workers, so the truncate had already
 * happened by the time this threw. It reads like a guard and it is not one —
 * by this point the tables are already empty. The guard that matters is in
 * globalSetup. This one only catches a worker somehow started against
 * different values.
 */
if (productionUrl && identity(productionUrl) === identity(TEST_DATABASE_URL)) {
  throw new Error(
    `TEST_DATABASE_URL points at the same database as DATABASE_URL ` +
      `(${identity(TEST_DATABASE_URL)}). Refusing to run. NOTE: globalSetup ` +
      `runs before this file, so check whether it already truncated.`,
  );
}

process.env.DATABASE_URL = TEST_DATABASE_URL;

// Everything else a test could reach production with. Deleted, not blanked:
// an empty string is a value that a `??` will happily keep.
for (const key of [
  'DIRECT_URL',
  'SUPABASE_SECRET_KEY',
  'WORKER_SUPABASE_SECRET_KEY',
  'SAMSARA_API_TOKEN',
  'SAMSARA_ORG_ID',
  // Kept after the HERE swap (§12.59): a token for a provider nothing calls
  // is still a live credential if it is sitting in someone's .env.local.
  'MAPBOX_DIRECTIONS_TOKEN',
  'HERE_API_KEY',
  'NEXT_PUBLIC_MAPBOX_TOKEN',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
]) {
  delete process.env[key];
}

// ---------------------------------------------------------------------------
// GUARD 4: the network is not the state of the world either.
//
// The geocode fault was a live HTTP call reached through a cache row. An empty
// database removes the row; this removes the call. A test that installs its
// own fetch mock overrides this deliberately, which is the point — what is
// caught is the test that forgot.
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;

function guardedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const raw = input instanceof Request ? input.url : String(input);
  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    host = '';
  }
  if (LOCAL_HOSTS.has(host)) return realFetch(input, init);
  return Promise.reject(
    new Error(
      `A test made a real network call to ${host || raw}. Tests do not talk to ` +
        `anyone's live service — mock fetch, or point it at a local server. ` +
        `(vitest.setup.ts, guard 4)`,
    ),
  );
}

beforeEach(() => {
  globalThis.fetch = guardedFetch as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------------------
// The act() environment flag.
// ---------------------------------------------------------------------------

/**
 * React only honours `act()` when this is set, and without it every single
 * render logged "The current testing environment is not configured to support
 * act(...)" — around 150 lines per run.
 *
 * That is not cosmetic. `act` warnings are how React reports a state update
 * that escaped a test's control, which is exactly the class of render-phase
 * bug the component tests exist to catch (§12.29). Buried in 150 identical
 * lines, a real one is invisible. A warning nobody can see is not a warning.
 *
 * Harmless in the node-environment files: nothing there renders.
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
