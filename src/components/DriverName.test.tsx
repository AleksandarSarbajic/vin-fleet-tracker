// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DriverName } from './DriverName';

/**
 * §12.133. A struck name is struck on its own box, and its No ELD tag is not.
 *
 * The DOM here has no rendering, so "struck" means the `line-through` class
 * sits on the name's own element. That is the point: a `line-through` on a
 * WRAPPER does not reach into DriverName's inline-flex box in a browser, which
 * is how the confirm's names went unstruck (seen in a local render, 3am).
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(props: Parameters<typeof DriverName>[0]) {
  act(() => root!.render(createElement(DriverName, props)));
  return container!;
}

const tag = () => container!.querySelector('[title*="not in Samsara"]');
/** The element holding exactly this text. */
const textEl = (text: string) =>
  [...container!.querySelectorAll('span')].find((el) => el.textContent === text && el.children.length === 0);

describe('DriverName struck (§12.133)', () => {
  it('strikes the name on its own element, and not the No ELD tag', () => {
    render({ name: 'Hand Entered Hal', source: 'app', samsaraDriverId: null, struck: true });
    expect(textEl('Hand Entered Hal')!.className).toContain('line-through');
    expect(tag()).not.toBeNull();
    expect(tag()!.closest('.line-through')).toBeNull();
  });

  it('strikes the fallback when there is no driver', () => {
    render({ name: null, source: null, samsaraDriverId: null, fallback: '—', struck: true });
    expect(container!.querySelector('.line-through')?.textContent).toBe('—');
  });

  it('strikes nothing by default', () => {
    render({ name: 'Samsara Sam', source: 'samsara', samsaraDriverId: 'sam-1' });
    expect(container!.querySelector('.line-through')).toBeNull();
    render({ name: null, source: null, samsaraDriverId: null, fallback: 'Unassigned' });
    expect(container!.querySelector('.line-through')).toBeNull();
  });
});
