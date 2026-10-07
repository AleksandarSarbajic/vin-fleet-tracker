// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TruckRow, apptText } from './TruckRow';
import { TruckTimeline } from './TruckTimeline';
import { apptLine } from './map/MapPopup';
import { TruckSheet } from './phone/TruckSheet';
import { fleetRow } from '@/test/fleet-row';
import { YEAR } from '@/test/dst';
import { fcfsEndDate } from '@/lib/appointment';
import { wallTimeInstant } from '@/lib/format';
import type { FleetRow } from '@/server/fleet-query';
import type { TimelineStop } from '@/server/timeline';

/**
 * §12.114 on every surface that prints a window. A window that closes on a
 * later day at the stop reads `+1`; one that closes the same day reads
 * exactly what it always did — which is also why the desktop and history
 * baselines hold at zero differences.
 */

const TZ = 'America/Chicago';
const EVENING = { y: YEAR, m: 6, d: 12 };

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const hours = (
  from: { h: number; min: number },
  to: { h: number; min: number },
  type: 'APPT' | 'FCFS' = 'FCFS',
) => ({
  apptType: type,
  apptTz: TZ,
  apptStartUtc: wallTimeInstant(EVENING, from, TZ).toISOString(),
  apptEndUtc: wallTimeInstant(fcfsEndDate(EVENING, from, to), to, TZ).toISOString(),
});
const NIGHT = hours({ h: 22, min: 0 }, { h: 6, min: 0 });
const DAY = hours({ h: 7, min: 0 }, { h: 15, min: 0 });

/** The weekday the stop's clock shows at an instant, asked of Intl. */
const weekdayAt = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short' }).format(new Date(iso));

const mountRow = (row: FleetRow) => {
  act(() => {
    root.render(
      <TruckRow
        row={row}
        fetchedAt="2026-09-18T12:00:00.000Z"
        feedStale={false}
        columns={8}
        density="comfortable"
        selected={false}
        checked={false}
        onCheck={() => {}}
        flash={null}
        reducedMotion={false}
        pinned={false}
        onPin={() => {}}
        query=""
        onSelect={() => {}}
        onEdit={() => {}}
      />,
    );
  });
};

describe('the row', () => {
  it('reads "by 06:00 CDT +1" for 22:00–06:00', () => {
    expect(apptText(fleetRow({ nextStop: NIGHT }))).toEqual({ prefix: 'by', time: '06:00 CDT +1' });
  });

  it('reads "by 15:00 CDT" for 07:00–15:00, as before', () => {
    expect(apptText(fleetRow({ nextStop: DAY }))).toEqual({ prefix: 'by', time: '15:00 CDT' });
  });

  it('names both days in the tooltip of an overnight window', () => {
    mountRow(fleetRow({ nextStop: NIGHT }));
    const from = weekdayAt(NIGHT.apptStartUtc);
    const to = weekdayAt(NIGHT.apptEndUtc);
    expect(from).not.toBe(to);
    expect(container.querySelector(`[title^="FCFS receiving hours"]`)?.getAttribute('title')).toBe(
      `FCFS receiving hours ${from} 22:00 CDT to ${to} 06:00 CDT — no slot, the deadline is ${to} 06:00 CDT`,
    );
  });

  it('leaves the tooltip of a same-day window as it was', () => {
    mountRow(fleetRow({ nextStop: DAY }));
    const day = weekdayAt(DAY.apptStartUtc);
    expect(container.querySelector(`[title^="FCFS receiving hours"]`)?.getAttribute('title')).toBe(
      `FCFS receiving hours ${day} 07:00 CDT to 15:00 CDT — no slot, the deadline is 15:00 CDT`,
    );
  });
});

describe('the popup and the truck sheet', () => {
  it('reads "Fri 22:00 CDT to 06:00 CDT +1"', () => {
    const stop = fleetRow({ nextStop: NIGHT }).nextStop!;
    expect(apptLine(stop)).toBe(`${weekdayAt(NIGHT.apptStartUtc)} 22:00 CDT to 06:00 CDT +1`);
  });

  it('reads a same-day window as before', () => {
    const stop = fleetRow({ nextStop: DAY }).nextStop!;
    expect(apptLine(stop)).toBe(`${weekdayAt(DAY.apptStartUtc)} 07:00 CDT to 15:00 CDT`);
  });

  it('carries the +1 onto the phone sheet, which prints the popup’s line', () => {
    act(() => {
      root.render(
        <TruckSheet
          row={fleetRow({ nextStop: NIGHT })}
          fetchedAt="2026-09-18T12:00:00.000Z"
          feedStale={false}
          tel={null}
          onClose={vi.fn()}
          onTimeline={vi.fn()}
          onShowOnMap={vi.fn()}
        />,
      );
    });
    expect(container.textContent).toContain('receiving ');
    expect(container.textContent).toContain('22:00 CDT to 06:00 CDT +1');
  });
});

describe('the timeline', () => {
  const stop = (over: Partial<TimelineStop>): TimelineStop => ({
    stopId: '22222222-2222-4222-8222-222222222222',
    loadId: '33333333-3333-4333-8333-333333333333',
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
    apptTz: TZ,
    apptType: 'APPT',
    arrivedAt: null,
    arrivedSource: null,
    departedAt: null,
    departedSource: null,
    dispatcherNote: null,
    noteAt: null,
    overrides: [],
    ...over,
  });

  const mountTimeline = (stops: TimelineStop[]) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['timeline', 'truck-1'], stops);
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ stops }),
    })) as unknown as typeof fetch;
    act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <TruckTimeline truckId="truck-1" truckLabel="101" dispatchTz={TZ} onClose={() => {}} />
        </QueryClientProvider>,
      );
    });
  };

  it('reads "22:00 CDT – 06:00 CDT +1" for FCFS hours', () => {
    mountTimeline([stop(NIGHT)]);
    expect(container.textContent).toContain('22:00 CDT – 06:00 CDT +1');
  });

  it('marks an APPT window that runs past midnight too', () => {
    mountTimeline([stop(hours({ h: 23, min: 30 }, { h: 0, min: 30 }, 'APPT'))]);
    expect(container.textContent).toContain('23:30 CDT – 00:30 CDT +1');
  });

  it('says a departure was marked by hand (§12.118)', () => {
    mountTimeline([
      stop({ arrivedAt: '2026-09-18T12:00:00.000Z', arrivedSource: 'detected', departedAt: '2026-09-18T13:00:00.000Z', departedSource: 'dispatcher' }),
    ]);
    expect(container.textContent).toContain('marked by hand');
  });

  it('says nothing more for a detected departure (§12.118)', () => {
    mountTimeline([
      stop({ arrivedAt: '2026-09-18T12:00:00.000Z', arrivedSource: 'detected', departedAt: '2026-09-18T13:00:00.000Z', departedSource: 'detected' }),
    ]);
    expect(container.textContent).toContain('Departed');
    expect(container.textContent).not.toContain('marked by hand');
  });

  it('reads a same-day window as before', () => {
    mountTimeline([stop(DAY)]);
    expect(container.textContent).toContain('07:00 CDT – 15:00 CDT');
    expect(container.textContent).not.toContain('+1');
  });
});
