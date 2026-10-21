// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReassignConfirm } from './ReassignConfirm';
import type { PreviewSide, ReassignPreview } from '@/server/reassign';

/**
 * §9.10's confirm, rendered. Nothing rendered it before 3am, which is how its
 * "From" and "Was" names went unstruck: the strike was on a wrapper that does
 * not reach into DriverName's inline-flex box (§12.133). Invented names only.
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const side = (over: Partial<PreviewSide>): PreviewSide => ({
  truckId: 't-1',
  truckLabel: '310',
  driverId: 'd-1',
  driverName: 'Samsara Sam',
  driverSource: 'samsara',
  driverSamsaraId: 'sam-1',
  nextApptUtc: null,
  nextApptTz: null,
  ...over,
});

function render(preview: Partial<ReassignPreview>) {
  act(() =>
    root!.render(
      createElement(ReassignConfirm, {
        busy: false,
        onCancel: vi.fn(),
        onConfirm: vi.fn(),
        preview: {
          gaining: { ...side({}), toDriverId: 'd-2', toDriverName: 'Hand Entered Hal' },
          losing: side({
            truckId: 't-2',
            truckLabel: '304',
            driverId: 'd-2',
            driverName: 'Hand Entered Hal',
            driverSource: 'app',
            driverSamsaraId: null,
          }),
          summary: 'Reassigns 310 from Samsara Sam to Hand Entered Hal.',
          note: 'Nothing is sent to either driver.',
          token: 'tok',
          ...preview,
        },
      }),
    ),
  );
  return container!;
}

/** The value cell of the line labelled `label`. */
const line = (label: string) =>
  [...container!.querySelectorAll('p')].find((p) => p.firstElementChild?.textContent === label)!
    .lastElementChild!;

describe('the confirm strikes the drivers being replaced (§9.10, §12.133)', () => {
  it('strikes the gaining truck’s old driver on the name itself', () => {
    render({});
    const struck = line('From').querySelector('.line-through');
    expect(struck?.textContent).toBe('Samsara Sam');
    // The name's own element, not a wrapper around DriverName: a wrapper's
    // strike does not reach into its inline-flex box in a browser.
    expect(struck!.children).toHaveLength(0);
  });

  it('strikes the losing truck’s driver, and not their No ELD tag', () => {
    render({});
    expect(line('Was').querySelector('.line-through')?.textContent).toBe('Hand Entered Hal');
    const tag = line('Was').querySelector('[title*="not in Samsara"]');
    expect(tag).not.toBeNull();
    expect(tag!.closest('.line-through')).toBeNull();
  });

  it('strikes "Unassigned" when the gaining truck had nobody', () => {
    render({
      gaining: {
        ...side({ driverId: null, driverName: null, driverSource: null, driverSamsaraId: null }),
        toDriverId: 'd-2',
        toDriverName: 'Hand Entered Hal',
      },
      losing: null,
    });
    expect(line('From').querySelector('.line-through')?.textContent).toBe('Unassigned');
  });

  it('leaves "To" and "Becomes" unstruck', () => {
    render({});
    expect(line('To').querySelector('.line-through')).toBeNull();
    expect(line('Becomes').querySelector('.line-through')).toBeNull();
  });
});

describe('the confirm says where a move is undone', () => {
  it('points at the assignment board, not at a history that "ships in v2"', () => {
    render({});
    expect(container!.textContent).toContain('You can change it back on the assignment board.');
    expect(container!.textContent).not.toContain('ships in v2');
  });

  it('keeps its own line when no other truck is affected', () => {
    render({ losing: null });
    expect(container!.textContent).toContain('Reversible by clearing the driver again.');
  });
});
