// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditStopModal } from './EditStopModal';
import { fleetRow } from '@/test/fleet-row';
import type { FleetResponse } from '@/hooks/useFleet';
import type { FleetRow } from '@/server/fleet-query';
import { primeLoadRead } from '@/test/load-read';
import { FADING_COPY } from '@/components/overlay/dialog-motion';

/**
 * Phase 3bd, step 0. The status override draft is typed work (§9.9: "not a silent
 * close"). Force late then Esc used to close with no question, and the reason and
 * note went with it, because `unsaved` left the draft out. It now counts, so the
 * banner, Esc, Cancel, the reload warning and the Clear stop and Reopen lines all
 * follow from the one condition. Save keeps its own rule: it asks whether there is
 * anything to send, which is a narrower question.
 *
 * A real reload is in `e2e/leave-page-warning.spec.ts`.
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;
let onClose: ReturnType<typeof vi.fn<() => void>>;

const NO_OVERRIDE = fleetRow();
const FORCED = fleetRow({
  override: {
    forcedStatus: 'LATE',
    reason: 'OTHER',
    reasonNote: 'Dock closed',
    setByName: 'Dee',
    setAtUtc: '2026-09-18T11:00:00.000Z',
    expiresAtUtc: '2026-09-18T15:00:00.000Z',
  },
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  globalThis.fetch = vi.fn(
    () => new Promise<Response>(() => {}),
  ) as unknown as typeof fetch;
  onClose = vi.fn<() => void>();
});

afterEach(async () => {
  act(() => root?.unmount());
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  document.querySelectorAll(`[${FADING_COPY}]`).forEach((n) => n.remove());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

async function open(row: FleetRow = NO_OVERRIDE) {
  client.setQueryData<FleetResponse>(['fleet'], {
    fleet: [row],
    fetchedAt: '2026-09-18T12:00:00.000Z',
  } as FleetResponse);
  primeLoadRead(client, row);
  await act(async () =>
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(EditStopModal, {
          row,
          drivers: [],
          role: 'admin' as const,
          dispatchTz: 'America/Chicago',
          onClose,
        }),
      ),
    ),
  );
}

const buttonNamed = (name: string): HTMLButtonElement => {
  const found = Array.from(container!.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === name,
  );
  if (!found) throw new Error(`No button named ${name}`);
  return found;
};
const click = (name: string) => act(async () => buttonNamed(name).click());
const banner = () =>
  Array.from(container!.querySelectorAll('p'))
    .map((p) => p.textContent ?? '')
    .find((t) => t.startsWith('Unsaved changes')) ?? null;
const asked = () => (container!.textContent ?? '').includes('Discard changes?');
const esc = () =>
  act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  });
const pickReason = (value: string) =>
  act(async () => {
    const select = Array.from(container!.querySelectorAll('select')).find((s) =>
      Array.from(s.options).some((o) => o.value === 'OTHER'),
    );
    if (!select) throw new Error('No reason select');
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      'value',
    )?.set;
    setter?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
/** Whether leaving the page would ask: the browser asks when the event is cancelled. */
const leavingAsks = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};
const posts = () =>
  vi
    .mocked(globalThis.fetch)
    .mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');

describe('the status override draft is typed work (§9.9, phase 3bd step 0)', () => {
  it('Force late then Esc asks, and the window stays', async () => {
    await open();
    await click('Force late');
    await esc();
    expect(asked()).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Force late then Cancel asks', async () => {
    await open();
    await click('Force late');
    await click('Cancel');
    expect(asked()).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('the banner says it, in plain words', async () => {
    await open();
    expect(banner()).toBeNull();
    await click('Force late');
    expect(banner()).toBe('Unsaved changes — status override.');
  });

  it('the Discard question names it', async () => {
    await open();
    await click('Force late');
    await esc();
    expect(container!.textContent).toContain('status override');
  });

  it('leaving the page asks, on the same condition', async () => {
    await open();
    expect(leavingAsks()).toBe(false);
    await click('Force late');
    expect(leavingAsks()).toBe(true);
  });

  it('put back to how it opened, nothing asks', async () => {
    await open();
    await click('Force late');
    await click('Auto');
    expect(banner()).toBeNull();
    expect(leavingAsks()).toBe(false);
    await esc();
    expect(asked()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a reason picked and then Auto again is nothing to lose: it is hidden and not sent', async () => {
    await open();
    await click('Force late');
    await pickReason('OTHER');
    await click('Auto');
    expect(banner()).toBeNull();
    expect(buttonNamed('Save').disabled).toBe(true);
    await esc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a live override, opened as it stands, asks nothing', async () => {
    await open(FORCED);
    expect(banner()).toBeNull();
    expect(leavingAsks()).toBe(false);
    await esc();
    expect(asked()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a live override set to Auto asks, and back to how it opened asks nothing', async () => {
    await open(FORCED);
    await click('Auto');
    expect(banner()).toBe('Unsaved changes — status override.');
    await click('Force late');
    expect(banner()).toBeNull();
  });

  it('a live override with another expiry is work too, though Save has nothing to send', async () => {
    await open(FORCED);
    await click('End of day');
    expect(banner()).toBe('Unsaved changes — status override.');
    expect(buttonNamed('Save').disabled).toBe(true);
    await esc();
    expect(asked()).toBe(true);
  });

  it('a live override with another reason asks, and Save can send it', async () => {
    await open(FORCED);
    await pickReason('DRIVER_REPORTED_DELAY');
    expect(banner()).toBe('Unsaved changes — status override.');
    expect(buttonNamed('Save').disabled).toBe(false);
  });

  it('a typed note on a live override is work too', async () => {
    await open(FORCED);
    const note = container!.querySelector<HTMLInputElement>('input[value="Dock closed"]');
    if (!note) throw new Error('No note field');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(
        note,
        'Dock closed until noon',
      );
      note.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(banner()).toBe('Unsaved changes — status override.');
    await esc();
    expect(asked()).toBe(true);
  });

  it('Save keeps its own rule: a forced status with no reason stays disabled', async () => {
    await open();
    await click('Force late');
    expect(buttonNamed('Save').disabled).toBe(true);
    await pickReason('DRIVER_REPORTED_DELAY');
    expect(buttonNamed('Save').disabled).toBe(false);
  });

  it('Save sends the override as before, and asks no question', async () => {
    await open();
    await click('Force late');
    await pickReason('DRIVER_REPORTED_DELAY');
    await click('Save');
    expect(asked()).toBe(false);
    expect(posts()).toHaveLength(1);
    const body = JSON.parse(String((posts()[0]![1] as RequestInit).body)) as {
      stops: { override?: { action: string; forcedStatus: string } }[];
    };
    expect(body.stops[0]?.override).toMatchObject({ action: 'set', forcedStatus: 'LATE' });
  });

  it('Discard closes, as it does for any other typed work', async () => {
    await open();
    await click('Force late');
    await esc();
    await click('Discard');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
