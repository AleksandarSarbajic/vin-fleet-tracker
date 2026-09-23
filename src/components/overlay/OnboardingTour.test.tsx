// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OnboardingTour } from './OnboardingTour';
import { ShortcutSheet } from './ShortcutSheet';
import { OverlayProvider } from './OverlayLayer';
import { TOUR, TOUR_STORAGE_KEY, TOUR_VERSION } from '@/lib/tour';

/**
 * §14 feature 12. `tour.test.ts` owns the content and the auto-open rule;
 * this owns the two things that are about the layer it lives on.
 */

let container: HTMLDivElement;
let root: Root;
const store = new Map<string, string>();

const render = () => {
  act(() => {
    root.render(
      <OverlayProvider>
        <OnboardingTour />
        <ShortcutSheet />
      </OverlayProvider>,
    );
  });
};

const panel = () => container.querySelector('[aria-label="What this console does"]');
const sheet = () => container.querySelector('[aria-label="Keyboard shortcuts"]');
const button = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
const click = (el: Element | undefined) => {
  expect(el).toBeDefined();
  act(() => {
    (el as HTMLElement).click();
  });
};

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
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('showing itself', () => {
  it('opens on a first visit', () => {
    render();
    expect(panel()).not.toBeNull();
    expect(container.textContent).toContain(TOUR[0]!.title);
  });

  it('stays shut once it has been seen', () => {
    store.set(TOUR_STORAGE_KEY, String(TOUR_VERSION));
    render();
    expect(panel()).toBeNull();
  });

  /**
   * Skipping counts as seen. Only crediting "Done" means someone who closes
   * it gets it again next load, which teaches them to close it faster rather
   * than to read it.
   */
  it('counts being skipped as having been seen', () => {
    render();
    click(button('Skip'));
    expect(panel()).toBeNull();
    expect(store.get(TOUR_STORAGE_KEY)).toBe(String(TOUR_VERSION));
  });

  it('counts being finished as having been seen', () => {
    render();
    for (let i = 0; i < TOUR.length - 1; i += 1) click(button('Next'));
    click(button('Done'));
    expect(store.get(TOUR_STORAGE_KEY)).toBe(String(TOUR_VERSION));
  });
});

describe('moving through it', () => {
  it('walks forward and back without losing its place', () => {
    render();
    click(button('Next'));
    expect(container.textContent).toContain(TOUR[1]!.title);
    click(button('Back'));
    expect(container.textContent).toContain(TOUR[0]!.title);
  });

  it('offers no Back on the first step', () => {
    render();
    expect(button('Back')).toBeUndefined();
  });

  it('ends with Done rather than another Next', () => {
    render();
    for (let i = 0; i < TOUR.length - 1; i += 1) click(button('Next'));
    expect(button('Next')).toBeUndefined();
    expect(button('Done')).toBeDefined();
  });

  it('starts from the first step when it is reopened', () => {
    render();
    click(button('Next'));
    click(button('Skip'));
    // Reopened from the sheet — the only way back in.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    });
    click(button('Take the tour again'));
    expect(container.textContent).toContain(TOUR[0]!.title);
  });
});

describe('the shared layer (§14.5)', () => {
  /**
   * "Only one open at a time" is the layer's whole point, and it is what
   * decided the tour's shape: a spotlight cutting a hole in the scrim cannot
   * share a scrim.
   */
  it('is not interrupted by a stray ? while it is open', () => {
    render();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    });
    // The sheet's binding stands down while any other overlay is open, so the
    // tour keeps the layer instead of two panels fighting for one scrim.
    expect(sheet()).toBeNull();
    expect(panel()).not.toBeNull();
  });

  it('hands the layer over when another overlay opens', () => {
    store.set(TOUR_STORAGE_KEY, String(TOUR_VERSION));
    render();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    });
    expect(sheet()).not.toBeNull();
    click(button('Take the tour again'));
    expect(panel()).not.toBeNull();
    expect(sheet()).toBeNull();
  });
});
