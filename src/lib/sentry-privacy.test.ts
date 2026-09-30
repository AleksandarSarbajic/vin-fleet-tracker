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

/**
 * The code with comments stripped. A guard that matched on raw text passed a
 * config whose setting had been replaced by a comment MENTIONING it — found
 * by deleting the line on purpose (§12.87) and watching this stay green.
 */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('every runtime that starts Sentry applies the policy', () => {
  it('has no Sentry.init anywhere without dataCollection', () => {
    const root = join(import.meta.dirname, '..', '..');
    const offenders = sourceFiles(root).filter((file) => {
      const body = code(file);
      return (
        body.includes('Sentry.init(') && !/dataCollection:\s*SENTRY_DATA_COLLECTION\b/.test(body)
      );
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

/**
 * §12.87. Tracing is on for the app's two server runtimes, through ONE
 * sampler, and off everywhere else — decided per init site, in code, so a
 * fifth `Sentry.init` cannot quietly trace at the SDK's default or at a rate
 * someone typed.
 */
describe('every runtime that starts Sentry declares its tracing', () => {
  const root = join(import.meta.dirname, '..', '..');
  const sites = () =>
    sourceFiles(root)
      .filter((f) => code(f).includes('Sentry.init('))
      .map((f) => ({ file: f.slice(root.length + 1), body: code(f) }));

  const usesSampler = (body: string) => /tracesSampler:\s*sampleTraces\b/.test(body);
  const tracingOff = (body: string) => /tracesSampleRate:\s*0\s*[,}\n]/.test(body);

  it('samples the Node and edge runtimes with the shared sampler, and nothing else', () => {
    for (const file of ['sentry.server.config.ts', 'sentry.edge.config.ts']) {
      const site = sites().find((s) => s.file === file);
      expect(site, file).toBeDefined();
      expect(usesSampler(site!.body), `${file} uses sampleTraces`).toBe(true);
      // A rate next to a sampler is ignored by the SDK and misleads a reader.
      expect(site!.body, `${file} has no tracesSampleRate`).not.toMatch(/tracesSampleRate/);
    }
  });

  it('keeps the browser and the worker at rate 0', () => {
    for (const file of ['src/instrumentation-client.ts', 'src/worker/sentry.ts']) {
      const site = sites().find((s) => s.file === file);
      expect(site, file).toBeDefined();
      expect(tracingOff(site!.body), `${file} sets tracesSampleRate: 0`).toBe(true);
      expect(site!.body, `${file} has no tracesSampler`).not.toMatch(/tracesSampler/);
    }
  });

  it('lets no init site leave tracing to a default or to a hand-typed rate', () => {
    const undeclared = sites()
      .filter(({ body }) => !usesSampler(body) && !tracingOff(body))
      .map((s) => s.file);
    expect(
      undeclared,
      'Declare tracing explicitly: `tracesSampler: sampleTraces` (server runtimes) ' +
        'or `tracesSampleRate: 0`. See src/lib/sentry-sampling.ts.',
    ).toEqual([]);

    /** Every value assigned to `key` in the code, trimmed. */
    const valuesOf = (key: string, body: string) =>
      [...body.matchAll(new RegExp(`${key}:\\s*([^,}\\n]+)`, 'g'))].map((m) => m[1]!.trim());

    const otherRates = sourceFiles(root)
      .filter((f) => valuesOf('tracesSampleRate', code(f)).some((v) => v !== '0'))
      .map((f) => f.slice(root.length + 1));
    expect(otherRates, 'a tracesSampleRate other than 0').toEqual([]);

    const otherSamplers = sourceFiles(root)
      .filter((f) => valuesOf('tracesSampler', code(f)).some((v) => v !== 'sampleTraces'))
      .map((f) => f.slice(root.length + 1));
    expect(otherSamplers, 'a tracesSampler other than sampleTraces').toEqual([]);
  });
});
