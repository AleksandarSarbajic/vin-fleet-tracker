import * as staticInfo from 'next/dist/build/analysis/get-page-static-info';
import type { NextConfig } from 'next';
import { describe, expect, it, vi } from 'vitest';

/**
 * Which paths the login check runs on: `config.matcher`, compiled by Next's
 * own function, as the build compiles it. Only the config is under test, so
 * the client env the middleware reads at import is stood in for.
 */

/** Next's own matcher compiler: exported by its build, though not by its types. A Next without it fails here, not quietly. */
const { getMiddlewareMatchers } = staticInfo as unknown as {
  getMiddlewareMatchers?: (matcher: string[], nextConfig: NextConfig) => { regexp: string }[];
};
if (typeof getMiddlewareMatchers !== 'function') throw new Error('next/dist/build/analysis/get-page-static-info no longer exports getMiddlewareMatchers.');

vi.mock('@/env/client', () => ({
  clientEnv: { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example' },
}));

const { config } = await import('./middleware');
const matchers = getMiddlewareMatchers(config.matcher, {} as NextConfig).map((m) => new RegExp(m.regexp));
const checked = (path: string) => matchers.some((m) => m.test(path));

describe('the login check', () => {
  it('does not run on the scan reader’s files (§12.128): open-source npm assets, nothing secret', () => {
    for (const path of [
      '/ocr/worker.min.js',
      '/ocr/core/tesseract-core-simd-lstm.wasm.js',
      '/ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js',
      '/ocr/core/tesseract-core-lstm.wasm.js',
      '/ocr/lang/eng.traineddata.gz',
    ]) {
      expect(checked(path), path).toBe(false);
    }
  });

  it('still runs on every page and every route handler', () => {
    for (const path of ['/', '/login', '/history', '/api/fleet', '/api/stops', '/api/ratecon/read', '/api/ocr/anything']) {
      expect(checked(path), path).toBe(true);
    }
  });

  it('only the folder is left out: a path that merely starts with "ocr" is checked', () => {
    for (const path of ['/ocr', '/ocrx', '/ocr-report']) expect(checked(path), path).toBe(true);
  });

  it('what was left out before still is', () => {
    for (const path of ['/_next/static/chunks/main.js', '/_next/image', '/favicon.ico', '/manifest.webmanifest', '/brand/logo.svg', '/brand/tile.png']) {
      expect(checked(path), path).toBe(false);
    }
  });
});
