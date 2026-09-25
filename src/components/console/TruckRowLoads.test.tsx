// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TruckRow } from './TruckRow';
import { fleetRow } from '@/test/fleet-row';
import type { FleetRow } from '@/server/fleet-query';

/**
 * §12.77. A truck holding more than one open load is flagged whether or not
 * the load number is shown — and the number keeps its own rule (§12.13).
 */

let container: HTMLDivElement;
let root: Root;

const mount = (row: FleetRow) => {
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

const tag = () =>
  [...container.querySelectorAll('span')].find((s) => /^\+\d+ loads?$/.test(s.textContent ?? ''));

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the +N load tag', () => {
  it('is absent on a truck holding one load, and so is the number', () => {
    mount(fleetRow({ openLoadCount: 1, nextStop: { loadNumber: '871671' } }));
    expect(tag()).toBeUndefined();
    expect(container.textContent).not.toContain('871671');
  });

  it('flags a second load even when the next stop has NO number to show', () => {
    mount(fleetRow({ openLoadCount: 2, nextStop: { loadNumber: null } }));
    expect(tag()?.textContent).toBe('+1 load');
  });

  it('sits beside the number when there is one — the number rule is unchanged', () => {
    mount(fleetRow({ openLoadCount: 2, nextStop: { city: 'Elwood', state: 'IL', loadNumber: '871671' } }));
    expect(container.textContent).toContain('Elwood, IL · 871671');
    expect(tag()?.textContent).toBe('+1 load');
  });

  it('counts the others, and pluralises', () => {
    mount(fleetRow({ openLoadCount: 3 }));
    expect(tag()?.textContent).toBe('+2 loads');
  });

  it('is outside the truncating text, so a long city cannot push it into the ellipsis', () => {
    mount(fleetRow({ openLoadCount: 2, nextStop: { city: 'A Very Long Industrial Park Name' } }));
    const truncating = tag()?.parentElement?.querySelector('.truncate');
    expect(truncating).not.toBeNull();
    expect(truncating?.contains(tag()!)).toBe(false);
  });

  it('is named in the cell tooltip', () => {
    mount(fleetRow({ openLoadCount: 2 }));
    const cell = tag()?.parentElement;
    expect(cell?.getAttribute('title')).toContain('1 more open load on this truck');
  });
});
