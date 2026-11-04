// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogFrame } from './DialogFrame';
import { PopFrame } from './PopFrame';
import { FADING_COPY } from './dialog-motion';
import { MOTION_MS } from '@/design/tokens';

/**
 * §12.148. Menus and dropdowns at the same strength as windows: they open with
 * motion, leave nothing on themselves, and close at once with a copy fading.
 * The copy has to live outside the menu's parent, and that is most of what is
 * different here: `min-w-full` would mean the whole screen, and a plain `z-30`
 * would put a dropdown's copy under the window it was drawn in.
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));
const render = (node: ReactNode) => act(() => root!.render(node));
const copies = () => document.querySelectorAll<HTMLElement>(`[${FADING_COPY}]`);

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root?.unmount());
  await settle();
  copies().forEach((n) => n.remove());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const CLASSES =
  'absolute left-0 top-full z-30 min-w-full max-w-[420px] bg-surface-raised';

function Menu({ children = 'Sign out' }: { children?: ReactNode }) {
  return (
    <PopFrame id="m" role="menu" aria-label="Account" className={CLASSES} origin="right">
      {children}
    </PopFrame>
  );
}
const menu = () => container!.querySelector<HTMLElement>('[role="menu"]')!;

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

describe('a menu opening (§12.148)', () => {
  it('opens with the menu motion, from the corner it hangs from', () => {
    render(<Menu />);
    expect(menu().classList).toContain('animate-menu-in');
    expect(menu().classList).toContain('origin-top-right');
    for (const c of CLASSES.split(' ')) expect(menu().classList).toContain(c);
  });

  it('keeps its attributes and its element', () => {
    render(
      <PopFrame
        as="ul"
        id="list"
        role="listbox"
        style={{ maxWidth: 300 }}
        className={CLASSES}
      >
        <li>One</li>
      </PopFrame>,
    );
    const list = container!.querySelector<HTMLElement>('ul')!;
    expect(list.id).toBe('list');
    expect(list.getAttribute('role')).toBe('listbox');
    expect(list.style.maxWidth).toBe('300px');
    expect(list.classList).toContain('origin-top-left');
  });

  it('leaves nothing on itself when it ends, and an animation inside does not end it', () => {
    render(
      <Menu>
        <span data-child="">child</span>
      </Menu>,
    );
    act(() => {
      container!
        .querySelector('[data-child]')!
        .dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    expect(menu().classList).toContain('animate-menu-in');
    act(() => {
      menu().dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    expect(menu().className).not.toContain('animate-');
    expect(menu().className).not.toContain('origin-');
  });

  it('does not replay when what is inside it changes: typing in a filter', () => {
    render(<Menu>first</Menu>);
    act(() => {
      menu().dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    render(<Menu>second</Menu>);
    expect(menu().textContent).toBe('second');
    expect(menu().className).not.toContain('animate-');
  });
});

describe('a menu closing (§12.148)', () => {
  const closeOne = async () => {
    render(<Menu />);
    vi.spyOn(menu(), 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 20,
      width: 260,
      height: 120,
      right: 270,
      bottom: 140,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    });
    render(null);
    expect(container!.querySelector('[role="menu"]')).toBeNull();
    expect(container!.textContent).toBe('');
    await settle();
    return copies()[0]!;
  };

  it('is gone at once, and a copy nothing can use fades', async () => {
    const copy = await closeOne();
    expect(copy.parentElement).toBe(document.body);
    expect(copy.textContent).toBe('Sign out');
    expect(copy.classList).toContain('animate-menu-out');
    expect(copy.classList).toContain('pointer-events-none');
    expect(copy.getAttribute('aria-hidden')).toBe('true');
    expect(copy.hasAttribute('inert')).toBe(true);
    expect(copy.hasAttribute('role')).toBe(false);
    expect(copy.hasAttribute('id')).toBe(false);
    expect(copy.hasAttribute('aria-label')).toBe(false);
  });

  it('stands where the menu stood, sized as it was, above any window', async () => {
    const copy = await closeOne();
    expect(copy.style.position).toBe('fixed');
    expect(copy.style.left).toBe('10px');
    expect(copy.style.top).toBe('20px');
    expect(copy.style.width).toBe('260px');
    expect(copy.style.height).toBe('120px');
    expect(copy.style.minWidth).toBe('0px');
    expect(copy.style.maxWidth).toBe('none');
    expect(Number(copy.style.zIndex)).toBeGreaterThan(60);
  });

  it('removes the copy when it ends, or after twice its time if it never says so', async () => {
    const copy = await closeOne();
    copy.dispatchEvent(new Event('animationend'));
    expect(copies()).toHaveLength(0);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await closeOne();
    expect(copies()).toHaveLength(1);
    vi.advanceTimersByTime(MOTION_MS.menuOut * 2);
    expect(copies()).toHaveLength(0);
  });

  it('a dropdown open in a window that closes is in the window copy, not a second one', async () => {
    render(
      <DialogFrame
        className="fixed inset-0 z-40 bg-scrim"
        panelClassName="w-[560px]"
        role="dialog"
      >
        <Menu />
      </DialogFrame>,
    );
    render(null);
    await settle();
    expect(copies()).toHaveLength(1);
    expect(copies()[0]!.classList).toContain('animate-window-out');
    expect(copies()[0]!.textContent).toBe('Sign out');
  });

  it('a menu opening takes a fading copy away at once', async () => {
    await closeOne();
    expect(copies()).toHaveLength(1);
    render(<Menu />);
    expect(copies()).toHaveLength(0);
    expect(menu().classList).toContain('animate-menu-in');
  });
});

describe('under reduced motion (§12.148)', () => {
  it('opens with no motion and leaves no copy', async () => {
    reduceMotion();
    render(<Menu />);
    expect(menu().className).not.toContain('animate-');
    render(null);
    await settle();
    expect(copies()).toHaveLength(0);
  });
});
