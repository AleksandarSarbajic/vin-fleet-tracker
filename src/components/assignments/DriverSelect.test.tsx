// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverSelect } from './DriverSelect';
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

describe('the picker shows which drivers have an ELD', () => {
  it('tags the app-created driver in the open list, and not the Samsara one', () => {
    render();
    act(() => input().focus());
    const tags = container!.querySelectorAll('[title*="not in Samsara"]');
    expect(tags.length).toBe(1);
    expect(container!.innerHTML).toContain('Hand Entered Hal');
    expect(container!.innerHTML).toContain('Samsara Sam');
  });
});

describe('"+ Add driver" appears when the search runs out', () => {
  it('is NOT offered before anything is typed', () => {
    render({ onDriverCreated: vi.fn() });
    act(() => input().focus());
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
