// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MarkerKey } from './MapChrome';

/**
 * The marker key (§9.3). What it lists, and that Unassigned's row shows the
 * shape that tells it apart from Tomorrow (§13.4) rather than a second ring.
 */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<MarkerKey />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const rows = () =>
  [...container.querySelectorAll('span')].filter((s) => s.querySelector('svg'));
const rowFor = (label: string) => rows().find((r) => r.textContent === label);

describe('the marker key', () => {
  /**
   * Eight rows for eight markers, each under its own status label. There used
   * to be a "Data issue" row drawing one shape and standing for three.
   */
  it('lists one row per marker, the neutral three in urgency order', () => {
    expect(rows().map((r) => r.textContent)).toEqual([
      'Late',
      'At risk',
      'On time',
      'Arrived',
      // §12.82: the bucket's name. The marker is unchanged.
      'Upcoming',
      'Stale GPS',
      'Unassigned',
      'No appt',
    ]);
  });

  /**
   * At 14px the `?` is two pixels tall; what still separates No appt from
   * its neighbours at 1x is a DASHED ring (not Stale GPS's dotted one, not a
   * solid one) with a mark inside it. Both halves are held.
   */
  it("draws No appt's dashed ring and its question mark", () => {
    const row = rowFor('No appt');
    const ring = row?.querySelector('circle[stroke-dasharray]');
    expect(ring?.getAttribute('stroke-dasharray')).toBe('3 2.6');
    expect(row?.querySelector('path')?.getAttribute('d')).toBe(
      'M10.55 12A1.7 1.7 0 1 1 13.02 13.51M13 13.4V14.4',
    );
    expect(row?.querySelector('circle[r="0.6"]')).not.toBeNull();
  });

  /**
   * The key used to draw Stale GPS as a dotted ring alone, which is not the
   * marker and at 1x sat one dash length from No appt. The hatch is the six
   * chords of markers.ts's pattern that cross the disc.
   */
  it("draws Stale GPS as the marker does: hatched, with a dotted edge", () => {
    const row = rowFor('Stale GPS');
    expect(row?.querySelector('circle[stroke-dasharray]')?.getAttribute('stroke-dasharray')).toBe(
      '1.5 2.2',
    );
    const hatch = row?.querySelector('path')?.getAttribute('d') ?? '';
    expect(hatch.match(/M/g)).toHaveLength(6);
  });

  /**
   * The slash IS the distinction. A row that drew only the ring would be
   * Tomorrow's swatch with a different label — the §13.4 problem, reproduced
   * in the one place meant to explain it.
   */
  it("draws Unassigned's slash through its ring, and Tomorrow has none", () => {
    const slash = rowFor('Unassigned')?.querySelector('path');
    expect(slash?.getAttribute('d')).toBe('M7.91 7.91 18.09 18.09');
    expect(rowFor('Unassigned')?.querySelector('circle')).not.toBeNull();
    expect(rowFor('Upcoming')?.querySelector('path')).toBeNull();
  });
});
