import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * §12.148, Alex's rules for hover and press, checked against the stylesheet: a
 * rule that breaks one of them would look fine until the wrong thing moved.
 */
const css = readFileSync(join(__dirname, 'globals.css'), 'utf8');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selector: m[1]!.replace(/\/\*[\s\S]*?\*\//g, '').trim(),
  body: m[2]!,
}));
const moves = (body: string) => /\b(transform|translate|scale)\s*:/.test(body);

describe('hover and press (§12.148)', () => {
  const onRow = rules.filter((r) => r.selector.includes('[data-row-id]'));

  it('has rules for rows at all', () => {
    expect(onRow.length).toBeGreaterThan(0);
  });

  it('a row never moves on hover: no transform of any kind, not even a zero one', () => {
    const atHover = onRow.filter(
      (r) => r.selector.includes(':hover') && !r.selector.includes('::'),
    );
    expect(atHover.length).toBeGreaterThan(0);
    for (const rule of atHover) expect(moves(rule.body), rule.selector).toBe(false);
  });

  it('the only transform on a row itself is while it is pressed', () => {
    const moving = onRow.filter((r) => !r.selector.includes('::') && moves(r.body));
    expect(moving.length).toBe(1);
    expect(moving[0]!.selector).toContain(':active');
  });

  it('a row presses at press-in and lets go at press-out, like a button', () => {
    const pressed = onRow.find(
      (r) => r.selector.includes(':active') && !r.selector.includes('::') && moves(r.body),
    );
    expect(pressed?.body).toContain("theme('transitionDuration.press-in')");
    const released = onRow.find(
      (r) => !r.selector.includes(':active') && r.body.includes('transition-property'),
    );
    expect(released?.body).toContain("theme('transitionDuration.press-out')");
    // Hover has no say over the transform's length: it would be a third speed.
    const atHover = onRow.filter(
      (r) => r.selector.includes(':hover') && !r.selector.includes('::'),
    );
    for (const rule of atHover) {
      const durations = rule.body.match(/transition-duration:[^;]*;/)?.[0] ?? '';
      expect(durations, rule.selector).toContain("theme('transitionDuration.press-out')");
    }
  });

  it('the row keeps its grey hover bar, on a pseudo-element beside it', () => {
    const bar = onRow.find(
      (r) => r.selector.includes('::after') && r.body.includes('width'),
    );
    expect(bar?.body).toContain('colors.text.muted');
    expect(onRow.some((r) => r.selector.includes(':hover::after'))).toBe(true);
  });

  it('what moves leaves out everything a transform would break', () => {
    const buttons = rules.filter(
      (r) => r.selector.startsWith(':is(button') && moves(r.body),
    );
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    for (const { selector } of buttons) {
      for (const out of [
        ':disabled',
        '[data-no-press]',
        "[class*='sticky']",
        "[class*='fixed']",
        "[class*='translate']",
        "[class*='inset-0']",
        '.mapboxgl-map *',
      ]) {
        expect(selector, out).toContain(out);
      }
    }
  });

  /*
   * A hit area past the resting box makes the scroller around it grow, and the
   * list's scrollbars appear (3bb's live bug: `inset: -4px` on a row).
   */
  describe('a hit area', () => {
    const areas = rules.filter(
      (r) =>
        r.selector.includes(':active') &&
        (r.selector.includes('::before') || r.selector.includes('::after')),
    );
    const anchored = areas.filter((r) =>
      /\b(left|right|top|bottom): var\(--reach\)/.test(r.body),
    );

    it('has rules at all', () => {
      expect(areas.length).toBeGreaterThanOrEqual(5);
    });

    it('reaches a share from the token, never a fixed distance past the box', () => {
      for (const { selector, body } of areas) {
        expect(body, selector).not.toMatch(/\binset\s*:/);
        expect(body, selector).not.toMatch(/-\d*\.?\d+px/);
      }
      const reach = areas.filter((r) => r.body.includes('--reach:'));
      expect(reach.length).toBe(2);
      for (const { body } of reach) expect(body).toContain('var(--press)');
    });

    it('grows with the press, so it does not stick out on the first frames', () => {
      expect(anchored.length).toBe(3);
      for (const { selector, body } of anchored) {
        expect(body, selector).toMatch(/animation: hit-area-press-/);
      }
      for (const name of ['before', 'after', 'row']) {
        expect(css).toContain(`@keyframes hit-area-press-${name}`);
      }
    });

    it('covers the border too: the widths are inherited on the side it grows away from', () => {
      for (const { selector, body } of anchored) {
        expect(body, selector).toMatch(/border-(left|right)-width: inherit/);
        expect(body, selector).toMatch(/border-(top|bottom)-width: inherit/);
      }
    });

    it('a row has one only while the row itself is pressed, not a control in it', () => {
      const onRow = areas.filter((r) => r.selector.includes('[data-row-id]'));
      expect(onRow.length).toBe(1);
      expect(onRow[0]!.selector).toContain(':not(:has(button:active');
    });

    it('is off under reduced motion, with the movement', () => {
      const start = css.indexOf('@media (prefers-reduced-motion: no-preference)');
      for (const { selector } of areas) {
        expect(css.indexOf(selector), selector).toBeGreaterThan(start);
      }
    });
  });

  it('all of the movement is off under reduced motion', () => {
    const start = css.indexOf('@media (prefers-reduced-motion: no-preference)');
    expect(start).toBeGreaterThan(-1);
    for (const { selector, body } of rules) {
      const ours =
        selector.startsWith(':is(button') || selector.includes('[data-row-id]');
      if (!ours || !moves(body) || selector.includes('::')) continue;
      expect(css.indexOf(selector), selector).toBeGreaterThan(start);
    }
  });
});
