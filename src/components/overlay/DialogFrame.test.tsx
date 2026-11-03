// @vitest-environment happy-dom
import { act, StrictMode, useRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogFrame } from './DialogFrame';
import { FADING_BACKGROUND } from './dialog-motion';
import { MOTION_MS } from '@/design/tokens';
import { useFocusTrap } from '@/components/edit/useModalChrome';

/**
 * §12.148. A dialog opens with motion once, leaves nothing on itself after,
 * and closes without waiting: what fades is an empty copy of its background.
 *
 * happy-dom runs no CSS animations, so an `animationend` is dispatched by
 * hand where a test needs the opening to have finished.
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let now = 1_000;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  now = 1_000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(async () => {
  act(() => root?.unmount());
  await settle();
  document.querySelectorAll(`[${FADING_BACKGROUND}]`).forEach((n) => n.remove());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Lets the microtask that draws a fading background run. */
const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

const SCRIM = 'fixed inset-0 z-50 grid place-items-center bg-scrim p-6';
const PANEL = 'w-[560px] bg-surface-overlay';

function Frame({ label = 'Test dialog', children }: { label?: string; children?: ReactNode }) {
  return (
    <DialogFrame
      className={SCRIM}
      panelClassName={PANEL}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      {children ?? <button type="button">Confirm</button>}
    </DialogFrame>
  );
}

/** Two different component types, so swapping one for the other remounts. */
function First() {
  return <Frame label="First" />;
}
function Second() {
  return <Frame label="Second" />;
}

const render = (node: ReactNode) => act(() => root!.render(node));
const scrim = () => container!.querySelector<HTMLElement>('[role="dialog"]')!;
const panel = () => scrim().firstElementChild as HTMLElement;
const backgrounds = () => document.querySelectorAll<HTMLElement>(`[${FADING_BACKGROUND}]`);
const finishOpening = () =>
  act(() => {
    panel().dispatchEvent(new Event('animationend', { bubbles: true }));
  });

const reduceMotion = () => {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
};

describe('opening (§12.148)', () => {
  it('fades the scrim in and grows the panel in', () => {
    render(<Frame />);
    expect(scrim().className).toContain('animate-scrim-in');
    expect(panel().className).toContain('animate-dialog-in');
  });

  it('keeps the scrim and panel exactly as the dialog drew them', () => {
    render(<Frame />);
    for (const c of SCRIM.split(' ')) expect(scrim().classList).toContain(c);
    for (const c of PANEL.split(' ')) expect(panel().classList).toContain(c);
  });

  it('passes the scrim its attributes and the panel its ref', () => {
    let seen: HTMLDivElement | null = null;
    function WithRef() {
      const ref = useRef<HTMLDivElement>(null);
      return (
        <DialogFrame
          className={SCRIM}
          panelClassName={PANEL}
          panelRef={(el) => {
            ref.current = el;
            seen = el;
          }}
          role="dialog"
          aria-modal="true"
          aria-label="With ref"
          data-reopen-confirm=""
        >
          <p>Body</p>
        </DialogFrame>
      );
    }
    render(<WithRef />);
    expect(scrim().getAttribute('aria-modal')).toBe('true');
    expect(scrim().getAttribute('aria-label')).toBe('With ref');
    expect(scrim().hasAttribute('data-reopen-confirm')).toBe(true);
    expect(seen).toBe(panel());
  });

  it('leaves nothing on the window once the opening ends', () => {
    render(<Frame />);
    finishOpening();
    expect(scrim().className).not.toContain('animate-');
    expect(panel().className).not.toContain('animate-');
    expect(scrim().style.animationDelay).toBe('');
    expect(panel().style.animationDelay).toBe('');
  });

  it('is not ended by an animation inside the panel', () => {
    render(
      <Frame>
        <span data-child="">child</span>
      </Frame>,
    );
    act(() => {
      container!
        .querySelector('[data-child]')!
        .dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    expect(panel().className).toContain('animate-dialog-in');
  });

  it('does not replay on a re-render', () => {
    render(<Frame label="A" />);
    finishOpening();
    render(<Frame label="A, re-rendered" />);
    expect(panel().className).not.toContain('animate-');
  });

  it('opens with motion once under StrictMode, and leaves no background behind', async () => {
    render(
      <StrictMode>
        <Frame />
      </StrictMode>,
    );
    await settle();
    expect(panel().className).toContain('animate-dialog-in');
    expect(backgrounds()).toHaveLength(0);
  });
});

describe('a frame that replaces another plays the same opening (§12.148)', () => {
  it('takes the opening up where it stood', () => {
    render(<First />);
    now += 40;
    render(<Second />);
    expect(scrim().getAttribute('aria-label')).toBe('Second');
    expect(panel().className).toContain('animate-dialog-in');
    expect(panel().style.animationDelay).toBe('-40ms');
    expect(scrim().style.animationDelay).toBe('-40ms');
  });

  it('simply appears when the opening has finished', () => {
    render(<First />);
    now += MOTION_MS.dialogIn;
    render(<Second />);
    expect(scrim().className).not.toContain('animate-');
    expect(panel().className).not.toContain('animate-');
  });

  it('leaves no fading background, because nothing closed', async () => {
    render(<First />);
    now += MOTION_MS.dialogIn * 10;
    render(<Second />);
    await settle();
    expect(backgrounds()).toHaveLength(0);
  });

  it('is a fresh opening when the first closed in an earlier commit', async () => {
    render(<First />);
    render(null);
    await settle();
    now += 40;
    render(<Second />);
    expect(panel().className).toContain('animate-dialog-in');
    expect(panel().style.animationDelay).toBe('');
  });
});

describe('closing never waits (§12.148)', () => {
  it('removes the dialog at once', () => {
    render(<Frame />);
    render(null);
    expect(container!.querySelector('[role="dialog"]')).toBeNull();
    expect(container!.textContent).toBe('');
  });

  it('gives the focus back at once, through the trap the confirms use', () => {
    const before = document.createElement('button');
    document.body.appendChild(before);
    before.focus();
    function Trapping() {
      const trap = useFocusTrap(true);
      return (
        <DialogFrame className={SCRIM} panelClassName={PANEL} panelRef={trap} role="dialog">
          <button type="button" data-initial-focus="">
            Inside
          </button>
        </DialogFrame>
      );
    }
    render(<Trapping />);
    expect(document.activeElement?.textContent).toBe('Inside');
    render(null);
    // The same act that closed it: nothing waited for a fade.
    expect(document.activeElement).toBe(before);
    before.remove();
  });

  it('fades an empty copy of the background, which nothing can use', async () => {
    render(<Frame />);
    render(null);
    await settle();
    const fading = backgrounds();
    expect(fading).toHaveLength(1);
    const layer = fading[0]!;
    expect(layer.parentElement).toBe(document.body);
    expect(layer.childElementCount).toBe(0);
    expect(layer.textContent).toBe('');
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    expect(layer.hasAttribute('inert')).toBe(true);
    expect(layer.hasAttribute('role')).toBe(false);
    expect(layer.hasAttribute('aria-label')).toBe(false);
    expect(layer.classList).toContain('pointer-events-none');
    expect(layer.classList).toContain('animate-scrim-out');
    // The same layer and ground as the scrim it stands in for.
    expect(layer.classList).toContain('z-50');
    expect(layer.classList).toContain('bg-scrim');
    expect(layer.className).not.toContain('animate-scrim-in');
  });

  it('removes the fading background when its fade ends', async () => {
    render(<Frame />);
    render(null);
    await settle();
    backgrounds()[0]!.dispatchEvent(new Event('animationend'));
    expect(backgrounds()).toHaveLength(0);
  });

  it('removes the fading background even if its fade never reports ending', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render(<Frame />);
    render(null);
    await settle();
    expect(backgrounds()).toHaveLength(1);
    vi.advanceTimersByTime(MOTION_MS.dialogOut * 2);
    expect(backgrounds()).toHaveLength(0);
  });

  it('leaves one fading background when several dialogs close together', async () => {
    render(
      <>
        <Frame label="Under" />
        <Frame label="Over" />
      </>,
    );
    render(null);
    await settle();
    expect(backgrounds()).toHaveLength(1);
  });
});

describe('reopening during the fade (§12.148)', () => {
  it('removes the old background at once, and the new dialog opens normally', async () => {
    render(<First />);
    render(null);
    await settle();
    expect(backgrounds()).toHaveLength(1);

    now += MOTION_MS.dialogOut / 2;
    render(<Second />);
    expect(backgrounds()).toHaveLength(0);
    expect(container!.querySelectorAll('.bg-scrim')).toHaveLength(1);
    expect(panel().className).toContain('animate-dialog-in');
    expect(panel().style.animationDelay).toBe('');
  });
});

describe('reduced motion (§12.148, §8.3)', () => {
  it('opens with no motion', () => {
    reduceMotion();
    render(<Frame />);
    expect(scrim().className).not.toContain('animate-');
    expect(panel().className).not.toContain('animate-');
  });

  it('leaves no fading background on close', async () => {
    reduceMotion();
    render(<Frame />);
    render(null);
    await settle();
    expect(backgrounds()).toHaveLength(0);
  });
});
