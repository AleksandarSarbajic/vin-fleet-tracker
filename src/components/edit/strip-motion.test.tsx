// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditStopModal } from './EditStopModal';
import { Field } from './Field';
import { fleetRow } from '@/test/fleet-row';
import { loadReadFor, primeLoadRead } from '@/test/load-read';
import { recordAnimations, reduceMotion, type Played } from '@/test/animations';
import type { FleetRow, NextStop } from '@/server/fleet-query';
import type { FleetResponse } from '@/hooks/useFleet';

/**
 * §12.152, the edit window's four small motions: a field's message, "Unsaved changes",
 * "Saved · one thing to know" and the rate confirmation strip. Each starts on its cause,
 * at its own length written out, and on nothing else: not a re-render with the same words,
 * not a remount, not a status that changes inside it. Every value is invented.
 */

const TZ = 'America/Chicago';
const NOW = new Date('2026-10-19T15:00:00.000Z');
const LOAD = '33333333-3333-4333-8333-0000000003b1';
const STOP = '22222222-2222-4222-8222-0000000003b1';
const OPENED = 'a'.repeat(32);
const RETURNED = 'b'.repeat(32);
const WARNING = 'This address could not be located, so the stop has no ETA.';
const DIGITS = 'ZIP must be digits only, like 60601 or 60601-1234.';

const truck = { truckNumber: 905, samsaraName: 'Truck #905' };
const stop = (over: Partial<NextStop> = {}): Partial<NextStop> => ({
  loadId: LOAD,
  stopId: STOP,
  loadVersion: OPENED,
  loadNumber: 'VT-3BJ-1',
  addressLine: '12 Pier Rd',
  city: 'Duluth',
  state: 'MN',
  zip: '55802',
  ...over,
});
const EXISTING = fleetRow({ ...truck, nextStop: stop() });
const EMPTY = fleetRow({ ...truck, nextStop: null, openLoadCount: 0 });

const DROP_14 = {
  keyframes: [
    { opacity: 0, translate: '0 -14px' },
    { opacity: 1, translate: '0 0' },
  ],
  duration: 270,
  easing: 'cubic-bezier(.22,.61,.36,1)',
};
const shape = (p: Played) => ({ keyframes: p.keyframes, ...p.options });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;
let recorder: ReturnType<typeof recordAnimations>;
let unreduce: (() => void) | null = null;
let saves: (() => Response)[];
let reads: (() => Promise<Response> | Response)[];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const landed = (warnings: { field: string; message: string }[]) =>
  json(200, { saveId: '44444444-4444-4444-8444-0000000003b1', loadId: LOAD, loadVersion: RETURNED, stops: [], reassignment: null, warnings });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  recorder = recordAnimations();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  saves = [() => landed([])];
  reads = [() => json(404, { error: 'That load does not exist.' })];
  globalThis.fetch = vi.fn(async (url: string) => {
    if (url === '/api/stops') return saves.length > 1 ? saves.shift()!() : saves[0]!();
    if (url === `/api/loads/${LOAD}`) return reads.length > 1 ? reads.shift()!() : reads[0]!();
    if (url.startsWith('/api/stops/reopen')) return json(200, { loads: [] });
    return json(200, { ok: true });
  }) as unknown as typeof fetch;
  window.sessionStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  recorder.restore();
  unreduce?.();
  unreduce = null;
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
  });

const renderModal = async (row: FleetRow) => {
  primeLoadRead(client, row);
  client.setQueryData<FleetResponse>(['fleet'], { fleet: [row], fetchedAt: NOW.toISOString() } as FleetResponse);
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(EditStopModal, { row, drivers: [], role: 'admin', dispatchTz: TZ, onClose: vi.fn(), onReload: vi.fn() }),
      ),
    );
  });
  await settle();
};

const form = () => container!.querySelector<HTMLElement>('[role="tabpanel"]')!;
const field = (label: string): HTMLInputElement => {
  const match = [...form().querySelectorAll('label')].find((l) => (l.textContent ?? '').trim().startsWith(label));
  const input = match?.querySelector('input');
  if (!input) throw new Error(`No field labelled ${label}`);
  return input as HTMLInputElement;
};
const button = (label: string) =>
  [...container!.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement;
const type = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
};
const byText = (selector: string, words: string) =>
  [...container!.querySelectorAll(selector)].find((el) => (el.textContent ?? '').includes(words)) ?? null;
const on = (el: Element | null) => recorder.played.filter((p) => p.el === el);

describe('invalid: a field’s message', () => {
  const renderField = (error?: string) =>
    act(() => {
      root!.render(createElement(Field, { label: 'ZIP', value: '', onChange: () => {}, error }));
    });
  const message = () => container!.querySelector('label > span.text-status-late-fg');

  it('a new message drops in under its field, 14px in 270ms', () => {
    renderField();
    renderField(DIGITS);
    expect(on(message()).map(shape)).toEqual([DROP_14]);
  });

  it('a re-render with the same message plays nothing', () => {
    renderField();
    renderField(DIGITS);
    renderField(DIGITS);
    renderField(DIGITS);
    expect(recorder.played).toHaveLength(1);
  });

  it('other words are a new message: it drops again', () => {
    renderField();
    renderField(DIGITS);
    renderField('Enter a ZIP.');
    expect(recorder.played).toHaveLength(2);
    expect(recorder.played[1]!.el).toBe(message());
  });

  it('mounting with a message, as choosing another stop does, plays nothing', () => {
    renderField(DIGITS);
    expect(message()).not.toBeNull();
    expect(recorder.played).toEqual([]);
  });

  it('gone and back is new again', () => {
    renderField();
    renderField(DIGITS);
    renderField();
    renderField(DIGITS);
    expect(recorder.played).toHaveLength(2);
  });

  it('in the window: typed into ZIP, the message drops; typing on with the same message plays nothing more', async () => {
    await renderModal(EXISTING);
    await type(field('ZIP'), '5580x');
    const said = byText('span', DIGITS);
    expect(said).not.toBeNull();
    expect(on(said).map(shape)).toEqual([DROP_14]);
    await type(field('ZIP'), '5580xy');
    expect(on(byText('span', DIGITS))).toHaveLength(1);
  });

  it('under reduced motion the message is there and nothing starts', () => {
    unreduce = reduceMotion();
    renderField();
    renderField(DIGITS);
    expect(message()).not.toBeNull();
    expect(recorder.played).toEqual([]);
  });
});

describe('unsaved: "Unsaved changes"', () => {
  const strip = () => byText('p', 'Unsaved changes');

  it('the first change: it drops in, 14px in 270ms', async () => {
    await renderModal(EXISTING);
    await type(field('ZIP'), '55803');
    expect(strip()).not.toBeNull();
    expect(on(strip()).map(shape)).toEqual([DROP_14]);
  });

  it('more changes, which change its words: nothing more', async () => {
    await renderModal(EXISTING);
    await type(field('ZIP'), '55803');
    await type(field('City'), 'Superior');
    expect(strip()?.textContent).toContain('Unsaved changes');
    expect(on(strip())).toHaveLength(1);
  });

  it('opening the window plays none of the strips', async () => {
    await renderModal(EXISTING);
    expect(recorder.played).toEqual([]);
  });

  it('under reduced motion it is simply there', async () => {
    unreduce = reduceMotion();
    await renderModal(EXISTING);
    await type(field('ZIP'), '55803');
    expect(strip()).not.toBeNull();
    expect(recorder.played).toEqual([]);
  });
});

describe('saved: "Saved · one thing to know"', () => {
  const strip = () => byText('p', 'Saved · one thing to know')?.parentElement ?? null;
  /** The saved load's read, held until the test lets it land, as a network would. */
  const holdTheRead = () => {
    let land: () => void = () => {};
    reads = [
      () =>
        new Promise<Response>((resolve) => {
          land = () =>
            resolve(json(200, loadReadFor(fleetRow({ ...truck, nextStop: stop({ loadVersion: RETURNED, zip: '55803' }) }))));
        }),
    ];
    return () => land();
  };

  it('a save that landed with a warning: it drops in, 14px in 270ms, and the editor opened on the save carries it on', async () => {
    let clock = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    saves = [() => landed([{ field: 'stops.0.addressLine', message: WARNING }])];
    const landRead = holdTheRead();
    await renderModal(EXISTING);
    await type(field('ZIP'), '55803');
    const before = recorder.played.length;
    await act(async () => button('Save').click());
    await settle();

    // In the editor the save was made in, before its load is read again.
    const first = recorder.played.slice(before).filter((p) => p.el === strip());
    expect(first.map(shape)).toEqual([DROP_14]);
    expect(first[0]!.animation.currentTime).toBe(0);

    // The read lands 100ms later and the editor opens afresh on it (§12.127).
    clock = 1_100;
    await act(async () => landRead());
    await settle();
    const carried = recorder.played.slice(before).filter((p) => p.el === strip());
    expect(carried).toHaveLength(1);
    expect(carried[0]!.el).not.toBe(first[0]!.el);
    expect(shape(carried[0]!)).toEqual(DROP_14);
    expect(carried[0]!.animation.currentTime).toBe(100);
  });

  it('a read that lands after the drop is over: the new editor plays nothing', async () => {
    let clock = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    saves = [() => landed([{ field: 'stops.0.addressLine', message: WARNING }])];
    const landRead = holdTheRead();
    await renderModal(EXISTING);
    await type(field('ZIP'), '55803');
    await act(async () => button('Save').click());
    await settle();
    const first = recorder.played.length;
    clock = 1_270;
    await act(async () => landRead());
    await settle();
    expect(strip()).not.toBeNull();
    expect(recorder.played.slice(first).filter((p) => p.el === strip())).toEqual([]);
  });

  it('under reduced motion it is simply there', async () => {
    unreduce = reduceMotion();
    saves = [() => landed([{ field: 'stops.0.addressLine', message: WARNING }])];
    const landRead = holdTheRead();
    await renderModal(EXISTING);
    await type(field('ZIP'), '55803');
    await act(async () => button('Save').click());
    await settle();
    await act(async () => landRead());
    await settle();
    expect(strip()).not.toBeNull();
    expect(recorder.played).toEqual([]);
  });
});

describe('ratecon: the rate confirmation strip', () => {
  const detail = () => container!.querySelector('[data-ratecon-detail]');
  const paste = async (clip: string) => {
    const area = container!.querySelector('[data-ratecon-strip] textarea')!;
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => clip } });
    await act(async () => {
      area.dispatchEvent(event);
    });
    await settle();
  };

  it('given text: what it says drops in once, 14px in 270ms', async () => {
    await renderModal(EMPTY);
    await paste('Dear carrier,\nPlease find the load attached.');
    expect(detail()?.textContent).toContain('Layout not recognised');
    expect(on(detail()).map(shape)).toEqual([DROP_14]);
  });

  it('what it says changes inside it, on a second paste: nothing more', async () => {
    await renderModal(EMPTY);
    await paste('Dear carrier,\nPlease find the load attached.');
    await paste('Another note with no load in it.');
    expect(detail()).not.toBeNull();
    expect(recorder.played.filter((p) => p.el === detail())).toHaveLength(1);
  });

  it('opening the window, with the strip closed, plays nothing', async () => {
    await renderModal(EMPTY);
    expect(container!.querySelector('[data-ratecon-strip]')).not.toBeNull();
    expect(recorder.played).toEqual([]);
  });

  it('under reduced motion it is simply there', async () => {
    unreduce = reduceMotion();
    await renderModal(EMPTY);
    await paste('Dear carrier,\nPlease find the load attached.');
    expect(detail()).not.toBeNull();
    expect(recorder.played).toEqual([]);
  });
});
