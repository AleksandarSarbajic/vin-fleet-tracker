// @vitest-environment happy-dom
import { act, StrictMode, useRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogFrame } from './DialogFrame';
import { FADING_COPY } from './dialog-motion';
import { MOTION_MS } from '@/design/tokens';
import { useFocusTrap } from '@/components/edit/useModalChrome';

/**
 * §12.148. A window opens with motion once, leaves nothing on itself after,
 * and closes without waiting: what fades is a copy of it nothing can use.
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
  document.querySelectorAll(`[${FADING_COPY}]`).forEach((n) => n.remove());
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

function Frame({
  label = 'Test dialog',
  family,
  children,
}: {
  label?: string;
  family?: string;
  children?: ReactNode;
}) {
  return (
    <DialogFrame
      className={SCRIM}
      panelClassName={PANEL}
      family={family}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      {children ?? <button type="button">Confirm</button>}
    </DialogFrame>
  );
}

/** Different component types, so swapping one for another remounts. */
function First() {
  return <Frame label="First" family="one window" />;
}
function Second() {
  return <Frame label="Second" family="one window" />;
}
function Palette() {
  return <Frame label="Palette" />;
}
function Modal() {
  return <Frame label="Modal" />;
}

const render = (node: ReactNode) => act(() => root!.render(node));
const scrim = () => container!.querySelector<HTMLElement>('[role="dialog"]')!;
const panel = () => scrim().firstElementChild as HTMLElement;
const copies = () => document.querySelectorAll<HTMLElement>(`[${FADING_COPY}]`);
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

  it('opens with motion once under StrictMode, and leaves no copy behind', async () => {
    render(
      <StrictMode>
        <Frame />
      </StrictMode>,
    );
    await settle();
    expect(panel().className).toContain('animate-dialog-in');
    expect(copies()).toHaveLength(0);
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

  it('leaves no copy, because nothing closed', async () => {
    render(<First />);
    now += MOTION_MS.dialogIn * 10;
    render(<Second />);
    await settle();
    expect(copies()).toHaveLength(0);
  });

  it('a different window in the same commit is an opening of its own, and the old one leaves nothing', async () => {
    render(<Palette />);
    now += 5_000;
    render(<Modal />);
    expect(scrim().getAttribute('aria-label')).toBe('Modal');
    expect(panel().className).toContain('animate-dialog-in');
    expect(panel().style.animationDelay).toBe('');
    await settle();
    expect(copies()).toHaveLength(0);
  });

  it('what else closed in that commit still fades: a confirm over the replaced frame', async () => {
    render(
      <>
        <First />
        <Frame label="Confirm">confirm</Frame>
      </>,
    );
    now += 5_000;
    render(<Second />);
    expect(scrim().getAttribute('aria-label')).toBe('Second');
    expect(panel().className).not.toContain('animate-');
    await settle();
    expect(copies()).toHaveLength(1);
    expect(copies()[0]!.textContent).toBe('confirm');
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
        <DialogFrame
          className={SCRIM}
          panelClassName={PANEL}
          panelRef={trap}
          role="dialog"
        >
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

  it('fades a copy of the whole window, which nothing can use', async () => {
    render(
      <Frame>
        <label htmlFor="f" id="l">
          Field
        </label>
        <input id="f" name="f" data-initial-focus="" tabIndex={0} aria-label="Field" />
      </Frame>,
    );
    render(null);
    await settle();
    expect(copies()).toHaveLength(1);
    const copy = copies()[0]!;
    expect(copy.parentElement).toBe(document.body);
    // Every word as it stood …
    expect(copy.textContent).toBe('Field');
    expect(copy.firstElementChild?.classList).toContain('w-[560px]');
    // … and nothing that can be used or found.
    expect(copy.getAttribute('aria-hidden')).toBe('true');
    expect(copy.hasAttribute('inert')).toBe(true);
    expect(copy.classList).toContain('pointer-events-none');
    expect(copy.classList).toContain('animate-window-out');
    expect(copy.hasAttribute('role')).toBe(false);
    expect(copy.hasAttribute('aria-label')).toBe(false);
    expect(copy.hasAttribute('aria-modal')).toBe(false);
    expect(
      copy.querySelectorAll(
        '[id],[name],[for],[tabindex],[aria-label],[data-initial-focus]',
      ),
    ).toHaveLength(0);
    // The same layer and ground as the window it stands in for.
    expect(copy.classList).toContain('z-50');
    expect(copy.classList).toContain('bg-scrim');
    // The opening's classes do not come along, or the copy would open again.
    expect(copy.outerHTML).not.toContain('animate-scrim-in');
    expect(copy.outerHTML).not.toContain('animate-dialog-in');
  });

  it('carries over what cloning does not: a select choice and a scroll position', async () => {
    render(
      <Frame>
        <select aria-label="Status" defaultValue="a">
          <option value="a">A</option>
          <option value="b">B</option>
        </select>
        <div data-scroller="" style={{ height: 10, overflow: 'auto' }}>
          <div style={{ height: 100 }} />
        </div>
      </Frame>,
    );
    container!.querySelector('select')!.selectedIndex = 1;
    container!.querySelector<HTMLElement>('[data-scroller]')!.scrollTop = 30;
    render(null);
    await settle();
    const copy = copies()[0]!;
    expect(copy.querySelector('select')!.selectedIndex).toBe(1);
    const scroller = copy.firstElementChild!.children[1] as HTMLElement;
    expect(scroller.scrollTop).toBe(30);
  });

  it('closed mid-opening, fades from where it stood, not from full strength', async () => {
    render(<Frame />);
    const real = getComputedStyle;
    vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((el) =>
      (el as HTMLElement).classList.contains('animate-dialog-in') ||
      (el as HTMLElement).classList.contains('animate-scrim-in')
        ? ({
            opacity: '0.4',
            transform: (el as HTMLElement).classList.contains('animate-dialog-in')
              ? 'matrix(0.98, 0, 0, 0.98, 0, 4)'
              : 'none',
          } as CSSStyleDeclaration)
        : real(el),
    );
    render(null);
    await settle();
    const copy = copies()[0]!;
    expect(copy.style.opacity).toBe('0.4');
    expect(copy.style.transform).toBe('');
    const inner = copy.firstElementChild as HTMLElement;
    expect(inner.style.opacity).toBe('0.4');
    expect(inner.style.transform).toBe('matrix(0.98, 0, 0, 0.98, 0, 4)');
  });

  it('a window that had settled carries no frozen style', async () => {
    render(<Frame />);
    finishOpening();
    render(null);
    await settle();
    const copy = copies()[0]!;
    expect(copy.style.opacity).toBe('');
    expect((copy.firstElementChild as HTMLElement).style.transform).toBe('');
  });

  it('removes the copy when its fade ends', async () => {
    render(<Frame />);
    render(null);
    await settle();
    copies()[0]!.dispatchEvent(new Event('animationend'));
    expect(copies()).toHaveLength(0);
  });

  it('removes the copy even if its fade never reports ending', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render(<Frame />);
    render(null);
    await settle();
    expect(copies()).toHaveLength(1);
    vi.advanceTimersByTime(MOTION_MS.dialogOut * 2);
    expect(copies()).toHaveLength(0);
  });

  it('leaves a copy of each when several windows close together', async () => {
    render(
      <>
        <Frame label="Under">under</Frame>
        <Frame label="Over">over</Frame>
      </>,
    );
    render(null);
    await settle();
    expect([...copies()].map((c) => c.textContent)).toEqual(['under', 'over']);
  });

  it('a window drawn inside another closing one is not faded twice', async () => {
    render(
      <Frame label="Outer">
        <Frame label="Inner">inner</Frame>
      </Frame>,
    );
    render(null);
    await settle();
    expect(copies()).toHaveLength(1);
    expect(copies()[0]!.textContent).toBe('inner');
  });
});

describe('reopening during the fade (§12.148)', () => {
  it('removes the old copy at once, and the new window opens normally', async () => {
    render(<First />);
    render(null);
    await settle();
    expect(copies()).toHaveLength(1);

    now += MOTION_MS.dialogOut / 2;
    render(<Second />);
    expect(copies()).toHaveLength(0);
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

  it('leaves no copy on close', async () => {
    reduceMotion();
    render(<Frame />);
    render(null);
    await settle();
    expect(copies()).toHaveLength(0);
  });
});
