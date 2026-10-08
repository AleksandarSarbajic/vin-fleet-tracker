// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditStopModal } from './EditStopModal';
import { fleetRow, nextStop } from '@/test/fleet-row';
import { primeLoadRead } from '@/test/load-read';
import type { FleetResponse } from '@/hooks/useFleet';

/**
 * §12.121, in the modal: an address pasted into Street. Every address here
 * is invented. A paste fills, a single plain line goes in as pasted, nothing
 * the dispatcher typed is overwritten, ⌘/Ctrl+Z undoes it in one step, and
 * the zone follows as typing makes it (§12.120).
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

const render = async () => {
  primeLoadRead(client, ROW, { after: [DROP] });
  client.setQueryData<FleetResponse>(['fleet'], {
    fleet: [ROW],
    fetchedAt: NOW.toISOString(),
  } as FleetResponse);
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(EditStopModal, {
          row: ROW,
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
const save = () => button('Save');
const addStop = () => click(container!.querySelector<HTMLButtonElement>('[data-add-stop]')!);
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
const text = (selector: string) => form().querySelector(selector)?.textContent ?? null;
const values = () => [field('Street address'), field('City'), field('State'), field('ZIP')].map((f) => f.value);

/** A real paste event on Street, as the browser fires it. Returns whether the browser's own paste was stopped. */
const paste = async (clip: string) => {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => clip } });
  await act(async () => {
    field('Street address').dispatchEvent(event);
  });
  return event.defaultPrevented;
};
const undo = (target: HTMLElement, key: 'metaKey' | 'ctrlKey' = 'metaKey') =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', [key]: true, bubbles: true, cancelable: true }));
  });

/** The new load's only stop: Joliet's truck has a load, so a new stop is added at the end. */
const newStop = async () => {
  await addStop();
  await type(field('Time at the stop'), '09:00');
};

describe('a paste into Street (§12.121)', () => {
  it('fills street, city, state and ZIP together, and the zone says where it came from', async () => {
    await render();
    await newStop();
    expect(await paste('Prairie Cold Storage\n4001 Main St\nDickinson, ND 58601')).toBe(true);
    expect(values()).toEqual(['4001 Main St', 'Dickinson', 'ND', '58601']);
    expect(zone().value).toBe('America/Denver');
    expect(text('[data-zone-source]')).toBe('Zone: Set from ZIP 58601.');
    expect(text('[data-paste-note]')).toContain('Filled street, city, state and ZIP from the paste.');
    expect(text('[data-paste-left-out]')).toBe('Left out: “Prairie Cold Storage” — not part of the street.');
    expect(save().disabled).toBe(false);
  });

  it('leaves a plain single line to the browser, untouched', async () => {
    await render();
    await newStop();
    expect(await paste('4001 Main St')).toBe(false);
    expect(await paste('Fargo, ND')).toBe(false);
    expect(values()).toEqual(['', '', '', '']);
    expect(form().querySelector('[data-paste-note]')).toBeNull();
  });

  it('acts on a paste only: typing the same text splits nothing', async () => {
    await render();
    await newStop();
    await type(field('Street address'), '4001 Main St, Fargo, ND 58102');
    expect(values()).toEqual(['4001 Main St, Fargo, ND 58102', '', '', '']);
  });

  it('keeps a city, state or ZIP already typed, says so, and offers the pasted ones', async () => {
    await render();
    await newStop();
    await type(field('City'), 'West Fargo');
    expect(await paste('4001 Main St\nFargo, ND 58102')).toBe(true);
    expect(values()).toEqual(['4001 Main St', 'West Fargo', 'ND', '58102']);
    expect(text('[data-paste-kept]')).toBe('Kept what you had in city. The paste said city “Fargo”.');
    await click(button('Use the pasted ones'));
    expect(values()).toEqual(['4001 Main St', 'Fargo', 'ND', '58102']);
    expect(form().querySelector('[data-paste-kept]')).toBeNull();
  });

  it('marks what it could not settle, with the pasted text, and fills the rest', async () => {
    await render();
    await newStop();
    await paste('4001 Main St\n90 Dock Rd\nFargo, ND 58102');
    expect(values()).toEqual(['', 'Fargo', 'ND', '58102']);
    expect(text('[data-field-check]')).toBe(
      'Check: More than one line could be the street: “4001 Main St” or “90 Dock Rd”.',
    );
  });

  it('⌘Z or Ctrl+Z puts back the four fields and the zone, in one step', async () => {
    await render();
    await newStop();
    // Add stop carried the last stop's zone, Mountain.
    expect(zone().value).toBe('America/Denver');
    await paste('4001 Main St\nFargo, ND 58102');
    expect(zone().value).toBe('America/Chicago');
    await undo(field('City'));
    expect(values()).toEqual(['', '', '', '']);
    expect(zone().value).toBe('America/Denver');
    expect(form().querySelector('[data-paste-note]')).toBeNull();

    await paste('4001 Main St\nFargo, ND 58102');
    await undo(field('Street address'), 'ctrlKey');
    expect(values()).toEqual(['', '', '', '']);
    expect(zone().value).toBe('America/Denver');
  });

  it('after a field is typed in, ⌘Z is the browser’s again', async () => {
    await render();
    await newStop();
    await paste('4001 Main St\nFargo, ND 58102');
    await type(field('City'), 'Fargo ');
    await undo(field('City'));
    expect(values()).toEqual(['4001 Main St', 'Fargo ', 'ND', '58102']);
  });

  it('a saved stop keeps its stored zone, and the banner names what the paste filled', async () => {
    await render();
    await click(rows()[1]!);
    await type(field('Street address'), '');
    await type(field('City'), '');
    await type(field('State'), '');
    await type(field('ZIP'), '');
    await paste('4001 Main St\nDickinson, ND 58601');
    expect(values()).toEqual(['4001 Main St', 'Dickinson', 'ND', '58601']);
    expect(zone().value).toBe('America/Denver'); // stored, and Dickinson happens to agree
    expect(text('[data-zone-source]')).toBe(
      'Zone: Kept as saved: an address change never moves a saved stop’s zone.',
    );
    expect(banner()).toContain('city');
    expect(banner()).toContain('state');
    expect(banner()).toContain('ZIP');
  });

  it('nothing is saved until Save', async () => {
    await render();
    await newStop();
    await paste('4001 Main St\nFargo, ND 58102');
    expect(postedZones()).toEqual([]);
    await click(save());
    expect(postedZones()).toContain('America/Chicago');
  });
});
