import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * §8.3 and §12.148: under reduced motion every transition is a true 0.
 *
 * It was 0.01ms, which looked the same and was not. Elements default to
 * `transition-property: all`, so every element "transitioned" every property
 * for one frame, and anything read straight after a change was the old value.
 * For anyone with Reduce Motion on, a click on the driver picker did not open
 * it and a map popup was measured in the wrong place. Fifteen e2e tests failed
 * for that one reason (phase 3bb).
 *
 * Animations keep a tiny duration on purpose: code waits on `animationend`.
 */
describe('the reduced-motion rule (§8.3)', () => {
  const css = readFileSync(join(__dirname, 'globals.css'), 'utf8');
  const rule = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));

  it('makes every transition a true 0', () => {
    expect(rule).toMatch(/transition-duration:\s*0s\s*!important/);
  });

  it('keeps animations short enough to end, not absent', () => {
    expect(rule).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
  });

  /**
   * The rule above is CSS, and a Web Animation does not read it: `el.animate()` runs
   * at full length under reduced motion. So there is one place that may call it, and
   * that place asks first (`lib/motion.ts`, whose tests hold the asking).
   */
  it('nothing outside lib/motion.ts starts a Web Animation', () => {
    const src = join(__dirname, '..');
    const offenders = readdirSync(src, { recursive: true, encoding: 'utf8' })
      .filter((p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p))
      .filter((p) => /\.animate\(/.test(readFileSync(join(src, p), 'utf8')))
      .map((p) => relative('', p));
    expect(offenders).toEqual(['lib/motion.ts']);
  });
});
