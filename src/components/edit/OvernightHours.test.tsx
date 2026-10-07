// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditStopModal } from './EditStopModal';
import { fleetRow } from '@/test/fleet-row';
import { eveningBefore, fallBack, YEAR } from '@/test/dst';
import { fcfsEndDate } from '@/lib/appointment';
import { wallTimeInstant } from '@/lib/format';
import type { FleetResponse } from '@/hooks/useFleet';
import type { FleetRow } from '@/server/fleet-query';
import { stopView } from '@/test/load-body';

/**
 * §12.114 in the form. A latest hour at or before the earliest is the next
 * morning, and the form says so in words — with the length, which is what
 * gives away a transposed 15:00–07:00. Nothing extra to tick.
 *
 * Every date is derived (the ordinary night from this year, the fall-back
 * night from Intl), never pasted.
 */

const TZ = 'America/Chicago';
const ORDINARY = { y: YEAR, m: 6, d: 12 };
const pad = (n: number) => String(n).padStart(2, '0');
const dateValue = (d: { y: number; m: number; d: number }) => `${d.y}-${pad(d.m)}-${pad(d.d)}`;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;
let posted: Record<string, unknown>[] = [];

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  posted = [];
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/stops' && init?.body) {
      posted.push(stopView(JSON.parse(String(init.body))));
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  }) as unknown as typeof fetch;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

/** A stored stop, as the fleet query returns it. */
const stored = (
  from: { h: number; min: number },
  to: { h: number; min: number },
  date = ORDINARY,
): FleetRow =>
  fleetRow({
    nextStop: {
      apptType: 'FCFS',
      apptTz: TZ,
      apptStartUtc: wallTimeInstant(date, from, TZ).toISOString(),
      apptEndUtc: wallTimeInstant(fcfsEndDate(date, from, to), to, TZ).toISOString(),
    },
  });

const render = async (row: FleetRow) => {
  client.setQueryData<FleetResponse>(['fleet'], {
    fleet: [row],
    fetchedAt: '2026-09-18T12:00:00.000Z',
  } as FleetResponse);
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(EditStopModal, {
          row,
          drivers: [],
          role: 'admin' as const,
          dispatchTz: TZ,
          onClose: () => {},
        }),
      ),
    );
  });
  return container!;
};

const setValue = (el: HTMLInputElement, text: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

const field = (label: string): HTMLInputElement => {
  const match = Array.from(container!.querySelectorAll('label')).find((l) =>
    (l.textContent ?? '').trim().startsWith(label),
  );
  const input = match?.querySelector('input');
  if (!input) throw new Error(`No field labelled ${label}`);
  return input as HTMLInputElement;
};

/** The abbreviation badge locked inside a time field. */
const badge = (label: string) => field(label).nextElementSibling?.textContent;

const nextDayLine = () => container!.querySelector('[data-ends-next-day]')?.textContent ?? null;

const type = async (values: { date?: string; earliest?: string; latest?: string }) => {
  await act(async () => {
    if (values.date) setValue(field('Date (stop-local)'), values.date);
    if (values.earliest) setValue(field('Earliest receiving hour'), values.earliest);
    if (values.latest) setValue(field('Latest'), values.latest);
  });
};

/** The weekday the stop's clock shows at an instant — asked of Intl, not assumed. */
const weekdayAt = (at: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short' }).format(at);

describe('the "Ends next day" line (§12.114)', () => {
  it('names the next morning and the length for 22:00–06:00', async () => {
    await render(stored({ h: 7, min: 0 }, { h: 15, min: 0 }));
    await type({ date: dateValue(ORDINARY), earliest: '22:00', latest: '06:00' });

    const close = wallTimeInstant(fcfsEndDate(ORDINARY, { h: 22, min: 0 }, { h: 6, min: 0 }), { h: 6, min: 0 }, TZ);
    expect(nextDayLine()).toBe(`Ends next day · ${weekdayAt(close)} 06:00 CDT · 8 h`);
  });

  it('says 9 h and CST on the fall-back night, and the badge follows the end', async () => {
    const evening = eveningBefore(TZ, fallBack(TZ, YEAR));
    await render(stored({ h: 7, min: 0 }, { h: 15, min: 0 }));
    await type({ date: dateValue(evening), earliest: '22:00', latest: '06:00' });

    expect(nextDayLine()).toMatch(/^Ends next day · \w{3} 06:00 CST · 9 h$/);
    // The opening hour is still daylight time; the closing one is not.
    expect(badge('Earliest receiving hour')).toBe('CDT');
    expect(badge('Latest')).toBe('CST');
  });

  it('is absent for a window that closes the same day', async () => {
    await render(stored({ h: 7, min: 0 }, { h: 15, min: 0 }));
    await type({ date: dateValue(ORDINARY), earliest: '07:00', latest: '15:00' });
    expect(nextDayLine()).toBeNull();
  });

  it('gives way to the refusal when the two hours are equal', async () => {
    const el = await render(stored({ h: 7, min: 0 }, { h: 15, min: 0 }));
    await type({ date: dateValue(ORDINARY), earliest: '06:00', latest: '06:00' });
    expect(nextDayLine()).toBeNull();
    expect(el.textContent).toContain('Earliest and latest are the same time');
  });
});

describe('a saved overnight stop reopens as it was saved', () => {
  it('is not dirty on open, and shows the next-day line straight away', async () => {
    const el = await render(stored({ h: 22, min: 0 }, { h: 6, min: 0 }));
    expect(field('Earliest receiving hour').value).toBe('22:00');
    expect(field('Latest').value).toBe('06:00');
    expect(field('Date (stop-local)').value).toBe(dateValue(ORDINARY));
    expect(nextDayLine()).toMatch(/^Ends next day · \w{3} 06:00 CDT · 8 h$/);
    expect(el.textContent).not.toContain('Unsaved changes');
  });

  it('saves the same wall times back — the START date, and 06:00, for the server to place', async () => {
    await render(stored({ h: 22, min: 0 }, { h: 6, min: 0 }));
    await act(async () => setValue(field('City'), 'Joliet'));
    await act(async () => {
      Array.from(container!.querySelectorAll('button'))
        .find((b) => (b.textContent ?? '').trim().toLowerCase().includes('save'))!
        .click();
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]!['appointment']).toEqual({
      type: 'FCFS',
      date: ORDINARY,
      time: { h: 22, min: 0 },
      tz: TZ,
      windowMinutes: null,
      endTime: { h: 6, min: 0 },
    });
  });
});
