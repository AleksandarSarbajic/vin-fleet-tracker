// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditStopModal } from './EditStopModal';
import { fleetRow, nextStop } from '@/test/fleet-row';
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
    (
      globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }
    ).mock.calls.filter(([called]) => called === url);

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

describe('the arrival is loaded before it is saved (§12.57)', () => {
  /**
   * The same shape as §12.53's note: a control that opens blank over a stored
   * value writes that blank back, and the person who destroys the record is
   * the one person who could not see it was there. `arrived_at` is worse than
   * the note — it is the column detention would be argued from.
   */
  const ARRIVED = fleetRow({
    nextStop: nextStop({
      // 06:44 at the stop on 18 September, in America/Chicago (UTC-5 in
      // September). Derived, not pasted: §7 forbids a hardcoded offset, and
      // this is the zone the modal has to read it back in.
      arrivedAt: new Date('2026-09-18T11:44:00.000Z').toISOString(),
      arrivedSource: 'detected',
      apptTz: 'America/Chicago',
    }),
    etaAbsence: 'arrived',
    status: 'ARRIVED',
    computed: 'ARRIVED',
  });

  const arrivalBox = (): HTMLInputElement => {
    const found = Array.from(
      container!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ).find((b) => b.getAttribute('aria-label')?.startsWith('This truck has arrived'));
    if (!found) throw new Error('No arrival checkbox');
    return found;
  };

  const posted = (url: string) =>
    (
      globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }
    ).mock.calls.filter(([called]) => called === url);

  it('opens with the stored arrival, not with an empty box', async () => {
    await render(ARRIVED);
    expect(arrivalBox().checked).toBe(true);
    expect(fieldLabelled('Arrival date').value).toBe('2026-09-18');
    expect(fieldLabelled('Arrival time').value).toBe('06:44');
  });

  it('sends a wall time and a zone, never an instant', async () => {
    await render(ARRIVED);
    await act(async () => {
      setValue(fieldLabelled('Arrival time'), '06:20');
    });
    await act(async () => {
      buttonLabelled('Save').click();
    });

    const body = JSON.parse(String(posted('/api/stops')[0]![1].body)) as {
      arrivedAt: { date: unknown; time: unknown; tz: string };
    };
    // Integers and a zone. Nothing here is a Date, an ISO string or an
    // offset — the server converts, as it has since phase 2 (§7).
    expect(body.arrivedAt).toEqual({
      date: { y: 2026, m: 9, d: 18 },
      time: { h: 6, min: 20 },
      tz: 'America/Chicago',
    });
  });

  it('sends an explicit null when the box is unchecked', async () => {
    await render(ARRIVED);
    await act(async () => {
      arrivalBox().click();
    });
    await act(async () => {
      buttonLabelled('Save').click();
    });

    const body = JSON.parse(String(posted('/api/stops')[0]![1].body)) as {
      arrivedAt: unknown;
    };
    // Null, not an absent key: §12.23's difference between "clear it" and
    // "leave it alone", and the only way back from an arrival typed on the
    // wrong row (§12.27 never unsets one on its own).
    expect(body.arrivedAt).toBeNull();
  });

  it('says nothing about the arrival on a stop that has none', async () => {
    await render();
    await act(async () => {
      setValue(fieldLabelled('City'), 'Joliet');
    });
    await act(async () => {
      buttonLabelled('Save').click();
    });

    const body = JSON.parse(String(posted('/api/stops')[0]![1].body)) as Record<
      string,
      unknown
    >;
    // The control defaults to "now" so the box is usable the moment it is
    // ticked — but an untouched, unarrived stop must not send that default,
    // or every unrelated save would mark the truck arrived.
    expect('arrivedAt' in body).toBe(false);
  });
  /**
   * §12.85. The server wipes the arrival on an address change without asking,
   * so the modal says so BEFORE Save — and only while there is an arrival to
   * lose and the address actually differs.
   */
  it('warns before Save that changing the address clears the arrival', async () => {
    await render(ARRIVED);
    const note = () => container!.querySelector('[data-arrival-address-note]');
    expect(note()).toBeNull();
    await act(async () => {
      setValue(fieldLabelled('City'), 'Joliet');
    });
    expect(note()?.textContent).toMatch(/Changing the address clears this arrival/);
    // Retyped back, differently cased: the same address, so no warning.
    await act(async () => {
      setValue(fieldLabelled('City'), ARRIVED.nextStop!.city!.toUpperCase());
    });
    expect(note()).toBeNull();
  });

  it('does not warn about an arrival there is none of', async () => {
    await render();
    await act(async () => {
      setValue(fieldLabelled('City'), 'Joliet');
    });
    expect(container!.querySelector('[data-arrival-address-note]')).toBeNull();
  });
});

/**
 * §12.88 — Clear stop, through the modal's own markup and keyboard handling.
 * The server half is `server/clear-stop.test.ts`; this is the part a
 * dispatcher touches: where the button is, what it refuses, where focus goes,
 * and what Enter and Esc do.
 */
describe('Clear stop (§12.88)', () => {
  const TRUCK = ROW.id;
  const LOAD_A = '33333333-3333-4333-8333-333333333333';
  const LOAD_B = '33333333-3333-4333-8333-3333333333bb';

  const timelineStop = (over: Record<string, unknown>) => ({
    stopId: '22222222-2222-4222-8222-222222222222',
    loadId: LOAD_A,
    loadNumber: 'LD-4417',
    loadStatus: 'DISPATCHED',
    loadCreatedAt: '2026-09-18T06:00:00.000Z',
    sequence: 1,
    type: 'DEL',
    addressLine: '1 Broadway',
    city: 'Chicago',
    state: 'IL',
    zip: '60601',
    apptStartUtc: null,
    apptEndUtc: null,
    apptTz: 'America/Chicago',
    apptType: 'APPT',
    arrivedAt: null,
    arrivedSource: null,
    departedAt: null,
    dispatcherNote: null,
    noteAt: null,
    overrides: [],
    ...over,
  });

  /** Routes the two requests the confirm step makes. */
  const serve = (timeline: unknown[]) => {
    globalThis.fetch = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(url).startsWith('/api/timeline') ? { stops: timeline } : { ok: true },
    })) as unknown as typeof fetch;
  };

  const clears = () =>
    (
      globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }
    ).mock.calls
      .filter(([url]) => url === '/api/stops/clear')
      .map(([, init]) => JSON.parse(String(init.body)) as Record<string, string>);

  const renderWith = async (row = ROW, onClose = vi.fn()) => {
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
            onClose,
          }),
        ),
      );
    });
    return onClose;
  };

  const open = async () => {
    await act(async () => {
      buttonLabelled('Clear stop').click();
    });
    // The fresh timeline read resolves.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  };

  const press = async (key: string, target: EventTarget = document) => {
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
  };

  const confirmStep = () =>
    container!.querySelector('[role="dialog"][aria-label="Confirm clear stop"]');

  it('sits bottom-left, before Cancel and Save, and opens nothing on a truck with no open load', async () => {
    serve([]);
    await renderWith(fleetRow({ openLoadCount: 0 }));
    const clear = buttonLabelled('Clear stop');
    expect(clear.disabled).toBe(true);
    expect(clear.title).toBe('This truck has no open load to close.');
    const footerButtons = Array.from(
      clear.closest('.border-t')!.querySelectorAll('button'),
    ).map((b) => b.textContent?.trim());
    expect(footerButtons).toEqual(['Clear stop', 'Cancel', 'Save']);
  });

  it('opens a confirm step with focus on the confirm button, not a field', async () => {
    serve([timelineStop({})]);
    await renderWith();
    await open();
    expect(confirmStep()).not.toBeNull();
    expect(document.activeElement?.textContent).toBe('Close load');
    expect(confirmStep()!.textContent).toContain('Load LD-4417 is closed as Delivered.');
    expect(confirmStep()!.textContent).toContain(
      'The arrival and departure times are kept as the record.',
    );
  });

  it('Esc backs out of the confirm step without closing the modal', async () => {
    serve([timelineStop({})]);
    const onClose = await renderWith();
    await open();
    await press('Escape');
    expect(confirmStep()).toBeNull();
    expect(
      container!.querySelector('[aria-label^="Edit stop for truck"]'),
    ).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(clears()).toEqual([]);
  });

  it('Enter confirms: closes that load as Delivered and closes the modal', async () => {
    serve([timelineStop({})]);
    const onClose = await renderWith();
    await open();
    await press('Enter');
    expect(clears()).toEqual([{ truckId: TRUCK, loadId: LOAD_A, status: 'DELIVERED' }]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('on a "+1 load" truck, closes nothing until a load is chosen', async () => {
    serve([
      timelineStop({}),
      timelineStop({
        stopId: '22222222-2222-4222-8222-2222222222bb',
        loadId: LOAD_B,
        loadNumber: 'LD-9001',
        city: 'Fargo',
        state: 'ND',
      }),
    ]);
    const onClose = await renderWith(fleetRow({ openLoadCount: 2 }));
    await open();

    const radios = Array.from(
      confirmStep()!.querySelectorAll<HTMLInputElement>('input[name="clear-load"]'),
    );
    expect(radios).toHaveLength(2);
    expect(radios.some((r) => r.checked)).toBe(false);
    expect(confirmStep()!.textContent).toContain('LD-9001· next stop Fargo, ND');

    // Enter with nothing chosen: nothing is sent, and it says why.
    await press('Enter');
    expect(clears()).toEqual([]);
    expect(confirmStep()!.querySelector('[role="alert"]')?.textContent).toBe(
      'Choose which load to close.',
    );

    await act(async () => {
      radios[1]!.click();
    });
    await press('Enter', radios[1]!);
    expect(clears()).toEqual([{ truckId: TRUCK, loadId: LOAD_B, status: 'DELIVERED' }]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * Found by the e2e run: reopened, the step re-reads the truck's loads, and
   * an Enter pressed in that moment was dropped without a word. It must close
   * nothing — the dispatcher has not seen what closing does yet — and say so.
   */
  it('says so when Enter comes before the loads are read, and closes nothing', async () => {
    let land: (value: unknown) => void = () => {};
    globalThis.fetch = vi.fn(async (url: string) =>
      String(url).startsWith('/api/timeline')
        ? new Promise((resolve) => {
            land = resolve;
          })
        : { ok: true, status: 200, json: async () => ({ ok: true }) },
    ) as unknown as typeof fetch;
    const onClose = await renderWith();
    await open();
    await press('Enter');
    expect(clears()).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
    expect(confirmStep()!.querySelector('[role="alert"]')?.textContent).toBe(
      "Still reading this truck's loads. Nothing was closed.",
    );

    await act(async () => {
      land({ ok: true, status: 200, json: async () => ({ stops: [timelineStop({})] }) });
    });
    /*
     * The read lands over several turns — the response, its json(), the
     * query's update, then the effect that withdraws the sentence. One timer
     * tick was enough on an idle machine and not under the full parallel run,
     * so this waits for the condition, bounded, instead of for a tick.
     */
    for (
      let turn = 0;
      turn < 50 && confirmStep()!.querySelector('[role="alert"]');
      turn += 1
    ) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
    expect(confirmStep()!.querySelector('[role="alert"]')).toBeNull();
    await press('Enter');
    expect(clears()).toEqual([{ truckId: TRUCK, loadId: LOAD_A, status: 'DELIVERED' }]);
  });

  it('sends Cancelled when that is chosen', async () => {
    serve([timelineStop({})]);
    await renderWith();
    await open();
    const cancelled = Array.from(
      confirmStep()!.querySelectorAll<HTMLInputElement>('input[name="clear-status"]'),
    ).find((r) => r.value === 'CANCELLED')!;
    await act(async () => {
      cancelled.click();
    });
    expect(confirmStep()!.textContent).toContain('Load LD-4417 is closed as Cancelled.');
    await press('Enter', cancelled);
    expect(clears()).toEqual([{ truckId: TRUCK, loadId: LOAD_A, status: 'CANCELLED' }]);
  });
});

describe('a truck with no next stop but open loads (§12.92)', () => {
  const LOAD_A = '44444444-4444-4444-8444-444444444444';
  const LOAD_B = '44444444-4444-4444-8444-4444444444bb';
  const NOW = Date.now();
  const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

  /** A finished stop on an open load: arrived and departed, never closed. */
  const done = (
    loadId: string,
    loadNumber: string | null,
    city: string,
    source: string,
  ) => ({
    stopId: `${loadId.slice(0, -2)}${loadId === LOAD_A ? '0a' : '0b'}`,
    loadId,
    loadNumber,
    loadStatus: 'AVAILABLE',
    loadCreatedAt: ago(20),
    sequence: 1,
    type: 'DEL',
    addressLine: '220 N Fairway Dr',
    city,
    state: 'IL',
    zip: '60061',
    apptStartUtc: null,
    apptEndUtc: null,
    apptTz: 'America/Chicago',
    apptType: 'APPT',
    arrivedAt: ago(2),
    arrivedSource: source,
    departedAt: ago(1),
    dispatcherNote: null,
    noteAt: null,
    overrides: [],
  });
  const ONE = [done(LOAD_A, '6612193', 'Vernon Hills', 'detected')];
  const TWO = [...ONE, done(LOAD_B, null, 'Joliet', 'dispatcher')];

  const serve = (timeline: unknown[]) => {
    globalThis.fetch = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(url).startsWith('/api/timeline') ? { stops: timeline } : { ok: true },
    })) as unknown as typeof fetch;
  };
  const posted = (path: string) =>
    (
      globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } }
    ).mock.calls
      .filter(([url, init]) => url === path && init?.method === 'POST')
      .map(([, init]) => JSON.parse(String(init!.body)) as Record<string, unknown>);

  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  const renderEmpty = async (openLoadCount: number, timeline: unknown[]) => {
    serve(timeline);
    await render(fleetRow({ nextStop: null, openLoadCount }));
    await settle();
  };
  const subtitle = () => container!.querySelector('h2 + p')?.textContent ?? '';
  const lines = () =>
    [...container!.querySelectorAll('[data-previous-load]')].map(
      (el) => el.querySelector('p')?.textContent,
    );
  const question = () =>
    document.querySelector('[role="dialog"][aria-label="Previous load still open"]');
  const answer = async (loadId: string, label: string) => {
    const group = document.querySelector(`[data-save-question="${loadId}"]`)!;
    const button = [...group.querySelectorAll('button')].find(
      (b) => b.textContent === label,
    )!;
    await act(async () => button.click());
    await settle();
  };
  const typeCityAndSave = async () => {
    await act(async () => setValue(fieldLabelled('City'), 'Aurora'));
    await act(async () => buttonLabelled('Save').click());
    await settle();
  };

  describe('the header and Clear stop agree', () => {
    it.each([
      [0, [], 'No load on this truck yet'],
      [1, ONE, 'No next stop. 1 previous load still open'],
      [2, TWO, 'No next stop. 2 previous loads still open'],
    ] as const)('with %i open loads', async (count, timeline, expected) => {
      await renderEmpty(count, [...timeline]);
      expect(container!.querySelector('h2')?.textContent).toBe('New load — truck 137');
      expect(subtitle()).toContain(expected);
      // Never "No load" while Clear stop can act on one, and the reverse.
      expect(subtitle().includes('No load')).toBe(buttonLabelled('Clear stop').disabled);
    });
  });

  it('shows one line for one previous load, in dispatch time, with Close load…', async () => {
    await renderEmpty(1, ONE);
    const t = (h: number) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Chicago',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(ago(h)));
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatch(
      new RegExp(
        `^Previous load 6612193: Vernon Hills, arrived ${t(2)} C[DS]T, departed ${t(1)} C[DS]T \\(detected automatically\\)\\. Still open\\.$`,
      ),
    );
    expect(buttonLabelled('Clear stop').title).toBe(
      'Close previous load 6612193 (Vernon Hills).',
    );
  });

  it('shows a line for each of two, and Close load… opens the confirm step on THAT load', async () => {
    await renderEmpty(2, TWO);
    expect(lines()).toHaveLength(2);
    expect(lines()[1]).toMatch(
      /^Previous load no number: Joliet, .*\(marked by hand\)\. Still open\.$/,
    );
    expect(buttonLabelled('Clear stop').title).toBe(
      'Close one of 2 previous loads: 6612193 (Vernon Hills), no number (Joliet).',
    );

    const second = container!.querySelector(`[data-previous-load="${LOAD_B}"] button`)!;
    await act(async () => (second as HTMLButtonElement).click());
    await settle();
    const checked = document.querySelector<HTMLInputElement>(
      'input[name="clear-load"]:checked',
    );
    // Chosen already — on a two-load truck the plain Clear stop chooses none.
    expect(checked?.value).toBe(LOAD_B);
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(posted('/api/stops/clear')).toEqual([
      { truckId: ROW.id, loadId: LOAD_B, status: 'DELIVERED' },
    ]);
  });

  describe('saving a new load asks about the previous one first', () => {
    it('asks, and saves nothing until it is answered; focus starts on Back', async () => {
      await renderEmpty(1, ONE);
      await typeCityAndSave();
      expect(question()?.textContent).toContain(
        'Previous load 6612193 is still open. Close it as Delivered?',
      );
      expect(posted('/api/stops')).toEqual([]);
      expect(document.activeElement?.textContent).toBe('Back to the form');

      // Back: still nothing saved, nothing closed.
      await act(async () => (document.activeElement as HTMLButtonElement).click());
      expect(question()).toBeNull();
      expect(posted('/api/stops')).toEqual([]);
    });

    it.each([
      ['Delivered', [{ loadId: LOAD_A, status: 'DELIVERED' }]],
      ['Cancelled', [{ loadId: LOAD_A, status: 'CANCELLED' }]],
      ['Keep it open', undefined],
    ] as const)('"%s" saves the new load with that answer', async (label, expected) => {
      await renderEmpty(1, ONE);
      await typeCityAndSave();
      await answer(LOAD_A, label);
      const [body] = posted('/api/stops');
      expect(body?.city).toBe('Aurora');
      expect(body?.stopId).toBeNull();
      expect(body?.closePrevious).toEqual(expected);
      // One request: never a separate clear.
      expect(posted('/api/stops/clear')).toEqual([]);
    });

    it('with two, saves only once both are answered', async () => {
      await renderEmpty(2, TWO);
      await typeCityAndSave();
      await answer(LOAD_A, 'Delivered');
      expect(posted('/api/stops')).toEqual([]);
      await answer(LOAD_B, 'Keep it open');
      expect(posted('/api/stops').map((b) => b.closePrevious)).toEqual([
        [{ loadId: LOAD_A, status: 'DELIVERED' }],
      ]);
    });

    it('does not ask when the truck holds no open load', async () => {
      await renderEmpty(0, []);
      await typeCityAndSave();
      expect(question()).toBeNull();
      expect(posted('/api/stops')).toHaveLength(1);
      expect(posted('/api/stops')[0]?.closePrevious).toBeUndefined();
    });
  });
});

/**
 * The overwritten-trips fix, in the modal. A REACHED stop saved with a new
 * city or load number asks "correction, or the next trip?" before anything is
 * sent. Nothing is preselected, focus starts on "Back to the form", and the
 * answer rides in the one save request. The server half is
 * `server/clear-stop.test.ts`; the rule both call is `lib/reached-stop.ts`.
 */
describe('a reached stop given a new city or number asks first', () => {
  const REACHED = fleetRow({
    nextStop: nextStop({
      loadNumber: '12120640',
      city: 'Joliet',
      // 06:44 at the stop on Fri 18 September — not today, so the weekday shows.
      arrivedAt: new Date('2026-09-18T11:44:00.000Z').toISOString(),
      arrivedSource: 'detected',
      apptTz: 'America/Chicago',
    }),
    etaAbsence: 'arrived',
    status: 'ARRIVED',
    computed: 'ARRIVED',
  });

  const question = () =>
    container!.querySelector<HTMLElement>('[role="dialog"][aria-label="Stop already reached"]');

  const bodies = () =>
    (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls
      .filter(([url]) => url === '/api/stops')
      .map(([, init]) => JSON.parse(String(init.body)) as Record<string, unknown>);

  const save = async () => {
    await act(async () => {
      buttonLabelled('Save').click();
    });
  };

  const choose = async (label: 'Correction' | 'Next trip' | 'Back to the form') => {
    const button = Array.from(question()!.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === label,
    );
    if (!button) throw new Error(`No ${label} in the question`);
    await act(async () => button.click());
  };

  it('asks before saving a new city: nothing chosen, focus on Back, and Back sends nothing', async () => {
    await render(REACHED);
    await act(async () => setValue(fieldLabelled('City'), 'Des Plaines'));
    await save();

    expect(question()?.textContent).toMatch(
      /This stop was reached at \w{3} 06:44 \S+\. Is this a correction, or the next trip\?/,
    );
    // It says what the next trip would close.
    expect(question()?.textContent).toContain('Load 12120640 closes as Delivered');
    for (const b of question()!.querySelectorAll('button')) {
      expect(b.getAttribute('aria-pressed') ?? 'false').toBe('false');
    }
    expect(document.activeElement?.textContent?.trim()).toBe('Back to the form');
    expect(bodies()).toEqual([]);

    await choose('Back to the form');
    expect(question()).toBeNull();
    expect(bodies()).toEqual([]);
    // Back to the form, with the typing still there.
    expect(fieldLabelled('City').value).toBe('Des Plaines');
  });

  it('Esc backs out of the question, not out of the modal', async () => {
    await render(REACHED);
    await act(async () => setValue(fieldLabelled('City'), 'Des Plaines'));
    await save();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(question()).toBeNull();
    expect(fieldLabelled('City').value).toBe('Des Plaines');
    expect(bodies()).toEqual([]);
  });

  it('asks before saving a new load number', async () => {
    await render(REACHED);
    await act(async () => setValue(fieldLabelled('Load number'), '200584'));
    await save();
    expect(question()).not.toBeNull();
    expect(bodies()).toEqual([]);
  });

  it.each([
    ['Correction', 'correction'],
    ['Next trip', 'next-trip'],
  ] as const)('"%s" saves once, carrying that answer', async (label, sent) => {
    await render(REACHED);
    await act(async () => setValue(fieldLabelled('City'), 'Des Plaines'));
    await save();
    await choose(label);

    expect(bodies()).toHaveLength(1);
    expect(bodies()[0]).toMatchObject({
      stopId: REACHED.nextStop!.stopId,
      city: 'Des Plaines',
      reachedStop: sent,
    });
    expect(question()).toBeNull();
  });

  it('does not ask on a stop that was not reached', async () => {
    await render();
    await act(async () => setValue(fieldLabelled('City'), 'Des Plaines'));
    await save();
    expect(question()).toBeNull();
    expect(bodies()).toHaveLength(1);
    expect('reachedStop' in bodies()[0]!).toBe(false);
  });

  it('does not ask when a reached stop is saved with the same city and number', async () => {
    await render(REACHED);
    await act(async () => setValue(fieldLabelled('State'), 'WI'));
    await save();
    expect(question()).toBeNull();
    expect(bodies()).toHaveLength(1);
  });

  it('asks when the server says the stop was reached after the modal opened', async () => {
    const reachedMeanwhile = new Date('2026-09-18T12:05:00.000Z').toISOString();
    let call = 0;
    globalThis.fetch = vi.fn(async () =>
      call++ === 0
        ? {
            ok: false,
            status: 409,
            json: async () => ({
              error: 'This stop has been reached.',
              reachedStop: { arrivedAt: reachedMeanwhile },
            }),
          }
        : { ok: true, status: 200, json: async () => ({ ok: true }) },
    ) as unknown as typeof fetch;

    await render();
    await act(async () => setValue(fieldLabelled('City'), 'Des Plaines'));
    await save();

    // The server's arrival, 07:05 at the stop — not anything the modal had.
    expect(question()?.textContent).toMatch(/reached at \w{3} 07:05 /);
    await choose('Next trip');
    expect(bodies().map((b) => b['reachedStop'])).toEqual([undefined, 'next-trip']);
  });
});
