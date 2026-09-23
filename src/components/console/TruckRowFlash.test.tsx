// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TruckRow } from './TruckRow';
import { fleetRow } from '@/test/fleet-row';
import { flashView, type RowFlashView } from '@/lib/flash';

/**
 * §14 feature 6, and specifically the half of §14.4 that is easiest to lose:
 *
 * > Under reduced motion everything becomes 0ms, and the flash is replaced by
 * > a static `◆ changed 04:11` tag for 60s. **The signal survives without the
 * > motion** — it is not simply dropped.
 *
 * The global `prefers-reduced-motion` rule in `globals.css` takes every
 * animation to 0.01ms, so a flash built only as an animation would vanish
 * there and nothing would fail. That is what these assert.
 */

const AT = Date.parse('2026-09-18T09:11:00Z');

let container: HTMLDivElement;
let root: Root;

const mount = (flash: RowFlashView | null) => {
  act(() => {
    root.render(
      <TruckRow
        row={fleetRow({ status: 'LATE' })}
        fetchedAt="2026-09-18T12:00:00.000Z"
        feedStale={false}
        columns={8}
        density="comfortable"
        selected={false}
        checked={false}
        onCheck={() => {}}
        flash={flash}
        reducedMotion={flash?.tag !== undefined && flash?.tag !== null}
        pinned={false}
        onPin={() => {}}
        query=""
        onSelect={() => {}}
        onEdit={() => {}}
      />,
    );
  });
};

const overlay = () => container.querySelector('.animate-flash');
const tag = () =>
  [...container.querySelectorAll('span')].find((s) => s.textContent?.includes('◆'));

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('with motion', () => {
  const withMotion = () =>
    flashView({ status: 'LATE', at: AT }, 'America/Chicago', false);

  it('paints the flash ground of the status it changed into', () => {
    mount(withMotion());
    expect(overlay()?.className).toContain('bg-row-flash-late');
  });

  /**
   * Behind the cells, above the row's own ground. If it ever paints over the
   * text, muted ink on a flash ground is the 4.56:1 §14.4 measured — and the
   * text would not be there to measure.
   */
  it('sits under the row content and takes no clicks', () => {
    mount(withMotion());
    expect(overlay()?.className).toContain('-z-10');
    expect(overlay()?.className).toContain('pointer-events-none');
  });

  it('does not also print the tag — the ground already said it', () => {
    mount(withMotion());
    expect(tag()).toBeUndefined();
  });

  it('gives a neutral ground to the states that share one chip colour (§5.1)', () => {
    mount(flashView({ status: 'STALE_GPS', at: AT }, 'America/Chicago', false));
    expect(overlay()?.className).toContain('bg-row-flash-neutral');
  });
});

describe('under reduced motion', () => {
  const reduced = () => flashView({ status: 'LATE', at: AT }, 'America/Chicago', true);

  it('prints the tag instead, so the change is still visible', () => {
    mount(reduced());
    // 09:11 UTC is 04:11 in Chicago on 18 September — derived, not pasted:
    // the view formatted it from the same instant this asserts against.
    expect(tag()?.textContent).toContain(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Chicago',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(AT)),
    );
  });

  it('carries the labelled time, with its zone, where it can be read in full', () => {
    mount(reduced());
    expect(tag()?.getAttribute('title')).toMatch(
      /^Status changed \d{2}:\d{2} [A-Z]{2,5}$/,
    );
  });

  it('runs no animation — 0ms means the ground never appears', () => {
    mount(reduced());
    expect(overlay()).toBeNull();
  });
});

describe('with nothing changed', () => {
  it('renders neither', () => {
    mount(null);
    expect(overlay()).toBeNull();
    expect(tag()).toBeUndefined();
  });
});
