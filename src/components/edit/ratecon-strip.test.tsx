// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditStopModal } from './EditStopModal';
import { fleetRow, nextStop } from '@/test/fleet-row';
import { primeLoadRead } from '@/test/load-read';
import { LABEL_ROWS, PU_SO_PASTED } from '@/test/ratecon-fixtures';
import { linesFromRuns } from '@/lib/ratecon/lines';
import type { FleetResponse } from '@/hooks/useFleet';

/**
 * §12.122, in the modal: "Fill from rate confirmation", through the
 * pasted-text path (the PDF path needs a browser worker; e2e/ratecon-fill
 * drives it). Every document here is invented.
 */

const TZ = 'America/Chicago';
const NOW = new Date('2026-10-08T15:00:00.000Z');
const ahead = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

const ROW = fleetRow({
  nextStop: nextStop({
    type: 'PU',
    city: 'Joliet',
    state: 'IL',
    apptStartUtc: ahead(20),
    apptEndUtc: ahead(20.5),
    apptTz: TZ,
    apptType: 'APPT',
  }),
});
/** Saved in Mountain time, in a Central state: the stored zone is the answer. */
const DROP = {
  type: 'DEL' as const,
  city: 'Moorhead',
  state: 'MN',
  zip: '56560',
  apptStartUtc: ahead(30),
  apptEndUtc: ahead(30.5),
  apptTz: 'America/Denver',
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  })) as unknown as typeof fetch;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.useRealTimers();
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  });

const EMPTY = fleetRow({ nextStop: null, openLoadCount: 0 });

const render = async (row = EMPTY) => {
  primeLoadRead(client, row, { after: [DROP] });
  client.setQueryData<FleetResponse>(['fleet'], {
    fleet: [row],
    fetchedAt: NOW.toISOString(),
  } as FleetResponse);
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(EditStopModal, {
          row,
          drivers: [],
          role: 'admin',
          dispatchTz: TZ,
          onClose: vi.fn(),
          onReload: vi.fn(),
        }),
      ),
    );
  });
  await settle();
};

const rows = () => [...container!.querySelectorAll<HTMLElement>('[role="tab"]')];
const form = () => container!.querySelector<HTMLElement>('[role="tabpanel"]')!;
const labelled = (label: string) => {
  const match = [...form().querySelectorAll('label')].find((l) =>
    (l.textContent ?? '').trim().startsWith(label),
  );
  if (!match) throw new Error(`No field labelled ${label}`);
  return match;
};
const field = (label: string) => labelled(label).querySelector('input') as HTMLInputElement;
const zone = () => labelled('Facility time zone').querySelector('select') as HTMLSelectElement;
const type = (el: HTMLInputElement, text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const click = async (el: HTMLElement) => {
  await act(async () => el.click());
  await settle();
};
const button = (label: string) => {
  const found = [...document.querySelectorAll('button')].find(
    (b) => (b.textContent ?? '').trim() === label,
  );
  if (!found) throw new Error(`No button ${label}`);
  return found;
};
const postedZones = () =>
  (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls
    .filter(([url, init]) => url === '/api/stops' && init?.method === 'POST')
    .flatMap(([, init]) =>
      (JSON.parse(String(init!.body)) as { stops: { appointment: { tz: string } | null }[] }).stops,
    )
    .map((s) => s.appointment?.tz);

const banner = () =>
  [...container!.querySelectorAll('p')].find((p) => (p.textContent ?? '').startsWith('Unsaved changes'))
    ?.textContent;
const strip = () => container!.querySelector<HTMLElement>('[data-ratecon-strip]');
const said = () => strip()?.querySelector('[data-ratecon-said]')?.textContent ?? null;
const counts = () => strip()?.querySelector('[data-ratecon-counts]')?.textContent ?? '';
const loadNumber = () =>
  [...container!.querySelectorAll('label')].find((l) => (l.textContent ?? '').startsWith('Load number'))!.querySelector('input')!;

/** Text pasted into the strip, as the browser fires it. */
const pasteText = async (clip: string) => {
  const area = strip()!.querySelector('textarea')!;
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => clip } });
  await act(async () => {
    area.dispatchEvent(event);
  });
  await settle();
};

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('Fill from rate confirmation (§12.122)', () => {
  it('fills a new load from the text: load number, every stop in order, each field with its source', async () => {
    await render();
    await pasteText(PU_SO_PASTED);
    expect(said()).toBe('Filled 2 stops from PU / SO blocks (Name, Address, Date). Nothing is saved until Save.');
    expect(loadNumber().value).toBe('88123');
    expect(rows()).toHaveLength(2);
    expect([field('Street address').value, field('City').value, field('State').value, field('ZIP').value]).toEqual([
      '4001 Main St', 'FARGO', 'ND', '58102',
    ]);
    expect(labelled('City').querySelector('[data-field-source]')?.textContent).toBe(
      'From the pasted text: “FARGO ND 58102 Contact: Dock”',
    );
    expect(zone().value).toBe('America/Chicago');
    await click(rows()[1]!);
    expect(field('City').value).toBe('DICKINSON');
    expect(zone().value).toBe('America/Denver');
    expect(form().querySelector('[data-appointment-check]')?.textContent).toContain('filled as FCFS receiving hours');
    expect(strip()!.querySelector('[data-to-check]')?.textContent).toBe('1 field to check');
    expect(banner()).toContain('load number');
    expect(postedZones()).toEqual([]);
  });

  it('says "Layout not recognised, nothing filled", fills nothing, and counts it', async () => {
    await render();
    await pasteText('Dear carrier,\nPlease find the load attached.');
    expect(said()).toBe('Layout not recognised, nothing filled.');
    expect(loadNumber().value).toBe('');
    expect(rows()).toHaveLength(1);
    expect(counts()).toContain('1 not recognised');
  });

  it('counts a filled field edited by hand, and the field loses its source', async () => {
    await render();
    await pasteText(PU_SO_PASTED);
    await type(field('City'), 'West Fargo');
    expect(labelled('City').querySelector('[data-field-source]')).toBeNull();
    expect(JSON.parse(window.sessionStorage.getItem('ft.ratecon.counts') ?? '{}')).toMatchObject({ editedAfterFill: 1 });
  });

  it('is one line until something is given; opens to say what happened; folds when the load is typed into', async () => {
    await render();
    expect(strip()!.querySelector('[data-ratecon-line]')).not.toBeNull();
    expect(strip()!.querySelector('[data-ratecon-detail]')).toBeNull();
    expect(counts()).toBe('');

    await pasteText(PU_SO_PASTED);
    expect(strip()!.querySelector('[data-ratecon-detail]')).not.toBeNull();
    expect(counts()).toContain('This session:');

    await type(field('Street address'), '4001 Main Street');
    expect(strip()!.querySelector('[data-ratecon-detail]')).toBeNull();
    // What is left to check stays on the line itself.
    expect(strip()!.querySelector('[data-ratecon-line] [data-to-check]')?.textContent).toBe('1 field to check');
  });

  it('stays one line when a load is typed into without a fill', async () => {
    await render();
    await type(field('City'), 'Moorhead');
    expect(strip()!.querySelector('[data-ratecon-detail]')).toBeNull();
    expect(strip()!.querySelector('[data-to-check]')).toBeNull();
  });

  it('asks before replacing what was typed, and keeps it when told to', async () => {
    await render();
    await type(field('City'), 'Moorhead');
    await pasteText(PU_SO_PASTED);
    await click(button('Keep mine'));
    expect(field('City').value).toBe('Moorhead');
    await pasteText(PU_SO_PASTED);
    await click(button('Replace'));
    expect(field('City').value).toBe('FARGO');
  });

  it('keeps a 90-minute window as 90 minutes, though the menu does not list it', async () => {
    await render();
    const text = linesFromRuns(LABEL_ROWS.flatMap((runs, i) => runs.map((r) => ({ page: i + 1, ...r }))))
      .map((l) => l.text)
      .join('\n');
    await pasteText(text);
    await click(rows()[1]!);
    const windowSelect = [...form().querySelectorAll('select')].find((el) => el !== zone())!;
    expect(windowSelect.value).toBe('90');
    expect(form().querySelector('[data-appointment-check]')).toBeNull();
  });

  it('is never offered on a load with a saved stop', async () => {
    await render(ROW);
    expect(strip()).toBeNull();
  });
});
