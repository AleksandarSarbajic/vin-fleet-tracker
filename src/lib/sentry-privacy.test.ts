import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SENTRY_DATA_COLLECTION } from './sentry-privacy';

/**
 * Sentry v11 removed `sendDefaultPii` and replaced it with `dataCollection`,
 * INVERTING the default: unset, it now collects cookies, HTTP bodies, bound
 * database query parameters and stack-frame locals. The upgrade would have
 * started shipping the dispatcher's session cookie and every stop address to a
 * third party, and nothing would have failed.
 *
 * So the values are asserted, and — more importantly — so is the thing that
 * actually goes wrong next time: a fifth `Sentry.init` that does not apply the
 * policy at all. A correct default here is worth nothing if the next runtime
 * added forgets to ask for it.
 */

describe('what Sentry is allowed to collect', () => {
  it('refuses the categories that carry credentials or dispatch data', () => {
    // The session cookie is an auth credential; the rule about those does not
    // stop applying because the recipient is an error tracker.
    expect(SENTRY_DATA_COLLECTION.cookies).toBe(false);
    expect(SENTRY_DATA_COLLECTION.httpHeaders).toBe(false);
    // Stop edits, bulk overrides, assignment saves. [] is "collect none".
    expect(SENTRY_DATA_COLLECTION.httpBodies).toEqual([]);
    // Bound parameters are the same addresses and names by another route.
    expect(SENTRY_DATA_COLLECTION.databaseQueryData).toBe(false);
    // Locals are parsed request bodies and position rows.
    expect(SENTRY_DATA_COLLECTION.stackFrameVariables).toBe(false);
    expect(SENTRY_DATA_COLLECTION.userInfo).toBe(false);
  });

  it('keeps url query parameters, which are ids and are worth having', () => {
    // Stated as a decision rather than left to the default, so that flipping
    // it is a deliberate act with a failing test attached.
    expect(SENTRY_DATA_COLLECTION.urlQueryParams).toBe(true);
  });
});

/** Every file in the repo, minus the places nothing of ours lives. */
function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.next', '.git', '.testdb', 'drizzle'].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.(ts|tsx|mts)$/.test(entry) && !entry.endsWith('.test.ts')) found.push(full);
  }
  return found;
}

describe('every runtime that starts Sentry applies the policy', () => {
  it('has no Sentry.init anywhere without dataCollection', () => {
    const root = join(import.meta.dirname, '..', '..');
    const offenders = sourceFiles(root).filter((file) => {
      const body = readFileSync(file, 'utf8');
      return body.includes('Sentry.init(') && !body.includes('dataCollection');
    });

    expect(
      offenders,
      'These call Sentry.init without applying SENTRY_DATA_COLLECTION. Under ' +
        'v11 an unset dataCollection collects cookies, request bodies and ' +
        'bound query parameters by default, so an omission here is a leak ' +
        'rather than a gap. Import the shared policy from @/lib/sentry-privacy.',
    ).toEqual([]);
  });

  it('finds the four runtimes it expects, so the scan cannot pass by finding nothing', () => {
    const root = join(import.meta.dirname, '..', '..');
    const initSites = sourceFiles(root)
      .filter((f) => readFileSync(f, 'utf8').includes('Sentry.init('))
      .map((f) => f.slice(root.length + 1))
      .sort();

    // A guard on the guard: the previous test passes trivially if the walker
    // stops finding files, which is exactly what a directory rename would do.
    expect(initSites).toEqual([
      'sentry.edge.config.ts',
      'sentry.server.config.ts',
      'src/instrumentation-client.ts',
      'src/worker/sentry.ts',
    ]);
  });
});
