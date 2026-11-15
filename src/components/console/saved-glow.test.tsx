// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fleetHealth, fleetRow, nextStop } from '@/test/fleet-row';
import { stubLayout } from '@/test/layout';
import { recordAnimations, reduceMotion } from '@/test/animations';
import { MOTION_MS, MOTION_SHAPE } from '@/design/tokens';
import type { FleetResponse } from '@/hooks/useFleet';

/**
 * Phase 3bw, QoL feature 6 (§12.163). The row a person just saved glows once: started by the
 * save's own named cause, never by a poll; nothing when the list does not show the row; the
 * flash wins; under reduced motion the static tag, as the flash has.
 *
 * The edit window is a stand-in here: its Save is the real window's clean close, `onSaved` then
 * `onClose` (`edit/saved-cause.test.tsx` holds the real window to calling them so). Its Cancel
 * only closes.
 */
vi.mock('./map/FleetMap', () => ({
  FleetMap: () => createElement('div', { 'data-testid': 'map' }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('@/app/actions/profile', () => ({ updateDisplayName: vi.fn() }));
vi.mock('@/app/login/actions', () => ({ signOut: vi.fn() }));
vi.mock('@/components/edit/EditStopModal', () => ({
  EditStopModal: (props: { row: { id: string }; onSaved?: (id: string) => void; onClose: () => void }) =>
    createElement(
      'div',
      { role: 'dialog', 'aria-modal': 'true' },
      createElement('button', { 'data-stub-save': '', onClick: () => { props.onSaved?.(props.row.id); props.onClose(); } }, 'Save'),
      createElement('button', { 'data-stub-cancel': '', onClick: () => props.onClose() }, 'Cancel'),
    ),
}));

const { Console } = await import('./Console');

const row = (n: number, status: 'LATE' | 'ON_TIME' | 'AT_RISK') =>
  fleetRow({
    id: `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    truckNumber: n,
    samsaraName: `Truck #${n}`,
    status,
    computed: status,
    nextStop: nextStop({ stopId: `${String(n).padStart(8, '0')}-0000-4000-8000-000000000001` }),
  });
const A = row(101, 'LATE');
const B = row(202, 'LATE');
const C = row(303, 'ON_TIME');

const answer = (fleet: FleetResponse['fleet']): FleetResponse => ({
  fleet,
  fetchedAt: '2026-09-18T12:00:00.000Z',
  feedStale: false,
  feedNewestAt: '2026-09-18T12:00:00.000Z',
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;
let restoreLayout: () => void = () => {};
let recorder: ReturnType<typeof recordAnimations>;
let unreduce: (() => void) | null = null;

beforeEach(() => {
  restoreLayout = stubLayout({ width: 1100, height: 600 });
  recorder = recordAnimations();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  restoreLayout();
  recorder.restore();
  unreduce?.();
  unreduce = null;
});

const render = async (fleet = [A, B, C], initialChips: string[] = []) => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(Console, {
          initial: answer(fleet),
          initialHealth: fleetHealth(),
          dispatchTz: 'America/Chicago',
          user: { fullName: 'Sam Leasar', email: 's@x.test', role: 'admin' as const },
          initialQuery: '',
          initialTruck: null,
          initialChips,
          drivers: [],
          role: 'admin' as const,
        }),
      ),
    );
  });
};

const frames = () =>
  act(async () => {
    for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  });
const poll = async (fleet: FleetResponse['fleet']) => {
  await act(async () => {
    client.setQueryData(['fleet'], answer(fleet));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await frames();
};
const rowEl = (n: number) =>
  [...container!.querySelectorAll<HTMLElement>('[role="row"][tabindex]')].find((el) => (el.textContent ?? '').includes(String(n)));
const openEditor = async (n: number) => {
  await act(async () => rowEl(n)!.click());
  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
};
const stub = (which: 'save' | 'cancel') => document.querySelector<HTMLButtonElement>(`[data-stub-${which}]`)!;
const saveIn = async (n: number) => {
  await openEditor(n);
  await act(async () => stub('save').click());
  await frames();
};
const glows = () => recorder.played.filter((p) => p.el.hasAttribute('data-saved-glow'));

describe('the saved row glows once (QoL 6)', () => {
  it('Save glows the saved row once, at the demo\'s values: opacity only, linear, its peak a quarter in', async () => {
    await render();
    await saveIn(101);
    expect(glows()).toHaveLength(1);
    const glow = glows()[0]!;
    expect(rowEl(101)!.contains(glow.el)).toBe(true);
    expect(glow.options).toMatchObject({ duration: MOTION_MS.savedGlow, easing: 'linear' });
    expect(MOTION_MS.savedGlow).toBe(1000);
    expect(glow.keyframes).toEqual([{ opacity: 0 }, { opacity: MOTION_SHAPE.savedGlowPeak, offset: 0.25 }, { opacity: 0 }]);
    expect(MOTION_SHAPE.savedGlowPeak).toBe(0.3);
    expect(glow.el.className).toContain('pointer-events-none');
  });

  it('nothing is left when it lands: no glow, no style', async () => {
    await render();
    await saveIn(101);
    recorder.finishAll();
    expect(rowEl(101)!.querySelector('[data-saved-glow]')).toBeNull();
  });

  it('a poll never glows: not before a save, not after one, not one that changes the row', async () => {
    await render();
    await poll([A, B, C]);
    expect(glows()).toHaveLength(0);
    await saveIn(101);
    await poll([{ ...A, driverName: 'Someone Else' }, B, C]);
    await poll([{ ...A, driverName: 'Someone Else' }, B, C]);
    expect(glows()).toHaveLength(1);
  });

  it('closing without a save glows nothing', async () => {
    await render();
    await openEditor(101);
    await act(async () => stub('cancel').click());
    await frames();
    expect(glows()).toHaveLength(0);
  });

  it('a second save glows again: each save is its own cause', async () => {
    await render();
    await saveIn(101);
    await saveIn(202);
    expect(glows()).toHaveLength(2);
    expect(rowEl(202)!.contains(glows()[1]!.el)).toBe(true);
  });

  it('a row the list does not show: no glow, and nothing in its place', async () => {
    await render([A, B, C], ['late']);
    await openEditor(101);
    // While the window is open a poll takes 101 out of the Late chip.
    await poll([{ ...A, status: 'ON_TIME', computed: 'ON_TIME' }, B, C]);
    expect(rowEl(101)).toBeUndefined();
    await act(async () => stub('save').click());
    await frames();
    expect(glows()).toHaveLength(0);
    expect(container!.querySelector('[data-saved-tag]')).toBeNull();
  });

  it('the flash wins: a status changed with the save flashes, and the row does not glow as well', async () => {
    await render();
    await openEditor(101);
    await poll([{ ...A, status: 'AT_RISK', computed: 'AT_RISK' }, B, C]);
    await act(async () => stub('save').click());
    await frames();
    expect(glows()).toHaveLength(0);
  });

  it('the flash wins: a flash landing on a glowing row takes the glow away', async () => {
    await render();
    await saveIn(101);
    expect(rowEl(101)!.querySelector('[data-saved-glow]')).not.toBeNull();
    await poll([{ ...A, status: 'AT_RISK', computed: 'AT_RISK' }, B, C]);
    expect(rowEl(101)!.querySelector('[data-saved-glow]')).toBeNull();
  });

  it('under reduced motion nothing plays, and the row carries the static tag, as the flash does', async () => {
    unreduce = reduceMotion();
    await render();
    await saveIn(101);
    expect(glows()).toHaveLength(0);
    expect(rowEl(101)!.querySelector('[data-saved-tag]')?.textContent).toBe('◆ saved');
  });
});
