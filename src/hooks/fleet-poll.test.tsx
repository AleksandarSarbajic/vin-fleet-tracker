// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FLEET_HIDDEN_POLL_MS, FLEET_POLL_MS, fleetPollInterval, useFleet, type FleetResponse } from './useFleet';
import { usePageVisible } from './usePageVisible';
import { useResumeRefetch } from './useResumeRefetch';

/**
 * Phase 3bx, QoL 5 (§12.164). A hidden tab polls about once a minute (Alex, 2026-11-15); the
 * visible rate stays `FLEET_POLL_MS`; coming back polls once, not twice (the focus refetch and
 * the resume refetch join). The console's own three hooks, on React Query's real timers, run on
 * a fake clock. The browser's own throttling of a hidden tab is not here (HANDOFF 3bx measured
 * a real hidden tab apart).
 */

let visibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
Object.defineProperty(document, 'hidden', { configurable: true, get: () => visibility === 'hidden' });

const INITIAL: FleetResponse = { fleet: [], fetchedAt: '2026-09-18T12:00:00.000Z', feedStale: false, feedNewestAt: null };

/** What the console wires: the page's visibility (which re-renders it), the fleet, the resume. */
function Board() {
  usePageVisible();
  const { refetch } = useFleet(INITIAL);
  useResumeRefetch(refetch);
  return null;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let polls: number[] = [];
let wide = true;
const realMatchMedia = window.matchMedia;

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  wide = true;
  window.matchMedia = ((query: string) => {
    const list = realMatchMedia.call(window, query);
    Object.defineProperty(list, 'matches', { get: () => wide });
    return list;
  }) as typeof window.matchMedia;
  polls = [];
  globalThis.fetch = vi.fn(async () => {
    polls.push(Date.now());
    return new Response(JSON.stringify(INITIAL), { status: 200 });
  }) as unknown as typeof fetch;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  window.matchMedia = realMatchMedia;
  vi.useRealTimers();
});

const mount = async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root!.render(createElement(QueryClientProvider, { client }, createElement(Board)));
  });
};
const setVisibility = async (next: DocumentVisibilityState) => {
  visibility = next;
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('visibilitychange'));
  });
};
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe('the fleet poll (QoL 5)', () => {
  it('the interval: the visible rate, the hidden rate, and none on a hidden phone', () => {
    expect(fleetPollInterval()).toBe(FLEET_POLL_MS);
    visibility = 'hidden';
    expect(fleetPollInterval()).toBe(FLEET_HIDDEN_POLL_MS);
    wide = false;
    expect(fleetPollInterval()).toBe(false);
    visibility = 'visible';
    expect(fleetPollInterval()).toBe(FLEET_POLL_MS);
  });

  it('visible, every 20s, as before', async () => {
    await mount();
    await advance(100_000);
    expect(polls).toHaveLength(5);
  });

  it('hidden, about once a minute: five in five minutes, where the visible rate would ask fifteen', async () => {
    await mount();
    await setVisibility('hidden');
    await advance(5 * 60_000 + 500);
    expect(polls).toHaveLength(5);
    const gaps = polls.slice(1).map((t, i) => t - polls[i]!);
    expect(gaps.every((g) => g === FLEET_HIDDEN_POLL_MS)).toBe(true);
  });

  it('back from a hidden tab: one request at once, not two, and the visible rate again after it', async () => {
    await mount();
    await setVisibility('hidden');
    await advance(150_000);
    expect(polls).toHaveLength(2);
    await setVisibility('visible');
    await advance(50);
    expect(polls).toHaveLength(3);
    await advance(FLEET_POLL_MS * 2);
    expect(polls).toHaveLength(5);
  });

  it('below the editing width a hidden tab stops, as it always did, and asks once on return', async () => {
    wide = false;
    await mount();
    await setVisibility('hidden');
    await advance(5 * 60_000);
    expect(polls).toHaveLength(0);
    await setVisibility('visible');
    await advance(50);
    expect(polls).toHaveLength(1);
  });
});
