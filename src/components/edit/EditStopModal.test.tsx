// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditStopModal } from './EditStopModal';
import { fleetRow } from '@/test/fleet-row';
import type { FleetResponse } from '@/hooks/useFleet';

/**
 * §12.44, and the §12.21 rule it rests on: **the cache must never hold a
 * shape the server cannot produce.**
 *
 * The optimistic patch writes `parsed.data`, not the form's own `edit`. That
 * was fixed in §12.21 and has never been asserted — so nothing stopped it
 * regressing, and the two shapes now differ in two more fields than they did
 * then: `zip` truncates ZIP+4 and `state` upper-cases.
 *
 * A dispatcher typing `il` and watching the row say `il` for a second before
 * the refetch corrects it to `IL` reads as a glitch, not as a bug, so nobody
 * reports it.
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;

const ROW = fleetRow();
const KEY = ['fleet'];

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData<FleetResponse>(KEY, {
    fleet: [ROW],
    fetchedAt: '2026-09-18T12:00:00.000Z',
  } as FleetResponse);
  // The save POSTs; the point of these tests is what the cache holds BEFORE
  // the response lands, so it never needs to resolve realistically.
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ ok: true }),
  })) as unknown as typeof fetch;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const render = async (row = ROW) => {
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(EditStopModal, {
          row,
          drivers: [],
          role: 'admin' as const,
          dispatchTz: 'America/Chicago',
          onClose: () => {},
        }),
      ),
    );
  });
  return container!;
};

/** Writes a value the way a browser does, so React's onChange sees it. */
const setValue = (el: HTMLInputElement, text: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

const fieldLabelled = (label: string): HTMLInputElement => {
  const inputs = Array.from(container!.querySelectorAll('label'));
  const match = inputs.find((l) => (l.textContent ?? '').trim().startsWith(label));
  const input = match?.querySelector('input');
  if (!input) throw new Error(`No field labelled ${label}`);
  return input as HTMLInputElement;
};

const buttonLabelled = (label: string): HTMLButtonElement => {
  const found = Array.from(container!.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').trim().toLowerCase().includes(label.toLowerCase()),
  );
  if (!found) throw new Error(`No button labelled ${label}`);
  return found as HTMLButtonElement;
};

const cachedStop = () => client.getQueryData<FleetResponse>(KEY)?.fleet[0]?.nextStop;

describe('the optimistic patch writes what the server writes (§12.21, §12.44)', () => {
  it('puts IL in the cache when the dispatcher typed il', async () => {
    await render();
    await act(async () => {
      setValue(fieldLabelled('State'), 'il');
    });
    await act(async () => {
      buttonLabelled('Save').click();
    });

    // Not 'il'. The row must not change case under the dispatcher when the
    // refetch lands — that reads as a glitch rather than as a bug.
    expect(cachedStop()?.state).toBe('IL');
  });

  it('puts five digits in the cache when the dispatcher pasted ZIP+4', async () => {
    await render();
    await act(async () => {
      setValue(fieldLabelled('ZIP'), '60601-1234');
    });
    await act(async () => {
      buttonLabelled('Save').click();
    });

    expect(cachedStop()?.zip).toBe('60601');
  });

  it('puts null in the cache for a cleared field, never an empty string', async () => {
    await render();
    await act(async () => {
      setValue(fieldLabelled('City'), '');
    });
    await act(async () => {
      buttonLabelled('Save').click();
    });

    // Both renderers of these fields use `??`, which does not catch ''.
    expect(cachedStop()?.city).toBeNull();
  });

  it('leaves the cache holding no empty strings at all', async () => {
    await render();
    await act(async () => {
      setValue(fieldLabelled('City'), '  ');
      setValue(fieldLabelled('ZIP'), '');
      setValue(fieldLabelled('State'), '');
    });
    await act(async () => {
      buttonLabelled('Save').click();
    });

    const stop = cachedStop();
    expect(Object.values(stop ?? {}).filter((v) => v === '')).toEqual([]);
  });
});

describe('the modal renders at all', () => {
  /**
   * The §12.37 smoke check. This modal is the largest surface in the app and
   * had no render test of any kind — which is exactly the state the driver UI
   * was in when it shipped with no way to add a driver.
   */
  it('shows the stop it was given', async () => {
    const el = await render();
    expect(el.textContent).toContain('137');
    expect(fieldLabelled('City').value).toBe('Chicago');
    expect(fieldLabelled('State').value).toBe('IL');
    expect(fieldLabelled('ZIP').value).toBe('60601');
  });
});

describe('the Active checkbox actually flips the flag (§12.14, §12.53)', () => {
  /**
   * The checkbox was `defaultChecked` with no `onChange`, so it moved on
   * screen and nowhere else. §12.14 names this modal as the ONLY surface the
   * flag is editable from — "No separate admin screen" — which made
   * `trucks.active` uneditable in the whole product while `/api/trucks` and
   * `setTruckActive` sat there fully built and audited, with zero callers.
   *
   * That is §12.37's shape: a feature reported done, the server half present,
   * and no render path reaching it.
   */
  const activeBox = (): HTMLInputElement => {
    const found = container!.querySelector('input[type="checkbox"]');
    if (!found) throw new Error('No Active checkbox');
    return found as HTMLInputElement;
  };

  const posted = (url: string) =>
    (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.filter(
      ([called]) => called === url,
    );

  it('starts from the truck, not from `true`', async () => {
    /**
     * An INACTIVE truck, because an active one cannot tell the two apart:
     * `defaultChecked` renders a tick, `checked={row.active}` renders a tick,
     * and the test passes either way. The `Inactive` chip's whole job is to
     * surface exactly this truck so somebody can turn it back on, and the old
     * checkbox showed it as already on.
     */
    await render(fleetRow({ active: false }));
    expect(activeBox().checked).toBe(false);
  });

  it('sends the flip to the route that writes it', async () => {
    await render();
    await act(async () => {
      activeBox().click();
    });
    await act(async () => {
      buttonLabelled('Save').click();
    });

    const calls = posted('/api/trucks');
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0]![1].body))).toEqual({
      truckId: ROW.id,
      active: !ROW.active,
    });
  });

  it('says nothing to that route when the flag did not move', async () => {
    // An unrelated save must not write a column it was not asked to write —
    // §12.23, in the entity next door.
    await render();
    await act(async () => {
      setValue(fieldLabelled('City'), 'Joliet');
    });
    await act(async () => {
      buttonLabelled('Save').click();
    });

    expect(posted('/api/trucks')).toHaveLength(0);
  });

  it('names the unsaved flag in the dirty banner', async () => {
    const el = await render();
    await act(async () => {
      activeBox().click();
    });
    expect(el.textContent).toContain('Unsaved changes');
    expect(el.textContent).toContain('active flag');
  });
});
