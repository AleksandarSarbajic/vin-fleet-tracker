// @vitest-environment happy-dom
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EDIT_MIN_WIDTH_PX } from '@/lib/editing';
import { PHONE_BELOW_PX, PHONE_MEDIA } from '@/lib/phone';
import tailwindConfig from '../../../../tailwind.config';
import defaultTheme from 'tailwindcss/defaultTheme';

/**
 * §12.96, stage 1. The phone's feed line, and the one rule it exists for:
 * while the board refetches after a return from the background it says
 * "Updating…" and shows no age, because the age it would show was worked out
 * against a clock the phone had frozen.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('@/app/actions/profile', () => ({ updateDisplayName: vi.fn() }));
vi.mock('@/app/login/actions', () => ({ signOut: vi.fn() }));

const { PhoneTopBar } = await import('./PhoneTopBar');

const FETCHED = '2026-09-18T12:00:00.000Z';
const NEWEST = '2026-09-18T11:35:00.000Z';

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  // Three seconds after the fetch, and 25 minutes after the newest position.
  vi.setSystemTime(new Date('2026-09-18T12:00:03.000Z'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const render = (props: { feedStale?: boolean; updating?: boolean; query?: string }) =>
  act(() => {
    root.render(
      createElement(PhoneTopBar, {
        query: props.query ?? '',
        onQueryChange: () => {},
        matchCount: 1,
        totalCount: 1,
        fetchedAt: FETCHED,
        feedNewestAt: NEWEST,
        feedStale: props.feedStale ?? false,
        updating: props.updating ?? false,
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
        scope: { count: 15, fleetCount: 15, viewCount: () => 0, onClear: () => {} },
      }),
    );
  });

const feed = () => container.querySelector('[data-phone-feed]')!.textContent ?? '';

describe('the feed line', () => {
  it('healthy: the age of the last fetch', () => {
    render({});
    expect(feed()).toContain('3s ago');
    expect(container.querySelector('[data-updating]')).toBeNull();
  });

  it('down: "Feed down" and how long', () => {
    render({ feedStale: true });
    expect(feed()).toContain('Feed down 25m');
  });

  it('updating: the marker, and no age at all — healthy or down', () => {
    render({ updating: true });
    expect(container.querySelector('[data-updating]')?.textContent).toBe('Updating…');
    expect(feed()).not.toMatch(/\d+\s?[smhd]\b/);
    render({ updating: true, feedStale: true });
    expect(feed()).toContain('Feed down');
    expect(feed()).not.toMatch(/\d+\s?[smhd]\b/);
  });
});

describe('the bar', () => {
  it('handles no keys: no listener for /, V or a digit is added', () => {
    const added = vi.spyOn(window, 'addEventListener');
    const addedDoc = vi.spyOn(document, 'addEventListener');
    render({});
    const keys = [...added.mock.calls, ...addedDoc.mock.calls].filter(([type]) =>
      String(type).startsWith('key'),
    );
    expect(keys).toEqual([]);
  });

  it('a link that carries a search opens with the field showing it', () => {
    render({ query: 'chicago' });
    const field = container.querySelector<HTMLInputElement>(
      '[data-phone-topbar] input[type="search"]',
    );
    expect(field?.value).toBe('chicago');
  });
});

describe('one width decides it', () => {
  it("the phone is below Tailwind's md, which is the editing width", () => {
    const screens = (
      tailwindConfig.theme?.extend as { screens?: Record<string, string> } | undefined
    )?.screens;
    expect(screens?.['md']).toBeUndefined();
    expect(defaultTheme.screens.md).toBe(`${PHONE_BELOW_PX}px`);
    expect(PHONE_BELOW_PX).toBe(EDIT_MIN_WIDTH_PX);
    expect(PHONE_MEDIA).toBe('(max-width: 767px)');
  });
});
