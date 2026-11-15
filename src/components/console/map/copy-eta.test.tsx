// @vitest-environment happy-dom
import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fleetRow, nextStop } from '@/test/fleet-row';
import { YEAR } from '@/test/dst';
import { zoneNameIn } from '@/test/zone-day';
import type { FleetRow } from '@/server/fleet-query';
import { FEED_DOWN_REFUSAL, etaLine } from './eta-line';
import { MapPopup } from './MapPopup';

/**
 * Phase 3bw, QoL feature 14 (§12.163). Copy ETA, from the popup: one line, the truck, the stop,
 * the ETA with its zone's abbreviation and the miles; refused, with the reason, on a stale feed
 * and where there is no ETA. The expected clock and abbreviation are derived here from the
 * instant, apart from the code under test. Invented data only.
 */
vi.mock('react-map-gl/mapbox', () => ({
  Popup: ({ children }: { children: ReactNode }) => children,
}));

const CHICAGO = 'America/Chicago';
/** 18:05 UTC in January and in July: CST and CDT, whichever names Intl gives them. */
const WINTER = new Date(Date.UTC(YEAR, 0, 15, 18, 5));
const SUMMER = new Date(Date.UTC(YEAR, 6, 15, 18, 5));
const clock = (at: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: CHICAGO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
const LINE = () => `Truck 101 · Joliet, IL · ETA ${clock(WINTER)} ${zoneNameIn(WINTER, CHICAGO)} · 412 mi`;

const withEta = (at: Date, over: Partial<FleetRow> = {}): FleetRow =>
  fleetRow({
    truckNumber: 101,
    etaAbsence: 'has-eta',
    etaUtc: at.toISOString(),
    milesRemaining: 412.4,
    lat: 41.5,
    lng: -88.1,
    nextStop: nextStop({ city: 'Joliet', state: 'IL', apptTz: CHICAGO }),
    ...over,
  });

describe('the ETA line (QoL 14)', () => {
  it('one line in the demo\'s words: the truck, the stop, the ETA with its zone, the miles', () => {
    expect(etaLine(withEta(WINTER), false)).toEqual({ text: LINE() });
  });

  it('the abbreviation is the instant\'s own: winter and summer differ, each from Intl', () => {
    expect(etaLine(withEta(WINTER), false)).toEqual({ text: expect.stringContaining(` ${zoneNameIn(WINTER, CHICAGO)} · `) });
    expect(etaLine(withEta(SUMMER), false)).toEqual({ text: expect.stringContaining(` ${zoneNameIn(SUMMER, CHICAGO)} · `) });
    expect(zoneNameIn(WINTER, CHICAGO)).not.toBe(zoneNameIn(SUMMER, CHICAGO));
  });

  it('the miles as the popup prints them: "arriving" under 10, none when unknown', () => {
    expect(etaLine(withEta(WINTER, { milesRemaining: 6 }), false)).toEqual({ text: expect.stringMatching(/ · arriving$/) });
    expect(etaLine(withEta(WINTER, { milesRemaining: null }), false)).toEqual({
      text: `Truck 101 · Joliet, IL · ETA ${clock(WINTER)} ${zoneNameIn(WINTER, CHICAGO)}`,
    });
  });

  it('refuses on a stale feed, as the banner says not to quote one', () => {
    expect(etaLine(withEta(WINTER), true)).toEqual({ refused: FEED_DOWN_REFUSAL });
  });

  it('refuses where there is no ETA: arrived, no appointment, an address not located', () => {
    for (const absence of ['arrived', 'no-appointment', 'address-not-located'] as const) {
      expect(etaLine(withEta(WINTER, { etaAbsence: absence }), false)).toEqual({ refused: 'Truck 101 has no ETA to copy.' });
    }
  });
});

let root: Root;
let container: HTMLDivElement;
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const mount = (row: FleetRow, feedStale: boolean) =>
  act(() => {
    root.render(
      <MapPopup row={row} fetchedAt={new Date().toISOString()} feedStale={feedStale} onEdit={() => {}} onTimeline={() => {}} onClose={() => {}} />,
    );
  });
const button = () => container.querySelector<HTMLButtonElement>('[data-copy-eta]');
const note = () => container.querySelector('[data-eta-copy-note]')?.textContent ?? null;
const press = async () => {
  await act(async () => button()!.click());
  await act(async () => Promise.resolve());
};

describe('Copy ETA in the popup (QoL 14)', () => {
  it('copies the line and says Copied', async () => {
    mount(withEta(WINTER), false);
    await press();
    expect(writeText).toHaveBeenCalledWith(LINE());
    expect(button()!.textContent).toBe('✓ Copied');
    expect(note()).toBeNull();
  });

  it('on a stale feed it copies nothing and says why', async () => {
    mount(withEta(WINTER), true);
    await press();
    expect(writeText).not.toHaveBeenCalled();
    expect(note()).toBe(FEED_DOWN_REFUSAL);
    expect(button()!.textContent).toBe('Copy ETA');
  });

  it('with no ETA it copies nothing and says why', async () => {
    mount(withEta(WINTER, { etaAbsence: 'arrived' }), false);
    await press();
    expect(writeText).not.toHaveBeenCalled();
    expect(note()).toBe('Truck 101 has no ETA to copy.');
  });

  it('a clipboard the browser refuses is said, not silent', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    mount(withEta(WINTER), false);
    await press();
    expect(note()).toBe('This browser would not copy, so nothing was copied.');
  });

  it('a truck with no load has no button: there is no stop to quote', () => {
    mount(withEta(WINTER, { nextStop: null }), false);
    expect(button()).toBeNull();
  });
});
