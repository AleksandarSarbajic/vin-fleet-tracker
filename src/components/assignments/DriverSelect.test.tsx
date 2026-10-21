// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverSelect, listMaxWidth } from './DriverSelect';
import type { BoardDriver } from '@/server/assignments';

/**
 * §12.37. "+ Add driver" and the tag, on the surface a dispatcher uses.
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

const DRIVERS: BoardDriver[] = [
  {
    id: 'd-1',
    name: 'Samsara Sam',
    active: true,
    source: 'samsara',
    samsaraDriverId: 'sam-1',
    phone: null,
    truckId: null,
    truckLabel: null,
  },
  {
    id: 'd-2',
    name: 'Hand Entered Hal',
    active: true,
    source: 'app',
    samsaraDriverId: null,
    phone: null,
    truckId: null,
    truckLabel: null,
  },
];

function render(props: Partial<Parameters<typeof DriverSelect>[0]> = {}) {
  act(() => {
    root!.render(
      createElement(DriverSelect, {
        drivers: DRIVERS,
        value: null,
        claimedBy: new Map(),
        truckLabel: '137',
        disabled: false,
        onChange: vi.fn(),
        ...props,
      }),
    );
  });
  return container!;
}

const input = () => container!.querySelector('input')!;

function type(text: string) {
  act(() => {
    input().focus();
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    setter.call(input(), text);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const list = () => container!.querySelector('[role="listbox"]');

/**
 * The list appeared by itself whenever anything else put focus on the input
 * — the edit modal's opening focus on an empty truck did exactly that. Focus
 * alone keeps it shut; a click, typing, an arrow key or a Tab in opens it.
 */
describe('when the list opens', () => {
  it('stays closed when focus is put there programmatically', () => {
    render({ autoFocus: true });
    act(() => input().focus());
    expect(document.activeElement).toBe(input());
    expect(list()).toBeNull();
    expect(input().getAttribute('aria-expanded')).toBe('false');
  });

  it('opens on a click', () => {
    render();
    act(() => input().click());
    expect(list()).not.toBeNull();
  });

  it('opens when tabbed into — the Tab keyup lands on the input', () => {
    render();
    act(() => {
      input().focus();
      input().dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab', bubbles: true }));
    });
    expect(list()).not.toBeNull();
  });

  it('opens on ArrowDown and on typing', () => {
    render();
    act(() => {
      input().focus();
      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(list()).not.toBeNull();
    act(() => input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(list()).toBeNull();
    type('Sam');
    expect(list()).not.toBeNull();
  });
});

describe('the picker shows which drivers have an ELD', () => {
  it('tags the app-created driver in the open list, and not the Samsara one', () => {
    render();
    act(() => input().click());
    const tags = container!.querySelectorAll('[title*="not in Samsara"]');
    expect(tags.length).toBe(1);
    expect(container!.innerHTML).toContain('Hand Entered Hal');
    expect(container!.innerHTML).toContain('Samsara Sam');
  });
});

/**
 * The open list's width rule (§12.129). The DOM here has no layout, so the
 * rectangles are given by hand: this proves the arithmetic and which edges it
 * reads, not that a browser lays the list out that way (the harness and the
 * /assignments baseline do that).
 */
describe('how wide the open list may be', () => {
  function placed(el: HTMLElement, left: number, width: number) {
    el.getBoundingClientRect = () =>
      ({ left, width, right: left + width, top: 0, bottom: 36, height: 36, x: left, y: 0 }) as DOMRect;
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: width });
  }

  function layout(scroller: { left: number; width: number } | null, picker: { left: number; width: number }) {
    const outer = document.createElement('div');
    if (scroller) {
      outer.style.overflow = 'auto';
      placed(outer, scroller.left, scroller.width);
    }
    const box = document.createElement('div');
    placed(box, picker.left, picker.width);
    outer.appendChild(box);
    container!.appendChild(outer);
    return box;
  }

  it('stops at a scrolling ancestor’s right edge: the modal’s body at 768', () => {
    // The measured case: picker at 390, 338 wide; the modal body ends at 743.
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 768 });
    expect(listMaxWidth(layout({ left: 25, width: 718 }, { left: 390, width: 338 }))).toBe(353);
  });

  it('is never narrower than the picker, and never over 420', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1920 });
    expect(listMaxWidth(layout(null, { left: 100, width: 240 }))).toBe(420);
    expect(listMaxWidth(layout({ left: 0, width: 300 }, { left: 100, width: 240 }))).toBe(240);
  });

  it('keeps 16px clear of the viewport when nothing else clips it', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
    expect(listMaxWidth(layout(null, { left: 200, width: 100 }))).toBe(284);
  });

  it('says nothing when there is no layout to measure', () => {
    expect(listMaxWidth(layout(null, { left: 0, width: 0 }))).toBeNull();
  });

  it('keeps names on one line and the clear action out of the status colours', () => {
    render();
    act(() => input().click());
    expect(list()!.className).toContain('min-w-full');
    expect(list()!.className).not.toContain('right-0');
    const clear = [...container!.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Unassigned — clear this truck'),
    );
    expect(clear?.className).not.toContain('status-');
    for (const option of container!.querySelectorAll('[role="option"]')) {
      expect(option.className).toContain('whitespace-nowrap');
    }
  });
});

describe('"+ Add driver" appears when the search runs out', () => {
  it('is NOT offered before anything is typed', () => {
    render({ onDriverCreated: vi.fn() });
    act(() => input().click());
    expect(list()).not.toBeNull();
    // The control belongs to the moment of not finding someone, not to an
    // unfiltered list of everybody.
    expect(container!.innerHTML).not.toContain('as a new driver');
  });

  it('is offered when nothing matches, carrying what was typed', () => {
    render({ onDriverCreated: vi.fn() });
    type('Nobody Here');
    expect(container!.innerHTML).toContain('No driver matches');
    expect(container!.innerHTML).toContain('Nobody Here');
    expect(container!.innerHTML).toContain('as a new driver');
  });

  it('is NOT offered when the caller cannot refresh the board', () => {
    // A picker that offered it and then could not show the result would look
    // broken, so the affordance depends on the callback existing.
    render();
    type('Nobody Here');
    expect(container!.innerHTML).not.toContain('as a new driver');
  });

  it('opens a form pre-filled with the typed name', () => {
    render({ onDriverCreated: vi.fn() });
    type('Ada Lovelace');
    const add = [...container!.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('as a new driver'),
    );
    expect(add).toBeDefined();
    act(() => add!.click());
    const nameField = container!.querySelector<HTMLInputElement>(
      'input[aria-label="New driver name"]',
    );
    expect(nameField?.value).toBe('Ada Lovelace');
    expect(container!.querySelector('input[aria-label="New driver phone"]')).not.toBeNull();
    // The consequence is stated where the decision is made.
    expect(container!.innerHTML).toContain('No ELD');
  });
});

describe('the closed input carries the No ELD tag (§12.37)', () => {
  const tag = () => container!.querySelector('[title*="not in Samsara"]');

  it('for a driver with no ELD, and not for a Samsara driver', () => {
    render({ value: 'd-2' });
    expect(tag()).not.toBeNull();
    render({ value: 'd-1' });
    expect(tag()).toBeNull();
  });

  it('goes while the list is open, where the field holds a search', () => {
    render({ value: 'd-2' });
    act(() => input().click());
    // The open list tags Hal's option; the field's own tag is gone.
    expect(input().parentElement!.querySelector(':scope > span [title*="not in Samsara"]')).toBeNull();
  });

  it('opens the list when clicked, as the field would', () => {
    render({ value: 'd-2' });
    act(() => (tag()!.parentElement as HTMLElement).click());
    expect(list()).not.toBeNull();
  });
});

const optionNames = () =>
  [...container!.querySelectorAll('[role="option"] span.truncate')].map((s) => s.textContent);

describe('the order of the list', () => {
  const many = (n: number): BoardDriver[] =>
    Array.from({ length: n }, (_, i) => ({
      ...DRIVERS[0]!,
      id: `m-${i}`,
      name: `Driver ${String(i).padStart(2, '0')}`,
    }));

  it('puts drivers with no truck first, then the rest, each in its own order', () => {
    render({ claimedBy: new Map([['d-1', '200']]) });
    act(() => input().click());
    expect(optionNames()).toEqual(['Hand Entered Hal', 'Samsara Sam']);
  });

  it('counts the 40-match cap after the sort, so a free driver is never cut', () => {
    // 45 drivers, the last three free: unsorted, all three fell past 40.
    const drivers = many(45);
    const claimedBy = new Map(drivers.slice(0, 42).map((d, i) => [d.id, String(100 + i)]));
    render({ drivers, claimedBy });
    act(() => input().click());
    const names = optionNames();
    expect(names).toHaveLength(40);
    expect(names.slice(0, 3)).toEqual(['Driver 42', 'Driver 43', 'Driver 44']);
  });

  it('caps an unfiltered list at 40', () => {
    render({ drivers: many(45) });
    act(() => input().click());
    expect(optionNames()).toHaveLength(40);
  });
});

describe('the keys that clear and close', () => {
  const key = (k: string) =>
    act(() => input().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));

  it('Backspace on an empty search clears the truck', () => {
    const onChange = vi.fn();
    render({ value: 'd-1', onChange });
    act(() => input().focus());
    key('Backspace');
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('Backspace while a search is typed edits the search, and clears nothing', () => {
    const onChange = vi.fn();
    render({ value: 'd-1', onChange });
    type('Sa');
    key('Backspace');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Escape closes the list and keeps the driver', () => {
    const onChange = vi.fn();
    render({ value: 'd-1', onChange });
    act(() => input().click());
    key('Escape');
    expect(list()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(input().value).toBe('Samsara Sam');
  });
});
