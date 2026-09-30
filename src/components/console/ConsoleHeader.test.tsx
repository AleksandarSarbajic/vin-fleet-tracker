// @vitest-environment happy-dom
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fleetRow } from '@/test/fleet-row';
import type { FilterKey } from './FilterChips';

/**
 * §12.91. The feed-down block is ANNOUNCED. A live region only speaks about
 * a change to a region that was already in the page, so the test renders the
 * healthy header first and then the dead one, and asserts on the same node.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('@/app/actions/profile', () => ({ updateDisplayName: vi.fn() }));
vi.mock('@/app/login/actions', () => ({ signOut: vi.fn() }));

const { ConsoleHeader } = await import('./ConsoleHeader');

const NEWEST = '2026-09-18T11:51:00.000Z';

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
});

const render = async (feedStale: boolean) => {
  await act(async () => {
    root!.render(
      createElement(ConsoleHeader, {
        rows: [fleetRow()],
        chips: new Set<FilterKey>(),
        onToggleChip: () => {},
        onResetChips: () => {},
        query: '',
        onQueryChange: () => {},
        matchCount: 1,
        totalCount: 1,
        fetchedAt: '2026-09-18T12:00:00.000Z',
        feedNewestAt: NEWEST,
        feedStale,
        dispatchTz: 'America/Chicago',
        user: { fullName: 'Sam Leasar', email: 's@x.test', role: 'admin' as const },
        views: {
          saved: [],
          active: null,
          onApply: () => {},
          onSave: () => null,
          onRemove: () => {},
          onRename: () => null,
          canSaveCurrent: true,
        },
        scope: { count: 1, fleetCount: 1, viewCount: () => 0, onClear: () => {} },
        notes: [],
        selected: false,
      }),
    );
  });
};

const region = () => container!.querySelector('[role="status"][aria-live="polite"]');

describe('the feed going down is announced (§12.91)', () => {
  it('is a polite live region that is there, empty, while the feed is healthy', async () => {
    await render(false);
    expect(region()).not.toBeNull();
    expect(region()?.textContent).toBe('');
    expect(container!.querySelector('[data-feed-down]')).toBeNull();
  });

  it('the same region says so when the feed goes down, naming the last sync', async () => {
    await render(false);
    const before = region();
    await render(true);
    // The same node, so assistive technology hears the change.
    expect(region()).toBe(before);
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Chicago',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(NEWEST));
    expect(region()?.textContent).toBe(`Feed down. Last sync ${time}.`);
    expect(container!.querySelector('[data-feed-down]')).not.toBeNull();
  });

  it('does not tick: the age lives outside the region', async () => {
    await render(true);
    expect(region()?.textContent).not.toMatch(/ago/);
    expect(container!.querySelector('[data-feed-down]')?.textContent).toMatch(/ago/);
  });
});

describe('the chips name their keys (§12.91)', () => {
  it('reads "Late · key 1" through "Drivers only · key 8", and All · key 0', async () => {
    await render(false);
    const titles = [
      ...container!.querySelectorAll('[aria-label="Filter by status"] button'),
    ].map((b) => b.getAttribute('title'));
    expect(titles).toEqual([
      'All · key 0',
      'Late · key 1',
      'At risk · key 2',
      'On time · key 3',
      'Arrived · key 4',
      'Upcoming · key 5',
      'Data issues · key 6',
      'Inactive · key 7',
      'Drivers only · key 8',
    ]);
  });
});

describe('V opens the scope menu (§12.91)', () => {
  const menu = () =>
    container!.querySelector('[role="menu"][aria-label="Lists and views"]');

  it('opens on V, and not while typing', async () => {
    await render(false);
    const search = container!.querySelector<HTMLInputElement>(
      'input[aria-label="Search the fleet"]',
    )!;
    await act(async () => {
      search.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true }));
    });
    expect(menu()).toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' }));
    });
    expect(menu()).not.toBeNull();
  });

  it('stands aside while a modal is open', async () => {
    await render(false);
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    try {
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'V' }));
      });
      expect(menu()).toBeNull();
    } finally {
      modal.remove();
    }
  });
});
