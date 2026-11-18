// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BasemapToggle, ShowAllControl, TopControls } from './MapChrome';

/**
 * §12.149, and phase 3bx's QoL 7 (§12.164). The basemap toggle's box is a segment slide's host,
 * so it is `relative isolate`, as `useSegmentSlide` asks: the slide's overlay is `absolute -z-10`,
 * measured from the box's own buttons, and drawn over the box's ground and under its words only
 * in a stacking context of the box's own. Before 3bx the box met that by being `absolute z-10`
 * itself; 3bx moved that placement up to `TopControls`, and the overlay then painted under the
 * box's ground for the whole slide (new-motion.spec's "the basemap control" check caught it).
 * The density control and the phone tabs carry `relative isolate` in their own class lists.
 */

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

describe('the basemap toggle as a segment slide host', () => {
  it('is relative and isolated where the map draws it, in the top controls beside Show all', () => {
    act(() => {
      root.render(
        <TopControls>
          <ShowAllControl disabledReason={null} onShowAll={() => {}} />
          <BasemapToggle basemap="dark" onChange={() => {}} />
        </TopControls>,
      );
    });
    const box = host.querySelector<HTMLElement>('[role="group"][aria-label="Basemap"]')!;
    expect(box).not.toBeNull();
    expect(box.classList.contains('relative')).toBe(true);
    expect(box.classList.contains('isolate')).toBe(true);
    // Its own buttons are what the slide measures from: inside the box, marked.
    expect([...box.querySelectorAll('[data-segment]')].map((b) => b.getAttribute('data-segment'))).toEqual(
      expect.arrayContaining(['dark', 'satellite']),
    );
  });
});
