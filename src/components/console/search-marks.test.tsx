// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TruckRow } from './TruckRow';
import { searchHint } from './search-hint';
import { fleetRow, nextStop } from '@/test/fleet-row';
import { matches } from '@/lib/search';
import type { FleetRow } from '@/server/fleet-query';

/**
 * Phase 3bw, QoL feature 10 (§12.163). Search marks what matched, everywhere it matched: the
 * truck number, a cell matched whole, and the field the row does not show when that is where
 * the match was. The factory's row is truck 137, driver Sam Driver, in Chicago, with its next
 * stop at 1 Broadway, Chicago, IL 60601, load LD-4417.
 */

let container: HTMLDivElement;
let root: Root;

const mount = (row: FleetRow, query: string, columns: 6 | 8 = 8) => {
  act(() => {
    root.render(
      <TruckRow
        row={row}
        fetchedAt="2026-09-18T12:00:00.000Z"
        feedStale={false}
        columns={columns}
        density="comfortable"
        selected={false}
        checked={false}
        onCheck={() => {}}
        flash={null}
        reducedMotion={false}
        pinned={false}
        onPin={() => {}}
        query={query}
        onSelect={() => {}}
        onEdit={() => {}}
      />,
    );
  });
};

/** Every marked run on the row, in order. */
const marks = () => [...container.querySelectorAll('.bg-highlight')].map((el) => el.textContent);
const hint = () => container.querySelector('[data-search-hint]')?.textContent ?? null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('search marks on the row (QoL 10)', () => {
  it('the truck number is marked, matched whole', () => {
    mount(fleetRow(), '137');
    expect(marks()).toEqual(['137']);
    expect(hint()).toBeNull();
  });

  it('the truck number is marked where part of it matched', () => {
    mount(fleetRow(), '13');
    expect(marks()).toContain('13');
  });

  it('a cell matched whole is marked, not left plain: the driver', () => {
    mount(fleetRow(), 'sam driver');
    expect(marks()).toEqual(['Sam Driver']);
  });

  it('a ZIP the row does not show: the ZIP is shown, marked, first in the next-stop cell', () => {
    mount(fleetRow(), '60601');
    expect(hint()).toBe('ZIP 60601 · ');
    expect(marks()).toEqual(['60601']);
  });

  it('a load number the row does not show (one open load): the load is shown, marked', () => {
    mount(fleetRow({ openLoadCount: 1 }), 'ld-44');
    expect(hint()).toBe('Load LD-4417 · ');
    expect(marks()).toEqual(['LD-44']);
  });

  it('a load number the row already shows (two open loads): no hint, the number is marked in place', () => {
    mount(fleetRow({ openLoadCount: 2 }), 'ld-44');
    expect(hint()).toBeNull();
    expect(marks()).toEqual(['LD-44']);
  });

  it('a street: the street is shown, marked', () => {
    mount(fleetRow(), 'broadway');
    expect(hint()).toBe('Street 1 Broadway · ');
    expect(marks()).toEqual(['Broadway']);
  });

  it('a match the row shows already: no hint', () => {
    mount(fleetRow(), 'chicago');
    expect(hint()).toBeNull();
    expect(marks().length).toBeGreaterThan(0);
  });

  it('the position: marked in its column at eight columns, a hint at six, where its column is cut', () => {
    const row = fleetRow({ cityState: 'Joliet, IL', formattedLocation: '9 Mill Rd, Joliet, IL' });
    mount(row, 'joliet', 8);
    expect(hint()).toBeNull();
    expect(marks()).toEqual(['Joliet']);
    mount(row, 'joliet', 6);
    expect(hint()).toBe('Position Joliet, IL · ');
  });

  it('a hint on a truck with no next stop sits before the dash', () => {
    mount(fleetRow({ nextStop: null, cityState: 'Joliet, IL' }), 'joliet', 6);
    expect(hint()).toBe('Position Joliet, IL · ');
  });

  it('no query, no marks and no hint', () => {
    mount(fleetRow(), '');
    expect(marks()).toEqual([]);
    expect(hint()).toBeNull();
  });

  /**
   * The rule the feature exists for: a row in a searched list always shows why. Every
   * substring of every searched field, on rows of both widths: if the search keeps the row,
   * something on it is marked.
   */
  it('a row the search keeps always carries a mark, at either width', () => {
    const rows = [
      fleetRow(),
      fleetRow({ truckNumber: null, samsaraName: 'Yard Mule', driverName: null }),
      fleetRow({ cityState: 'Joliet, IL', formattedLocation: '9 Mill Rd, Joliet, IL', nextStop: nextStop({ addressLine: '77 Depot St', city: 'Tulsa', state: 'OK', zip: '74103', loadNumber: 'BR-9' }) }),
    ];
    let checked = 0;
    for (const row of rows) {
      const fields = [
        row.truckNumber === null ? '' : String(row.truckNumber),
        row.samsaraName,
        row.driverName ?? '',
        row.cityState ?? '',
        row.formattedLocation ?? '',
        row.nextStop?.loadNumber ?? '',
        row.nextStop?.addressLine ?? '',
        row.nextStop?.city ?? '',
        row.nextStop?.state ?? '',
        row.nextStop?.zip ?? '',
      ].filter((f) => f.length >= 3);
      for (const field of fields) {
        const query = field.slice(1, Math.min(field.length, 6));
        if (!matches(row, query)) continue;
        for (const columns of [6, 8] as const) {
          mount(row, query, columns);
          expect(marks().length, `${row.samsaraName} at ${columns} columns, query "${query}"`).toBeGreaterThan(0);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(30);
  });
});

describe('searchHint, the rule alone', () => {
  it('names the first hidden field that matched, in a fixed order', () => {
    const row = fleetRow();
    expect(searchHint(row, '60601', ['137', 'Sam Driver', 'Chicago, IL', 'Chicago, IL'], true)).toEqual({ label: 'ZIP', text: '60601' });
    expect(searchHint(row, 'chicago', ['137', 'Sam Driver', 'Chicago, IL', 'Chicago, IL'], true)).toBeNull();
    expect(searchHint(row, '   ', ['137'], true)).toBeNull();
  });
});
