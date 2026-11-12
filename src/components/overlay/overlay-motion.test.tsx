// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CommandPalette } from './CommandPalette';
import { OnboardingTour } from './OnboardingTour';
import { OverlayProvider } from './OverlayLayer';
import { ShortcutSheet } from './ShortcutSheet';
import { TOUR } from '@/lib/tour';
import { recordAnimations, reduceMotion, type Played } from '@/test/animations';
import type { PaletteTruck } from '@/lib/palette';

/**
 * §12.152, the two small motions in windows: the palette's results on each key, and a tour
 * step on Next and Back. Each starts on its cause, at its own length written out, and on
 * nothing else: not the window's opening, not the cursor, not new data.
 */

const truck = (n: number, city: string): PaletteTruck => ({
  id: `t${n}`,
  truckNumber: n,
  samsaraName: `Truck #${n}`,
  driverName: null,
  cityState: city,
  nextStop: null,
  formattedLocation: null,
});
const TRUCKS = [truck(101, 'Joliet, IL'), truck(202, 'Fargo, ND')];

let container: HTMLDivElement;
let root: Root;
let recorder: ReturnType<typeof recordAnimations>;
let unreduce: (() => void) | null = null;
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
  recorder = recordAnimations();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  recorder.restore();
  unreduce?.();
  unreduce = null;
});

const shape = (p: Played) => ({ keyframes: p.keyframes, ...p.options });
const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  });
const button = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
const click = (text: string) =>
  act(() => {
    button(text).click();
  });

describe('palResults: the palette’s results', () => {
  const renderPalette = (trucks = TRUCKS) =>
    act(() => {
      root.render(
        <OverlayProvider>
          <CommandPalette
            trucks={trucks}
            views={[]}
            selectedLabel={null}
            selectedPinned={false}
            density="comfortable"
            onSelectTruck={() => {}}
            onApplyView={() => {}}
            onTogglePin={() => {}}
            onToggleDensity={() => {}}
          />
        </OverlayProvider>,
      );
    });
  const field = () => container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  const list = () => container.querySelector('[role="listbox"]');
  const type = (value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(field(), value);
      field().dispatchEvent(new Event('input', { bubbles: true }));
    });
  const arrow = () =>
    act(() => {
      field().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });

  it('a key in the box: the list fades in, opacity only, 180ms linear', () => {
    renderPalette();
    press('k', { metaKey: true });
    type('f');
    expect(recorder.played.filter((p) => p.el === list()).map(shape)).toEqual([
      { keyframes: [{ opacity: 0 }, { opacity: 1 }], duration: 180, easing: 'linear' },
    ]);
  });

  it('every key starts it again, and ends the one before', () => {
    renderPalette();
    press('k', { metaKey: true });
    type('f');
    type('fa');
    const fades = recorder.played.filter((p) => p.el === list());
    expect(fades).toHaveLength(2);
    expect(fades[0]!.animation.playState).toBe('idle');
    expect(fades[1]!.animation.playState).toBe('running');
  });

  it('opening it, the arrow keys and new trucks fade nothing', () => {
    renderPalette();
    press('k', { metaKey: true });
    arrow();
    renderPalette([...TRUCKS, truck(303, 'Tulsa, OK')]);
    expect(list()).not.toBeNull();
    expect(recorder.played.filter((p) => p.el === list())).toEqual([]);
  });

  it('under reduced motion the results change and nothing starts', () => {
    unreduce = reduceMotion();
    renderPalette();
    press('k', { metaKey: true });
    type('f');
    expect(list()?.textContent).toContain('Fargo');
    expect(recorder.played).toEqual([]);
  });
});

describe('tour: the tour’s steps', () => {
  const renderTour = () =>
    act(() => {
      root.render(
        <OverlayProvider>
          <OnboardingTour />
          <ShortcutSheet />
        </OverlayProvider>,
      );
    });
  const step = () => container.querySelector('[data-tour-step]');
  const slides = () => recorder.played.filter((p) => p.el.hasAttribute('data-tour-step'));

  it('Next: the next step comes 28px from the right, 270ms, inside a box that clips it sideways', () => {
    renderTour();
    click('Next');
    expect(step()?.getAttribute('data-tour-step')).toBe(TOUR[1]!.id);
    expect(slides().map(shape)).toEqual([
      {
        keyframes: [
          { opacity: 0, translate: '28px 0' },
          { opacity: 1, translate: '0 0' },
        ],
        duration: 270,
        easing: 'cubic-bezier(.22,.61,.36,1)',
      },
    ]);
    expect(slides()[0]!.el).toBe(step());
    const box = step()!.parentElement!;
    expect(box.style.overflowX).toBe('clip');
    act(() => recorder.finishAll());
    expect(box.getAttribute('style')).toBeNull();
  });

  it('Back: from the left', () => {
    renderTour();
    click('Next');
    click('Back');
    expect(slides().map((p) => p.keyframes[0])).toEqual([
      { opacity: 0, translate: '28px 0' },
      { opacity: 0, translate: '-28px 0' },
    ]);
  });

  it('opening by itself plays no step', () => {
    renderTour();
    expect(step()?.getAttribute('data-tour-step')).toBe(TOUR[0]!.id);
    expect(slides()).toEqual([]);
  });

  it('opened again after closing on a later step: the reset to the first step slides nothing', () => {
    renderTour();
    click('Next');
    click('Next');
    click('Skip');
    const before = slides().length;
    press('?');
    click('Take the tour again');
    expect(step()?.getAttribute('data-tour-step')).toBe(TOUR[0]!.id);
    expect(slides()).toHaveLength(before);
  });

  it('a re-render on the same step plays nothing', () => {
    renderTour();
    click('Next');
    renderTour();
    renderTour();
    expect(slides()).toHaveLength(1);
  });

  it('under reduced motion the words change and nothing starts', () => {
    unreduce = reduceMotion();
    renderTour();
    click('Next');
    expect(step()?.getAttribute('data-tour-step')).toBe(TOUR[1]!.id);
    expect(recorder.played).toEqual([]);
  });
});
