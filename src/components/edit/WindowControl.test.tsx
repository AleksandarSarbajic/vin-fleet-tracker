// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditStopModal } from './EditStopModal';
import { fleetRow } from '@/test/fleet-row';
import { YEAR } from '@/test/dst';
import { wallTimeInstant } from '@/lib/format';
import type { FleetResponse } from '@/hooks/useFleet';
import type { FleetRow } from '@/server/fleet-query';
import { stopView } from '@/test/load-body';

/**
 * §12.115. The APPT window opens as it was saved, an untouched save sends it
 * back, and the dropdown says what is stored: the time PLUS the window.
 *
 * The defect this exists for: every stop opened at "±30 min", every save
 * writes the window, so saving a note on an exact-time appointment moved its
 * deadline thirty minutes later — and the dirty banner said nothing.
 */

const TZ = 'America/Chicago';
const DAY = { y: YEAR, m: 6, d: 12 };
const START = wallTimeInstant(DAY, { h: 14, min: 0 }, TZ);
const plus = (minutes: number | null) =>
  minutes === null ? null : new Date(START.getTime() + minutes * 60_000).toISOString();

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let posted: Record<string, unknown>[] = [];

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
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

/** An APPT stop at 14:00 whose stored end is `minutes` later (null: no end). */
const stopWith = (minutes: number | null): FleetRow =>
  fleetRow({
    nextStop: {
      apptType: 'APPT',
      apptTz: TZ,
      apptStartUtc: START.toISOString(),
      apptEndUtc: plus(minutes),
    },
  });

const render = async (row: FleetRow) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

const windowSelect = () =>
  Array.from(container!.querySelectorAll('select')).find((s) =>
    Array.from(s.options).some((o) => o.text === 'Exact time'),
  )!;
const shown = () => windowSelect().options[windowSelect().selectedIndex]!.text;
const choices = () => Array.from(windowSelect().options).map((o) => o.text);
const deadline = () => container!.querySelector('[data-appt-deadline]')?.textContent ?? null;
const banner = () => container!.textContent!.match(/Unsaved changes — ([^.]*)\./)?.[1] ?? null;

const typeNote = async (text: string) => {
  const note = container!.querySelector('textarea')!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(note, text);
    note.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const pick = async (minutes: number) => {
  const select = windowSelect();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(select, String(minutes));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
};
const save = async () => {
  await act(async () => {
    Array.from(container!.querySelectorAll('button'))
      .find((b) => (b.textContent ?? '').trim() === 'Save')!
      .click();
  });
};
const postedWindow = () =>
  (posted.at(-1)!['appointment'] as { windowMinutes: number }).windowMinutes;

describe('the window opens as it was saved', () => {
  it.each([
    [null, 'Exact time'],
    [0, 'Exact time'],
    [30, '+30 min'],
    [120, '+2 h'],
  ])('a stored end %s minutes on opens on "%s"', async (minutes, label) => {
    await render(stopWith(minutes));
    expect(shown()).toBe(label);
  });

  it('offers a stored 45 minutes as its own choice, selected', async () => {
    await render(stopWith(45));
    expect(shown()).toBe('+45 min');
    expect(choices()).toEqual(['Exact time', '+15 min', '+30 min', '+45 min', '+1 h', '+2 h']);
  });
});

describe('the label says what is stored', () => {
  it('offers the time plus a window — no ±', async () => {
    await render(stopWith(30));
    expect(choices()).toEqual(['Exact time', '+15 min', '+30 min', '+1 h', '+2 h']);
    expect(container!.textContent).not.toContain('±');
  });

  it('names the deadline under it, and follows the choice', async () => {
    await render(stopWith(30));
    expect(deadline()).toBe('deadline 14:30 CDT');
    await pick(0);
    expect(deadline()).toBe('deadline 14:00 CDT');
    await pick(120);
    expect(deadline()).toBe('deadline 16:00 CDT');
  });
});

describe('an untouched save sends the stored window back', () => {
  it.each([
    [0, 0],
    [null, 0],
    [30, 30],
    [45, 45],
  ])('stored %s: a note-only save sends %s, and the banner names only the note', async (stored, sent) => {
    await render(stopWith(stored));
    expect(banner()).toBeNull();
    await typeNote('gate 4');
    expect(banner()).toBe('note');
    await save();
    expect(postedWindow()).toBe(sent);
  });

  it('names the window in the banner when the dispatcher changes it, and sends the change', async () => {
    await render(stopWith(0));
    await pick(30);
    expect(banner()).toBe('appointment window');
    await save();
    expect(postedWindow()).toBe(30);
  });
});
