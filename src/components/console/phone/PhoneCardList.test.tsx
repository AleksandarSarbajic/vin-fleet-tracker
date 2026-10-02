// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fleetRow } from '@/test/fleet-row';
import { PhoneCardList } from './PhoneCardList';

/**
 * §12.96, stage 2. The phone's card: truck and status on one line; driver,
 * next-stop city and the appointment on the next — the Appt cell exactly as
 * the desktop prints it. Nothing on it but the card itself.
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

const ZONE = 'America/Chicago';
const START = '2026-09-18T19:30:00.000Z';
const END = '2026-09-18T22:00:00.000Z';
/** What the desktop prints for an instant in the stop's zone, derived, not pasted. */
const local = (iso: string) =>
  `${new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: ZONE }).format(new Date(iso))}`;

function render(rows = [fleetRow()], onTap = vi.fn(), selectedId: string | null = null) {
  act(() => {
    root.render(
      <PhoneCardList
        rows={rows}
        selectedId={selectedId}
        feedStale={false}
        fetchedAt="2026-09-18T12:00:00.000Z"
        reducedMotion
        empty={null}
        onTap={onTap}
      />,
    );
  });
  return onTap;
}

const field = (name: string) =>
  container.querySelector(`[data-card-field="${name}"]`)?.textContent ?? null;

describe('a card', () => {
  it('carries the truck, its status, the driver, the city and the appointment', () => {
    render([
      fleetRow({
        truckNumber: 101,
        driverName: 'Ana Petrovic',
        status: 'LATE',
        computed: 'LATE',
        nextStop: { apptStartUtc: START, apptTz: ZONE, apptType: 'APPT' },
      }),
    ]);
    expect(field('truck')).toBe('101');
    expect(field('status')).toMatch(/late/i);
    expect(field('driver')).toBe('Ana Petrovic');
    expect(field('city')).toBe('Chicago, IL');
    expect(field('time')).toContain(local(START));
  });

  it('an FCFS stop reads "by" its closing time, as the desktop Appt cell does', () => {
    render([
      fleetRow({
        nextStop: { apptStartUtc: START, apptEndUtc: END, apptTz: ZONE, apptType: 'FCFS' },
      }),
    ]);
    expect(field('time')).toMatch(new RegExp(`^by ${local(END)}`));
  });

  it('says what is missing rather than printing a dash', () => {
    render([fleetRow({ driverName: null, nextStop: null })]);
    expect(field('driver')).toBe('No driver');
    expect(field('city')).toBe('No next stop');
    expect(field('time')).toBe('No appt');
  });

  it('is the card, and nothing else to tap: no checkbox, copy or pin button', () => {
    render();
    const card = container.querySelector('[data-phone-card]')!;
    expect(card.tagName).toBe('BUTTON');
    expect(card.querySelectorAll('button, input')).toHaveLength(0);
    // Never the desktop row's hook, so no selector for rows finds a card.
    expect(container.querySelector('[data-row-id]')).toBeNull();
  });

  it('a tap hands the truck up; the selected one says so', () => {
    const row = fleetRow();
    const onTap = render([row], vi.fn(), row.id);
    const card = container.querySelector<HTMLButtonElement>('[data-phone-card]')!;
    expect(card.getAttribute('aria-current')).toBe('true');
    act(() => card.click());
    expect(onTap).toHaveBeenCalledWith(row.id);
  });
});

describe('no cards', () => {
  it('says why, in the console’s own words', () => {
    act(() => {
      root.render(
        <PhoneCardList
          rows={[]}
          selectedId={null}
          feedStale={false}
          fetchedAt={null}
          reducedMotion
          empty={{ kind: 'search', headline: 'No trucks match “zz”', detail: 'Clear the search.', action: null }}
          onTap={vi.fn()}
        />,
      );
    });
    expect(container.textContent).toContain('No trucks match “zz”');
  });
});
