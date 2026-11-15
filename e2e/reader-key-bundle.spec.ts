import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { E2E_DIST_DIR, SENTRY_SINK_PORT } from '../playwright.config';
import { E2E_READER_ENV } from './reader-env';

/**
 * The language-model reader's key is in no file the browser can load
 * (CLAUDE.md, non-negotiable; Alex, 2026-10-14). The source-level proof is
 * src/test/reader-key-bundle.test.ts; this one reads the BUILD.
 *
 * The key is SYNTHETIC — never the real one. `playwright.config.ts` puts it
 * in the environment of every run, and of the e2e build and server, however
 * the run is started (`E2E_READER_ENV`, §12.161), and does so BEFORE it loads
 * `.env.local`: the real key never reaches this process, so it is never read,
 * compared or printed here. The scan runs in every run, however it is started (phase 3bw,
 * §12.162): since 3bv every run holds the synthetic key, so the old `E2E_READER_KEY_SCAN=1`
 * gate only made `npx playwright test` and `npm run e2e:ui` skip it.
 */

/** Invented: it opens nothing. Kept in one place, `e2e/reader-env.ts`. */
const SYNTHETIC_KEY = E2E_READER_ENV.LLM_READER_API_KEY;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

test('the reader key is in no file of the browser bundle', () => {
  // A boolean, so a mismatch can never print whatever key is there instead.
  expect(process.env.LLM_READER_API_KEY === SYNTHETIC_KEY, 'playwright.config.ts must give the run the synthetic key').toBe(true);

  const shipped = files(join(E2E_DIST_DIR, 'static'));
  expect(shipped.length).toBeGreaterThan(10);

  const holding = (needle: string) => shipped.filter((f) => readFileSync(f).includes(needle));

  // The control: an env value Next DOES inline (the e2e Sentry DSN points at
  // the local sink) is found by this same scan, so a clean result means
  // something.
  expect(holding(`127.0.0.1:${SENTRY_SINK_PORT}/sentrysink`).length).toBeGreaterThan(0);

  expect(holding(SYNTHETIC_KEY)).toEqual([]);
});
