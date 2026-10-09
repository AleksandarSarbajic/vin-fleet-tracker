// @vitest-environment happy-dom
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PollHealth } from '@/lib/sync-state';
import { HeaderSync } from './HeaderStatus';

/**
 * §12.123. The header when the board stops hearing from us: amber "Not
 * updating", or — with the feed already down — the red block kept and the
 * amber line under it; Retry asks now, except while a 429 asked us to wait.
 * The healthy header is not touched.
 */

const NOW = new Date('2026-10-09T12:00:00.000Z');
const FETCHED = '2026-10-09T11:58:00.000Z';
const NEWEST = '2026-10-09T11:35:00.000Z';

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const poll = (over: Partial<PollHealth> = {}): PollHealth => ({
  lastSuccessAt: NOW.getTime() - 2 * 60_000,
  visible: true,
  visibleSince: null,
  retrying: false,
  retryBlockedUntil: null,
  onRetry: vi.fn(),
  ...over,
});

const render = (props: { feedStale?: boolean; poll?: PollHealth }) =>
  act(() => {
    root.render(
      createElement(HeaderSync, {
        now: NOW,
        fetchedAt: FETCHED,
        feedNewestAt: NEWEST,
        feedStale: props.feedStale ?? false,
        dispatchTz: 'America/Chicago',
        ...(props.poll ? { poll: props.poll } : {}),
      }),
    );
  });

const q = (selector: string) => container.querySelector<HTMLElement>(selector);

describe('Not updating (§12.123)', () => {
  it('is amber, with how long since the last update, and Retry', () => {
    render({ poll: poll() });
    expect(q('[data-sync-stopped] [data-not-updating]')?.textContent).toBe('Not updating 2m');
    expect(q('[data-sync-retry]')?.textContent).toBe('Retry');
    expect(q('[data-feed-announce]')?.textContent).toBe('Not updating. Last update 2m ago.');
    // Not the green dot, and not the red block.
    expect(q('[data-sync-visible]')).toBeNull();
    expect(q('[data-feed-down]')).toBeNull();
  });

  it('keeps the red block when the feed was down, with the amber line under it', () => {
    render({ feedStale: true, poll: poll() });
    const block = q('[data-feed-down]')!;
    const lines = [...block.querySelectorAll('[data-sync-label] > span')].map((s) => s.textContent);
    expect(lines).toEqual(['Last sync 06:35 · 25m ago', 'Not updating 2m']);
    expect(q('[data-feed-announce]')?.textContent).toBe('Feed down. Last sync 06:35. Not updating. Last update 2m ago.');
  });

  it('Retry asks now', () => {
    const p = poll();
    render({ poll: p });
    act(() => q('[data-sync-retry]')!.click());
    expect(p.onRetry).toHaveBeenCalledTimes(1);
  });

  it('says Retrying… while a request is out', () => {
    render({ poll: poll({ retrying: true }) });
    expect(q('[data-sync-retry]')?.textContent).toBe('Retrying…');
  });

  it('waits as long as a 429 asked', () => {
    render({ poll: poll({ retryBlockedUntil: NOW.getTime() + 12_000 }) });
    const retry = q('[data-sync-retry]') as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    expect(retry.textContent).toBe('Wait 12s');
  });

  it('is not shown within a minute, or while the tab is hidden', () => {
    render({ poll: poll({ lastSuccessAt: NOW.getTime() - 30_000 }) });
    expect(q('[data-not-updating]')).toBeNull();
    expect(q('[data-sync-visible]')).not.toBeNull();
    render({ poll: poll({ visible: false }) });
    expect(q('[data-not-updating]')).toBeNull();
  });

  it('leaves the healthy header exactly as it was without one', () => {
    render({});
    const without = container.innerHTML;
    render({ poll: poll({ lastSuccessAt: NOW.getTime() - 5_000 }) });
    expect(container.innerHTML).toBe(without);
  });
});
