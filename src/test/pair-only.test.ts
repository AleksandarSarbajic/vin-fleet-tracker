import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A read is a PAIR, and there is no other (Alex, 2026-10-14). The AI reader's
 * route returns two reads; `readPair` is the one function that verifies and
 * merges them; the strip and `ratecon:eval-ai` both call it. This walks the
 * source and fails if a second way in appears: a client that returns one
 * reply, a caller that verifies a reply on its own, or a strip that fills
 * from one read.
 *
 * The evaluation's default single-read mode (no `--pairs`) and the one-call
 * `reader:smoke` are measuring tools, not paths of the app: they are the only
 * other places a lone reply is verified, and fill no form. They are named
 * below so a new one cannot hide beside them.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const SOURCE_EXT = /\.(ts|tsx|mts)$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) return [];
    return statSync(path).isDirectory() ? walk(path) : SOURCE_EXT.test(name) ? [path] : [];
  });
}
const rel = (path: string) => relative(ROOT, path);
const isTest = (path: string) => /\.test\.(ts|tsx)$/.test(path) || /\/(e2e|test)\//.test(path.replace(ROOT, ''));

const APP = walk(join(ROOT, 'src')).filter((p) => !isTest(p));
const SCRIPTS = walk(join(ROOT, 'scripts'));
/** The file's code, without its comments (which name these things to say why they are gone). */
const read = (path: string) =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const importing = (files: string[], name: RegExp) => files.filter((p) => name.test(read(p))).map(rel);

describe('the app has no way to read once', () => {
  it('no client function returns a single reply: requestModelRead is gone, only requestModelReads exists', () => {
    const everything = [...APP, ...SCRIPTS, ...walk(join(ROOT, 'e2e'))];
    expect(importing(everything, /\brequestModelRead\b/)).toEqual([]);
    expect(importing(APP, /\brequestModelReads\b/).sort()).toEqual([
      'src/components/edit/RateconStrip.tsx',
      'src/lib/ratecon/read-client.ts',
    ]);
  });

  it('verifyRead is called by readPair alone in the app: no caller verifies one reply and fills from it', () => {
    const callers = importing(APP, /\bverifyRead\s*\(/).filter((p) => p !== 'src/lib/ratecon/verify-read.ts');
    expect(callers).toEqual(['src/lib/ratecon/read-pair.ts']);
  });

  it('the strip fills an AI read from the merged agreement only: no verifier, no single read in sight', () => {
    const strip = read(join(ROOT, 'src/components/edit/RateconStrip.tsx'));
    expect(strip).toMatch(/from '@\/lib\/ratecon\/read-pair'/);
    for (const forbidden of [/\bverifyRead\b/, /\buncitedAddressLines\b/, /\.reads\b/, /\.verified\b/, /\bagreeReads\b/, /\bout\.reply\b/]) {
      expect(strip, String(forbidden)).not.toMatch(forbidden);
    }
    // The only thing a model read is filled from is the agreement's read.
    expect(strip).toMatch(/const \{ read, notices \} = pair\.agreement;/);
  });

  it('agreeReads, which merges two VERIFIED reads without checking either, is called only by agreePair', () => {
    const callers = importing(APP, /\bagreeReads\s*\(/).filter((p) => p !== 'src/lib/ratecon/agree-reads.ts');
    expect(callers).toEqual([]);
  });

  it('the route answers with a pair or a code: its success body has no single `read`', () => {
    const route = read(join(ROOT, 'src/server/ratecon-reader/handle-read.ts'));
    expect(route).toMatch(/reply\(\{ ok: true, reads: \[/);
    // (A call's own result inside the route is `{ ok: true, read }`; the RESPONSE never is.)
    expect(route).not.toMatch(/reply\(\{ ok: true, read:/);
    const codes = read(join(ROOT, 'src/lib/ratecon/read-codes.ts'));
    expect(codes).toMatch(/ok: true; reads: \[unknown, unknown\]/);
    expect(codes).not.toMatch(/ok: true; read: unknown/);
  });
});

describe('the evaluation measures what the app runs', () => {
  it('a pair in ratecon:eval-ai is readPair — the strip\'s function — and it keeps no copy of the logic', () => {
    const evalSource = read(join(ROOT, 'scripts/ratecon-eval.mts'));
    expect(evalSource).toMatch(/from '\.\.\/src\/lib\/ratecon\/read-pair'/);
    expect(evalSource).toMatch(/readPair\(side\(a\), side\(b\)/);
    expect(evalSource).not.toMatch(/\bagreePair\b|\bagreeReads\b/);
  });

  it('only two scripts verify a lone reply, both diagnostics that fill no form: the evaluation\'s single mode, and the one-call smoke check', () => {
    expect(importing(SCRIPTS, /\bverifyRead\s*\(/).sort()).toEqual(['scripts/ratecon-eval.mts', 'scripts/reader-smoke.mts']);
  });
});
