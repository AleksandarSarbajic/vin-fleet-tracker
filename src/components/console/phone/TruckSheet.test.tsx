// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fleetRow } from '@/test/fleet-row';
import { DESKTOP_ONLY } from '@/lib/editing';
import { TruckSheet } from './TruckSheet';

/**
 * §12.96, stage 3. The phone's truck sheet: the popup's facts under the
 * popup's own formatting, Call driver only with a dialable number, and no
 * editing. A made-up 555 number; no driver's number enters a test.
 */

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

const ROUTED = fleetRow({
  truckNumber: 101,
  driverName: 'Ana Petrovic',
  status: 'LATE',
  computed: 'LATE',
  etaAbsence: 'has-eta',
  etaUtc: '2026-09-18T21:10:00.000Z',
  milesRemaining: 412,
  distanceBasis: 'routed',
  nextStop: {
    apptStartUtc: '2026-09-18T19:30:00.000Z',
    apptTz: 'America/Chicago',
    apptType: 'APPT',
    loadNumber: 'LD-4417',
  },
});

function render(
  tel: string | null,
  handlers = { close: vi.fn(), timeline: vi.fn(), map: vi.fn() },
) {
  act(() => {
    root.render(
      <TruckSheet
        row={ROUTED}
        fetchedAt="2026-09-18T12:00:00.000Z"
        feedStale={false}
        tel={tel}
        onClose={handlers.close}
        onTimeline={handlers.timeline}
        onShowOnMap={handlers.map}
      />,
    );
  });
  return handlers;
}

const field = (name: string) =>
  container.querySelector(`[data-sheet-field="${name}"]`)?.textContent ?? null;
const button = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

describe('the sheet', () => {
  it('carries every fact, the appointment under "Appt" and the ETA with its basis', () => {
    render(null);
    for (const name of [
      'status',
      'next-stop',
      'appointment',
      'eta',
      'position',
      'speed',
      'gps-age',
      'load',
      'driver',
    ]) {
      expect(field(name), name).not.toBeNull();
    }
    const appt = [...container.querySelectorAll('dt')].find(
      (dt) => dt.textContent === 'Appt',
    );
    expect(appt?.nextElementSibling?.getAttribute('data-sheet-field')).toBe(
      'appointment',
    );
    expect(field('eta')).toMatch(/ETA .* · routed road miles/);
    expect(field('next-stop')).toContain('Chicago, IL');
    expect(field('load')).toBe('LD-4417');
    expect(field('driver')).toContain('Ana Petrovic');
  });

  it('Call driver is a tel: link when there is a dialable number', () => {
    render('tel:+13125550101');
    const call = container.querySelector<HTMLAnchorElement>('a[href^="tel:"]');
    expect(call?.getAttribute('href')).toBe('tel:+13125550101');
    expect(call?.textContent).toBe('Call driver');
    // The number is in the link only, never printed.
    expect(container.textContent).not.toContain('5550101');
  });

  it('and nothing at all when there is not; never an sms: link', () => {
    render(null);
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
    expect(container.querySelector('a[href^="sms:"]')).toBeNull();
  });

  it('says where editing is, and offers no edit', () => {
    render(null);
    expect(container.querySelector('[data-desktop-only]')?.textContent).toBe(
      DESKTOP_ONLY,
    );
    expect(button('Edit load')).toBeUndefined();
  });

  it('Close, Timeline and Show on map do what they say', () => {
    const h = render(null);
    act(() => button('Close')!.click());
    act(() => button('Timeline')!.click());
    act(() => button('Show on map')!.click());
    expect(h.close).toHaveBeenCalledTimes(1);
    expect(h.timeline).toHaveBeenCalledWith(ROUTED.id);
    expect(h.map).toHaveBeenCalledWith(ROUTED.id);
  });

  it('handles no keys', () => {
    const added = vi.spyOn(window, 'addEventListener');
    const addedDoc = vi.spyOn(document, 'addEventListener');
    render(null);
    const keys = [...added.mock.calls, ...addedDoc.mock.calls].filter(([type]) =>
      String(type).startsWith('key'),
    );
    expect(keys).toEqual([]);
    added.mockRestore();
    addedDoc.mockRestore();
  });
});
