// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FILTER_KEYS, FilterChips, chipCounts, hiddenAsDriverless, passesFilters, type FilterKey } from './FilterChips';
import { fleetRow } from '@/test/fleet-row';
import { VIEW_STORAGE_KEY, readViews, sameView } from '@/lib/views';

/**
 * §12.78. Drivers only: an AND over the other chips that hides trucks with no
 * driver AND nothing waiting on one — and never an UNASSIGNED truck, which is
 * a load that needs a driver before its deadline.
 */

const withDriver = fleetRow({ id: 'a', driverName: 'Sam Driver', status: 'LATE', computed: 'LATE' });
const parked = fleetRow({ id: 'b', driverName: null, status: 'NO_APPT', computed: 'NO_APPT' });
const needsDriver = fleetRow({ id: 'c', driverName: null, status: 'UNASSIGNED', computed: 'UNASSIGNED' });
/** A forced status on a truck that is really UNASSIGNED must not hide it. */
const forced = fleetRow({ id: 'd', driverName: null, status: 'LATE', computed: 'UNASSIGNED' });
const arrivedNoDriver = fleetRow({ id: 'e', driverName: null, status: 'ARRIVED', computed: 'ARRIVED' });
const inactiveParked = fleetRow({ id: 'f', driverName: null, status: 'NO_APPT', computed: 'NO_APPT', active: false });
const ROWS = [withDriver, parked, needsDriver, forced, arrivedNoDriver, inactiveParked];

const ids = (selected: FilterKey[]) =>
  ROWS.filter((r) => passesFilters(r, new Set(selected))).map((r) => r.id);

describe('what Drivers only hides', () => {
  it('hides a driverless truck with nothing waiting, and nothing else', () => {
    expect(hiddenAsDriverless(parked)).toBe(true);
    expect(hiddenAsDriverless(arrivedNoDriver)).toBe(true);
    expect(hiddenAsDriverless(withDriver)).toBe(false);
  });

  it('never hides an UNASSIGNED truck — not even under a forced status', () => {
    expect(hiddenAsDriverless(needsDriver)).toBe(false);
    expect(hiddenAsDriverless(forced)).toBe(false);
    expect(ids(['drivers'])).toEqual(['a', 'c', 'd']);
  });

  it('is off by default: the plain view still lists the parked driverless truck', () => {
    expect(ids([])).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('it combines with the other chips by AND', () => {
  it('Data issues + Drivers only keeps the Unassigned truck, drops the parked one', () => {
    expect(ids(['data'])).toEqual(['b', 'c']);
    expect(ids(['data', 'drivers'])).toEqual(['c']);
  });

  it('Late + Drivers only', () => {
    expect(ids(['late', 'drivers'])).toEqual(['a', 'd']);
  });

  it('Inactive + Drivers only still honours the inactive axis', () => {
    expect(ids(['inactive'])).toEqual(['f']);
    expect(ids(['inactive', 'drivers'])).toEqual([]);
  });
});

describe('the counts stay fleet-wide', () => {
  it('reads every chip the same whether or not Drivers only is on', () => {
    const counts = chipCounts(ROWS);
    expect(counts.data).toBe(2);
    expect(counts.late).toBe(2);
    // What Drivers only alone would list among ACTIVE trucks.
    expect(counts.drivers).toBe(3);
  });
});

describe('the chip', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (selected: FilterKey[], onToggle = vi.fn()) => {
    act(() =>
      root.render(
        <FilterChips rows={ROWS} selected={new Set(selected)} onToggle={onToggle} onReset={vi.fn()} />,
      ),
    );
    return onToggle;
  };
  const buttons = () => [...container.querySelectorAll('button')];

  it('comes last, after Inactive, behind a divider', () => {
    render([]);
    const labels = buttons().map((b) => b.textContent ?? '');
    // §12.82: the future-day bucket is named for what it holds.
    expect(labels.some((l) => l.startsWith('Upcoming'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Tomorrow'))).toBe(false);
    expect(labels.at(-2)).toContain('Inactive');
    expect(labels.at(-1)).toContain('Drivers only');
    const divider = container.querySelector('[data-chip-divider]');
    expect(divider?.nextElementSibling?.textContent).toContain('Drivers only');
    expect(divider?.previousElementSibling?.textContent).toContain('Inactive');
  });

  it('toggles on 8', () => {
    const onToggle = render([]);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '8' }));
    });
    expect(onToggle).toHaveBeenCalledWith('drivers');
  });

  it('shows as pressed when on', () => {
    render(['drivers']);
    const chip = buttons().at(-1)!;
    expect(chip.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('saved views carry it, and default it off', () => {
  // The same in-memory stub lib/views.test.ts uses: this runner has no
  // localStorage of its own.
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
        key: () => null,
        length: 0,
      },
    });
  });

  it('round-trips a view saved with Drivers only on', () => {
    localStorage.setItem(
      VIEW_STORAGE_KEY,
      JSON.stringify([{ id: 'v1', name: 'Mine', query: '', chips: ['late', 'drivers'] }]),
    );
    expect(readViews(FILTER_KEYS)[0]?.chips).toEqual(['late', 'drivers']);
  });

  it('reads a view saved before it existed as OFF', () => {
    localStorage.setItem(
      VIEW_STORAGE_KEY,
      JSON.stringify([{ id: 'v1', name: 'Old', query: '', chips: ['late'] }]),
    );
    const [view] = readViews(FILTER_KEYS);
    expect(view?.chips).not.toContain('drivers');
    // And it is a DIFFERENT view from the same chips with Drivers only on.
    expect(sameView({ query: '', chips: ['late'] }, { query: '', chips: ['late', 'drivers'] })).toBe(false);
  });
});
