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
  it('lists one row per shape, Unassigned last', () => {
    expect(rows().map((r) => r.textContent)).toEqual([
      'Late',
      'At risk',
      'On time',
      'Arrived',
      'Tomorrow',
      'Data issue',
      'Unassigned',
    ]);
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
    expect(rowFor('Tomorrow')?.querySelector('path')).toBeNull();
  });
});
