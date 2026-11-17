// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/roles';
import type { PastAddress } from '@/lib/past-address';
import { EditStopModal } from './EditStopModal';
import { SUGGESTIONS_UNAVAILABLE } from './AddressSuggest';
import { fleetRow } from '@/test/fleet-row';
import type { FleetResponse } from '@/hooks/useFleet';

/**
 * Phase 3bx, QoL 2 (§12.164). Street address suggests from the company's own past stops, in the
 * real edit window: fetched once per window and filtered here; arrows, Enter or the mouse pick;
 * a pick fills street, city, state and ZIP through the same patch typing sends, so on a new
 * stop whose zone is `auto` the zone follows it, and the date and time do not move; the typed
 * text stays until a pick; Esc closes the list and keeps the text and the window; Tab leaves; a
 * failed read leaves a plain field that says so. A viewer is not asked.
 */

const TZ = 'America/Chicago';
const NOW = new Date('2026-10-08T15:00:00.000Z');
const NEW_LOAD = fleetRow({ nextStop: null, openLoadCount: 0 });
const PAST: PastAddress[] = [
  { addressLine: '1200 Mill Rd', city: 'Bolingbrook', state: 'IL', zip: '60440', uses: 14, lastUsedAt: '2026-10-07T12:00:00.000Z' },
  { addressLine: '45 Millbrook Ave', city: 'Albany', state: 'NY', zip: '12205', uses: 6, lastUsedAt: '2026-10-06T12:00:00.000Z' },
  { addressLine: '77 Depot St', city: 'Tulsa', state: 'OK', zip: '74103', uses: 11, lastUsedAt: '2026-10-05T12:00:00.000Z' },
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let onClose: ReturnType<typeof vi.fn>;
let answer: 'ok' | 'fail' = 'ok';
const asked = () => vi.mocked(globalThis.fetch).mock.calls.filter(([url]) => String(url) === '/api/stops/addresses').length;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  window.sessionStorage.clear();
  answer = 'ok';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/stops/addresses') {
      return answer === 'ok'
        ? new Response(JSON.stringify({ addresses: PAST }), { status: 200 })
        : new Response(JSON.stringify({ error: 'Past addresses could not be read.', reference: 'ADDRESSES-500-X' }), { status: 500 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.useRealTimers();
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));
  });

const render = async (role: Role = 'dispatcher') => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData<FleetResponse>(['fleet'], { fleet: [NEW_LOAD], fetchedAt: NOW.toISOString() } as FleetResponse);
  onClose = vi.fn();
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(EditStopModal, { row: NEW_LOAD, drivers: [], role, dispatchTz: TZ, onClose, onReload: vi.fn() }),
      ),
    );
  });
  await settle();
};

const fieldOf = (fill: string) => container!.querySelector<HTMLInputElement>(`[data-fill="${fill}"]`)!;
const street = () => fieldOf('addressLine');
const type = async (el: HTMLInputElement, text: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
};
const key = async (k: string, target: Element = street()) => {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  await act(async () => {
    target.dispatchEvent(event);
  });
  await settle();
  return event;
};
const options = () => [...container!.querySelectorAll<HTMLElement>('[data-address-option]')];
const optionTexts = () => options().map((o) => o.textContent);
const tz = () => container!.querySelector<HTMLSelectElement>('select[data-fill="tz"]')?.value ?? null;

describe('Street address suggests from past stops (QoL 2)', () => {
  it('typing shows the matches, marked, as a combobox the field controls; under two characters nothing', async () => {
    await render();
    await type(street(), 'm');
    expect(options()).toHaveLength(0);
    expect(street().getAttribute('aria-expanded')).toBe('false');
    await type(street(), 'mill');
    expect(optionTexts()).toEqual(['1200 Mill RdBolingbrook, IL 60440', '45 Millbrook AveAlbany, NY 12205']);
    expect(street().getAttribute('role')).toBe('combobox');
    expect(street().getAttribute('aria-expanded')).toBe('true');
    expect(street().getAttribute('autocomplete')).toBe('off');
    const list = container!.querySelector('[role="listbox"]')!;
    expect(street().getAttribute('aria-controls')).toBe(list.id);
    expect(list.querySelector('.bg-highlight')?.textContent).toBe('Mill');
  });

  it('arrows move through them without writing into the field; Enter picks, filling street, city, state and ZIP', async () => {
    await render();
    await type(street(), 'mill');
    await key('ArrowDown');
    await key('ArrowDown');
    expect(street().value).toBe('mill');
    expect(street().getAttribute('aria-activedescendant')).toBe(options()[1]!.id);
    expect(options()[1]!.getAttribute('aria-selected')).toBe('true');
    const enter = await key('Enter');
    expect(enter.defaultPrevented).toBe(true);
    expect(street().value).toBe('45 Millbrook Ave');
    expect(fieldOf('city').value).toBe('Albany');
    expect(fieldOf('state').value).toBe('NY');
    expect(fieldOf('zip').value).toBe('12205');
    expect(options()).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a click picks too, and the press does not take the focus out of the field first', async () => {
    await render();
    street().focus();
    await type(street(), 'depot');
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    await act(async () => {
      options()[0]!.dispatchEvent(down);
    });
    expect(down.defaultPrevented).toBe(true);
    await act(async () => options()[0]!.click());
    await settle();
    expect(street().value).toBe('77 Depot St');
    expect(fieldOf('city').value).toBe('Tulsa');
  });

  it('a pick goes through the zone rule: on a new stop whose zone is auto it follows, and the date and time stay', async () => {
    await render();
    const enable = container!.querySelector<HTMLInputElement>('[data-fill="appointment.enabled"] input, input[data-fill="appointment.enabled"]');
    if (enable && !enable.checked) await act(async () => enable.click());
    await settle();
    await type(fieldOf('appointment.date'), '2026-10-12');
    await type(fieldOf('appointment.time'), '08:30');
    const before = tz();
    expect(before).toBe(TZ);
    await type(street(), 'millbrook');
    await key('ArrowDown');
    await key('Enter');
    expect(fieldOf('state').value).toBe('NY');
    expect(tz()).toBe('America/New_York');
    expect(fieldOf('appointment.date').value).toBe('2026-10-12');
    expect(fieldOf('appointment.time').value).toBe('08:30');
  });

  it('Esc closes the list and keeps the text, and only the list: the window stays, nothing asks to discard', async () => {
    await render();
    await type(street(), 'mill');
    expect(options()).toHaveLength(2);
    const esc = await key('Escape');
    expect(esc.defaultPrevented).toBe(true);
    expect(options()).toHaveLength(0);
    expect(street().value).toBe('mill');
    expect(onClose).not.toHaveBeenCalled();
    expect(container!.textContent).not.toContain('Discard');
    // The next Esc, with the list closed, is the window's again: it asks, as typed work is there.
    await key('Escape');
    expect(document.body.textContent).toContain('Discard');
  });

  it('Tab leaves and closes the list; the typed text is free text, kept as typed', async () => {
    await render();
    await type(street(), 'mill');
    const tab = await key('Tab');
    expect(tab.defaultPrevented).toBe(false);
    expect(options()).toHaveLength(0);
    expect(street().value).toBe('mill');
    await type(street(), '9 Nowhere Lane');
    expect(options()).toHaveLength(0);
    expect(street().value).toBe('9 Nowhere Lane');
  });

  it('fetched once per window, however much is typed', async () => {
    await render();
    await type(street(), 'mi');
    await type(street(), 'mil');
    await type(street(), 'mill');
    await type(street(), 'depot');
    expect(asked()).toBe(1);
  });

  it('when the read fails, the field is plain text and says suggestions are unavailable', async () => {
    answer = 'fail';
    await render();
    expect(container!.textContent).toContain(SUGGESTIONS_UNAVAILABLE);
    await type(street(), 'mill');
    expect(options()).toHaveLength(0);
    expect(street().value).toBe('mill');
  });

  it('a viewer is not asked: the route would refuse, and the field is theirs to read only', async () => {
    await render('viewer');
    expect(asked()).toBe(0);
    expect(street().disabled || street().closest('fieldset')?.disabled).toBe(true);
  });
});
