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
