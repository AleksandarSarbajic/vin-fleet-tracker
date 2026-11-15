// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditStopModal } from './EditStopModal';
import { fleetRow, nextStop } from '@/test/fleet-row';
import { primeLoadRead } from '@/test/load-read';
import { YEAR } from '@/test/dst';
import { isoDayIn, startOfDayIn } from '@/test/zone-day';
import { nextCalendarDay } from '@/lib/calendar';
import { dayWords } from '@/lib/stop-day';
import type { FleetResponse } from '@/hooks/useFleet';

/**
 * Phase 3bw, QoL feature 4 (§12.163), in the real edit window. The dispatcher is in Chicago
 * and the stop in New York, at 00:30 in New York: the stop is a day ahead. Every date is
 * derived in code (CLAUDE.md), never pasted.
 */
const STOP_TZ = 'America/New_York';
const OWN_TZ = 'America/Chicago';
const NOW = new Date(startOfDayIn(new Date(Date.UTC(YEAR, 5, 15, 12)), STOP_TZ).getTime() + 30 * 60_000);
const ahead = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

const ROW = fleetRow({
  nextStop: nextStop({
    type: 'DEL',
    city: 'Albany',
    state: 'NY',
    apptStartUtc: ahead(30),
    apptEndUtc: ahead(30.5),
    apptTz: STOP_TZ,
    apptType: 'APPT',
  }),
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  // The dispatcher's own zone, as the date picker and the window read it.
  const real = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...real.call(this), timeZone: OWN_TZ };
  });
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
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  });

const render = async () => {
  primeLoadRead(client, ROW);
  client.setQueryData<FleetResponse>(['fleet'], { fleet: [ROW], fetchedAt: NOW.toISOString() } as FleetResponse);
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(EditStopModal, {
          row: ROW,
          drivers: [],
          role: 'admin',
          dispatchTz: OWN_TZ,
          onClose: vi.fn(),
          onReload: vi.fn(),
        }),
      ),
    );
  });
  await settle();
};

const form = () => container!.querySelector<HTMLElement>('[role="tabpanel"]') ?? container!;
const labelled = (label: string) => {
  const match = [...form().querySelectorAll('label')].find((l) => (l.textContent ?? '').trim().startsWith(label));
  if (!match) throw new Error(`No field labelled ${label}`);
  return match;
};
const dateField = () => labelled('Date (stop-local)').querySelector('input') as HTMLInputElement;
const zone = () => labelled('Facility time zone').querySelector('select') as HTMLSelectElement;
const dayButton = (which: 'today' | 'tomorrow') =>
  form().querySelector<HTMLButtonElement>(`[data-stop-day="${which}"]`)!;
const note = () => form().querySelector('[data-stop-day-note]')?.textContent ?? null;
const click = async (el: HTMLElement) => {
  await act(async () => el.click());
  await settle();
};
const type = (el: HTMLInputElement, text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const pick = (el: HTMLSelectElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
const saveButton = () =>
  [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Save')!;
const posted = () =>
  (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls
    .filter(([url, init]) => url === '/api/stops' && init?.method === 'POST')
    .map(([, init]) => String(init!.body));

/** The stop's date and the dispatcher's, derived from the instant: a day apart by construction. */
const stopToday = isoDayIn(NOW, STOP_TZ);
const ownToday = isoDayIn(NOW, OWN_TZ);

describe('Today and Tomorrow beside the appointment date (QoL 4)', () => {
  it('the case is the stop ahead: New York is on the day after Chicago', () => {
    expect(stopToday).toBe(nextCalendarDay(ownToday));
  });

  it('Today writes the stop\'s date, worked out from the stop\'s zone, not the dispatcher\'s', async () => {
    await render();
    await click(dayButton('today'));
    expect(dateField().value).toBe(stopToday);
    expect(dateField().value).not.toBe(ownToday);
  });

  it('Tomorrow writes the date after the stop\'s today', async () => {
    await render();
    await click(dayButton('tomorrow'));
    expect(dateField().value).toBe(nextCalendarDay(stopToday));
  });

  it('a note says the two dates differ, only after a click, and goes when another date is typed', async () => {
    await render();
    expect(note()).toBeNull();
    await click(dayButton('today'));
    expect(note()).toBe(`At this stop it is ${dayWords(stopToday)}. Your own date is ${dayWords(ownToday)}.`);
    await type(dateField(), nextCalendarDay(nextCalendarDay(stopToday)));
    expect(note()).toBeNull();
  });

  it('the zone moved after the click: the date stays as written, and the note names the zone it came from', async () => {
    await render();
    await click(dayButton('today'));
    await pick(zone(), 'America/Chicago');
    expect(dateField().value).toBe(stopToday);
    expect(note()).toBe(
      'Worked out in America/New_York. The zone is now America/Chicago: press Today or Tomorrow again for the date there.',
    );
  });

  it('the buttons are outside the label, so the label still names the date input', async () => {
    await render();
    expect(labelled('Date (stop-local)').querySelector('button')).toBeNull();
    expect(dayButton('today').getAttribute('aria-label')).toBe('Today at this stop');
    expect(dayButton('tomorrow').getAttribute('aria-label')).toBe('Tomorrow at this stop');
  });

  it('what Save sends is the date as wall parts, the time as it was and the stop\'s zone: no instant', async () => {
    await render();
    const time = (labelled('Time at the stop').querySelector('input') as HTMLInputElement).value;
    await click(dayButton('today'));
    await click(saveButton());
    const bodies = posted();
    expect(bodies).toHaveLength(1);
    const [y, m, d] = stopToday.split('-').map(Number);
    const [h, min] = time.split(':').map(Number);
    const appointment = (JSON.parse(bodies[0]!) as { stops: { appointment: Record<string, unknown> }[] }).stops[0]!
      .appointment;
    expect(appointment).toMatchObject({ date: { y, m, d }, time: { h, min }, tz: STOP_TZ });
    expect(JSON.stringify(appointment)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});
