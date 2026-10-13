import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { E2E_DIST_DIR, SENTRY_SINK_PORT } from '../playwright.config';

/**
 * The language-model reader's key is in no file the browser can load
 * (CLAUDE.md, non-negotiable; Alex, 2026-10-14). The source-level proof is
 * src/test/reader-key-bundle.test.ts; this one reads the BUILD.
 *
 * The key is SYNTHETIC — never the real one. `npm run e2e` puts it in the
 * environment the e2e build and server start with, and sets
 * E2E_READER_KEY_SCAN=1. The real key is never read, compared or printed
 * here: run any other way (e2e:ui), this spec is skipped.
 */

/** Must match the `e2e` script in package.json. Invented: it opens nothing. */
const SYNTHETIC_KEY = 'sk-ant-e2e-SYNTHETIC-not-a-real-key-4f1c9a';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

test('the reader key is in no file of the browser bundle', () => {
  test.skip(process.env.E2E_READER_KEY_SCAN !== '1', 'Run through `npm run e2e`, which gives the build the synthetic key.');
  // A boolean, so a mismatch can never print whatever key is there instead.
  expect(process.env.LLM_READER_API_KEY === SYNTHETIC_KEY, 'the e2e script must set the synthetic key').toBe(true);

  const shipped = files(join(E2E_DIST_DIR, 'static'));
  expect(shipped.length).toBeGreaterThan(10);

  const holding = (needle: string) => shipped.filter((f) => readFileSync(f).includes(needle));

  // The control: an env value Next DOES inline (the e2e Sentry DSN points at
  // the local sink) is found by this same scan, so a clean result means
  // something.
  expect(holding(`127.0.0.1:${SENTRY_SINK_PORT}/sentrysink`).length).toBeGreaterThan(0);

  expect(holding(SYNTHETIC_KEY)).toEqual([]);
});
