// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fleetRow } from '@/test/fleet-row';
import { STATUS_DEFAULTS } from '@/lib/status';
import { isMovingFix } from '@/lib/moving';
import { applyStatus, type FleetRow } from '@/server/fleet-query';
import { FilterChips, inactiveMoving, type FilterKey } from './FilterChips';

/**
 * §12.151. The Inactive chip says how many inactive trucks are moving — in
 * practice the ones an admin switched off, since the worker switches the
 * rest on. Moving: newest fix above 3 mph, and not stale (45 min).
 */

const NOW = new Date('2026-11-10T18:00:00.000Z');
const CONFIG = { ...STATUS_DEFAULTS, dispatchTz: 'America/Chicago' };
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

let n = 0;
const truck = (over: {
  active: boolean;
  speedMph: number | null;
  recordedAt: string | null;
}): FleetRow => {
  n += 1;
  return fleetRow({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    truckNumber: 500 + n,
    nextStop: null,
    ...over,
  });
};

/** Rows as the console receives them: through the engine, at NOW. */
const board = (rows: FleetRow[]) => applyStatus(rows, CONFIG, NOW);

describe('isMovingFix', () => {
  it('is moving above 3 mph on a fresh fix', () => {
    expect(isMovingFix(40, minutesAgo(1), 45, NOW)).toBe(true);
    expect(isMovingFix(3.1, minutesAgo(1), 45, NOW)).toBe(true);
  });

  it('is not moving at 0, at exactly 3 mph, or with no speed', () => {
    expect(isMovingFix(0, minutesAgo(1), 45, NOW)).toBe(false);
    expect(isMovingFix(3, minutesAgo(1), 45, NOW)).toBe(false);
    expect(isMovingFix(null, minutesAgo(1), 45, NOW)).toBe(false);
  });

  it('is not moving on a stale fix: 46 minutes old at 40 mph, or no fix at all', () => {
    expect(isMovingFix(40, minutesAgo(46), 45, NOW)).toBe(false);
    expect(isMovingFix(40, null, 45, NOW)).toBe(false);
    // Exactly 45 minutes is not yet stale, as for STALE_GPS.
    expect(isMovingFix(40, minutesAgo(45), 45, NOW)).toBe(true);
  });
});

describe('applyStatus sets moving', () => {
  it('from the newest fix and the stale rule, active or not', () => {
    const rows = board([
      truck({ active: false, speedMph: 40, recordedAt: minutesAgo(2) }),
      truck({ active: false, speedMph: 40, recordedAt: minutesAgo(46) }),
      truck({ active: true, speedMph: 62, recordedAt: minutesAgo(1) }),
      truck({ active: false, speedMph: 3, recordedAt: minutesAgo(1) }),
    ]);
    expect(rows.map((r) => r.moving)).toEqual([true, false, true, false]);
    expect(inactiveMoving(rows)).toBe(1);
  });
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(rows: FleetRow[]): HTMLButtonElement {
  act(() => {
    root.render(
      createElement(FilterChips, {
        rows,
        selected: new Set<FilterKey>(),
        onToggle: () => {},
        onReset: () => {},
      }),
    );
  });
  const chip = [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.startsWith('Inactive'),
  );
  if (!chip) throw new Error('no Inactive chip');
  return chip;
}

describe('the Inactive chip (§12.151)', () => {
  it('shows nothing new with 0 moving', () => {
    const chip = render(
      board([
        truck({ active: false, speedMph: 0, recordedAt: minutesAgo(1) }),
        truck({ active: false, speedMph: 3, recordedAt: minutesAgo(1) }),
        truck({ active: true, speedMph: 62, recordedAt: minutesAgo(1) }),
      ]),
    );
    expect(chip.querySelector('[data-chip-note]')).toBeNull();
    expect(chip.textContent).not.toContain('moving');
    expect(chip.title).toBe('Inactive · key 7');
  });

  it('shows "· 1 moving" for one admin-hidden truck on the road', () => {
    const chip = render(
      board([
        truck({ active: false, speedMph: 40, recordedAt: minutesAgo(1) }),
        truck({ active: false, speedMph: 0, recordedAt: minutesAgo(1) }),
        truck({ active: false, speedMph: 0, recordedAt: minutesAgo(1) }),
      ]),
    );
    expect(chip.querySelector('[data-chip-note]')?.textContent).toBe('· 1 moving');
    expect(chip.title).toBe('Inactive · key 7 · 1 moving');
  });

  it('does not count a stale fix: 40 mph, 46 minutes old', () => {
    const chip = render(
      board([truck({ active: false, speedMph: 40, recordedAt: minutesAgo(46) })]),
    );
    expect(chip.querySelector('[data-chip-note]')).toBeNull();
  });

  it('does not count an active truck that is moving', () => {
    const chip = render(
      board([truck({ active: true, speedMph: 62, recordedAt: minutesAgo(1) })]),
    );
    expect(chip.querySelector('[data-chip-note]')).toBeNull();
  });
});
