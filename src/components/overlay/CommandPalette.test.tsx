// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from './CommandPalette';
import { OverlayProvider } from './OverlayLayer';
import { ShortcutSheet } from './ShortcutSheet';
import type { PaletteTruck } from '@/lib/palette';
import type { SavedView } from '@/lib/views';

/**
 * §14 feature 10. `palette.test.ts` owns what the catalogue contains; this
 * owns the two rulings that are about behaviour:
 *
 * > `/` filters the list in place, `⌘K` **jumps and closes**. (§14.5)
 * > Only one overlay open at a time. `?` inside the palette types a "?".
 */

const TRUCKS: PaletteTruck[] = [
  {
    id: 't1',
    truckNumber: 101,
    samsaraName: 'Truck #101',
    driverName: 'M. Kowalczyk',
    cityState: 'Joliet, IL',
    nextStop: null,
    formattedLocation: null,
  },
  {
    id: 't2',
    truckNumber: 202,
    samsaraName: 'Truck #202',
    driverName: 'R. Alvarez',
    cityState: 'Fargo, ND',
    nextStop: null,
    formattedLocation: null,
  },
];

const VIEWS: SavedView[] = [{ id: 'v1', name: 'Late today', query: '', chips: ['late'] }];

let container: HTMLDivElement;
let root: Root;
const spies = {
  select: vi.fn(),
  apply: vi.fn(),
  pin: vi.fn(),
  density: vi.fn(),
};

const render = (selectedLabel: string | null = 'Truck 101') => {
  act(() => {
    root.render(
      <OverlayProvider>
        <CommandPalette
          trucks={TRUCKS}
          views={VIEWS}
          selectedLabel={selectedLabel}
          selectedPinned={false}
          density="comfortable"
          onSelectTruck={spies.select}
          onApplyView={spies.apply}
          onTogglePin={spies.pin}
          onToggleDensity={spies.density}
        />
        <ShortcutSheet />
      </OverlayProvider>,
    );
  });
};

const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  });

const field = () => container.querySelector<HTMLInputElement>('input[role="combobox"]');

const type = (value: string) =>
  act(() => {
    const el = field()!;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

const options = () => [...container.querySelectorAll('[role="option"]')];
const selected = () => options().find((o) => o.getAttribute('aria-selected') === 'true');
const enter = () =>
  act(() => {
    field()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
const arrow = (key: 'ArrowDown' | 'ArrowUp') =>
  act(() => {
    field()!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });

beforeEach(() => {
  for (const spy of Object.values(spies)) spy.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('opening', () => {
  it('is closed until ⌘K', () => {
    render();
    expect(field()).toBeNull();
    press('k', { metaKey: true });
    expect(field()).not.toBeNull();
  });

  it('opens on ctrl+K too', () => {
    render();
    press('k', { ctrlKey: true });
    expect(field()).not.toBeNull();
  });

  it('does not open on a bare k — that is typing', () => {
    render();
    press('k');
    expect(field()).toBeNull();
  });

  it('closes on the same keystroke that opened it', () => {
    render();
    press('k', { metaKey: true });
    press('k', { metaKey: true });
    expect(field()).toBeNull();
  });

  /** Every opening starts from an empty box, never from last time's query. */
  it('forgets the last query', () => {
    render();
    press('k', { metaKey: true });
    type('alvarez');
    press('Escape');
    press('k', { metaKey: true });
    expect(field()?.value).toBe('');
  });
});

describe('running a command', () => {
  it('jumps to a truck and closes (§14.5)', () => {
    render();
    press('k', { metaKey: true });
    type('alvarez');
    enter();
    expect(spies.select).toHaveBeenCalledWith('t2');
    expect(field()).toBeNull();
  });

  it('applies a saved view', () => {
    render();
    press('k', { metaKey: true });
    type('late today');
    enter();
    expect(spies.apply).toHaveBeenCalledWith(VIEWS[0]);
  });

  it('toggles the pin on the selected truck', () => {
    render();
    press('k', { metaKey: true });
    type('pin');
    enter();
    expect(spies.pin).toHaveBeenCalled();
  });

  it('toggles density', () => {
    render();
    press('k', { metaKey: true });
    type('compact');
    enter();
    expect(spies.density).toHaveBeenCalled();
  });

  /**
   * §14.5: one overlay at a time. The sheet must REPLACE the palette rather
   * than open behind it or race it closed.
   */
  it('hands over to the cheat sheet rather than stacking on it', () => {
    render();
    press('k', { metaKey: true });
    type('keyboard');
    enter();
    expect(field()).toBeNull();
    expect(container.querySelector('[aria-label="Keyboard shortcuts"]')).not.toBeNull();
  });

  it('runs the row the mouse is over, not the row the cursor was on', () => {
    render();
    press('k', { metaKey: true });
    type('truck');
    const second = options()[1]!;
    act(() => {
      second.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    expect(selected()).toBe(second);
  });
});

describe('the cursor', () => {
  it('starts on the first row', () => {
    render();
    press('k', { metaKey: true });
    type('truck');
    expect(selected()).toBe(options()[0]);
  });

  it('wraps from the last row to the first', () => {
    render();
    press('k', { metaKey: true });
    type('truck');
    const count = options().length;
    for (let i = 0; i < count; i += 1) arrow('ArrowDown');
    expect(selected()).toBe(options()[0]);
  });

  it('goes back to the first row when the query changes', () => {
    render();
    press('k', { metaKey: true });
    type('truck');
    arrow('ArrowDown');
    type('t');
    expect(selected()).toBe(options()[0]);
  });
});

describe('what it says about itself', () => {
  /** §14.3, said out loud so the absence reads as a decision. */
  it('names the line it does not cross', () => {
    render();
    press('k', { metaKey: true });
    expect(container.textContent).toContain('statuses are set on the row');
  });

  /**
   * §14.5, verbatim: "`?` inside the palette types a '?'." It falls out of
   * the shared `isTypingTarget` guard rather than a special case — but the
   * ruling is explicit, so it gets an explicit assertion.
   */
  it('lets ? be typed rather than opening the sheet over itself', () => {
    render();
    press('k', { metaKey: true });
    act(() => {
      field()!.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    });
    expect(container.querySelector('[aria-label="Keyboard shortcuts"]')).toBeNull();
    expect(field()).not.toBeNull();
  });

  it('opens as a menu rather than an empty box', () => {
    render();
    press('k', { metaKey: true });
    // Views and actions, and no trucks: six arbitrary trucks on open would
    // suggest the first one is a suggestion.
    expect(container.textContent).toContain('Late today');
    expect(container.textContent).not.toContain('Truck 202');
  });
});
