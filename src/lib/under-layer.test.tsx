// @vitest-environment happy-dom
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnderLayer } from '@/components/overlay/UnderLayer';
import { STYLESHEET_HOSTS, UNDER_LAYER_CLASSES, layUnder, ownsStackingContext } from './under-layer';

/**
 * §12.165. The shared layer for anything drawn under a host's content, and check (b): no layer
 * with a negative z-index anywhere in the app outside it. The hosts themselves are check (a),
 * `under-layer-hosts.test.tsx`.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const element = (tag: string, classes = '', attrs: Record<string, string> = {}) => {
  const el = document.createElement(tag);
  el.className = classes;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return document.body.appendChild(el);
};

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('ownsStackingContext reads the class list, as the browser will draw it', () => {
  it.each([
    ['relative isolate', 'div', '', true],
    ['absolute isolate', 'div', '', true],
    ['fixed isolate', 'div', '', true],
    ['sticky isolate', 'div', '', true],
    ['relative alone', 'div', 'relative', false],
    ['isolate alone', 'div', 'isolate', false],
    ['isolate with static', 'div', 'relative isolate static', false],
    ['relative with isolation-auto', 'div', 'relative isolate isolation-auto', false],
    ['a breakpoint’s isolate only', 'div', 'relative md:isolate', false],
  ])('%s', (_label, tag, classes, owns) => {
    expect(ownsStackingContext(element(tag, classes || _label))).toBe(owns);
  });

  it('a chip marked by groundPop, whose rule in globals.css makes it one; nothing else with the mark', () => {
    expect(ownsStackingContext(element('button', '', { 'data-ground-host': '' }))).toBe(true);
    expect(ownsStackingContext(element('button'))).toBe(false);
    expect(ownsStackingContext(element('div', '', { 'data-ground-host': '' }))).toBe(false);
  });

  it("each stylesheet host's rule in globals.css sets position: relative and isolation: isolate", () => {
    const css = readFileSync(join(ROOT, 'src/app/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const selector of STYLESHEET_HOSTS) {
      const at = css.indexOf(`${selector} {`);
      expect(at, `a rule for ${selector} in globals.css`).toBeGreaterThan(-1);
      const body = css.slice(at, css.indexOf('}', at));
      expect(body, selector).toMatch(/position:\s*relative\s*;/);
      expect(body, selector).toMatch(/isolation:\s*isolate\s*;/);
    }
  });
});

describe('layUnder', () => {
  it('lays the layer first in a host that owns its context, with the layer classes', () => {
    const host = element('div', 'relative isolate');
    host.append(document.createElement('button'));
    const layer = document.createElement('span');
    expect(layUnder(host, layer)).toBe(true);
    expect(host.firstElementChild).toBe(layer);
    expect([...UNDER_LAYER_CLASSES].every((c) => layer.classList.contains(c))).toBe(true);
  });

  it('refuses a host without one, loudly, naming the host and the fix, and adds nothing', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const host = element('div', 'flex border', { 'aria-label': 'Basemap' });
    expect(layUnder(host, document.createElement('span'))).toBe(false);
    expect(host.children).toHaveLength(0);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toBe(
      '§12.165: nothing may be drawn under <div "Basemap" class="flex border">, which has no stacking context of its own; ' +
        'the layer would paint under its ground and not be seen. Give the host `relative isolate`.',
    );
  });
});

describe('UnderLayer, the same for a layer React draws', () => {
  const mount = (hostClasses: string) => {
    const host = element('div');
    const root = createRoot(host);
    act(() =>
      root.render(
        <div className={hostClasses} data-host>
          <UnderLayer className="inset-0 animate-flash" />
        </div>,
      ),
    );
    return { layer: host.querySelector<HTMLElement>('[data-host] > div')!, unmount: () => act(() => root.unmount()) };
  };

  it('inside a host that owns its context: the layer classes, hidden from the accessibility tree, shown', () => {
    const { layer, unmount } = mount('relative isolate');
    expect(layer.className).toBe('absolute -z-10 inset-0 animate-flash');
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    expect(layer.hidden).toBe(false);
    unmount();
  });

  it('inside one without: refused loudly, and hidden rather than painted where nothing shows it', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { layer, unmount } = mount('grid');
    expect(layer.hidden).toBe(true);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toMatch(/^§12\.165: nothing may be drawn under <div class="grid">/);
    unmount();
  });
});

/**
 * Check (b). A layer with a negative z-index is drawn under its host's ground unless the host owns
 * a stacking context, and only `layUnder` and `UnderLayer` ask. So none may be written anywhere
 * else: a Tailwind `-z-N` or `z-[-N]`, an inline `zIndex` below 0, or a CSS `z-index` below 0.
 * Comments are stripped first, as sentry-privacy.test.ts strips them, so a note about a layer does
 * not count.
 *
 * One CSS rule is known: the row's press layer, a `::before` that cannot be laid by code. Its host,
 * the truck row, is in `under-layer-hosts.test.tsx`.
 */
describe('no layer under its host outside the shared layer', () => {
  const SHARED = 'src/lib/under-layer.ts';
  const KNOWN_CSS = new Map([
    [
      '[data-row-id]:active:not(:has(button:active, a:active, input:active))::before',
      'the press layer, host: a truck row (under-layer-hosts.test.tsx)',
    ],
  ]);
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.(ts|tsx|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [relative(ROOT, path)] : [];
    });
  const withoutComments = (text: string, css: boolean) =>
    css
      ? text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
      : text
          .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
          .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const NEGATIVE = [
    /(^|[\s'"`{(,])-z-(\d+|\[)/m,
    /(^|[\s'"`{(,])z-\[-/m,
    /zIndex\s*[:=]\s*['"`]?\s*-\s*\d/m,
    /z-index\s*:\s*-\s*\d/m,
  ];

  it(`writes a negative z-index only in ${SHARED}, and in globals.css only for the rules it knows`, () => {
    const found: string[] = [];
    for (const file of files(join(ROOT, 'src'))) {
      if (file === SHARED) continue;
      const css = file.endsWith('.css');
      const lines = withoutComments(readFileSync(join(ROOT, file), 'utf8'), css).split('\n');
      lines.forEach((line, i) => {
        if (!NEGATIVE.some((re) => re.test(line))) return;
        if (css) {
          const before = lines.slice(0, i + 1).join('\n');
          const open = before.lastIndexOf('{');
          const selector = before
            .slice(before.lastIndexOf('}', open) + 1, open)
            .trim()
            .replace(/\s+/g, ' ');
          if (KNOWN_CSS.has(selector)) return;
        }
        found.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(found, 'draw it with layUnder or UnderLayer (src/lib/under-layer.ts), which checks its host').toEqual([]);
  });

  it('finds what it looks for, so it cannot pass by finding nothing', () => {
    const shared = withoutComments(readFileSync(join(ROOT, SHARED), 'utf8'), false);
    expect(NEGATIVE.some((re) => re.test(shared))).toBe(true);
    for (const sample of ["className=\"absolute -z-10\"", "el.className = 'x -z-1'", "'z-[-1]'", 'style={{ zIndex: -1 }}', "z-index: -1;"]) {
      expect(NEGATIVE.some((re) => re.test(sample)), sample).toBe(true);
    }
    for (const sample of ['z-10', 'max-z-10', "className=\"z-[1]\"", 'z-index: 1;']) {
      expect(NEGATIVE.some((re) => re.test(sample)), sample).toBe(false);
    }
  });
});
