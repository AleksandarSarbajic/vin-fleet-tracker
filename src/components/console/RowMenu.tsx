'use client';

import type React from 'react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { PopFrame } from '@/components/overlay/PopFrame';
import type { RowMenuItem, RowMenuItemId } from './row-menu';

/**
 * §12.164, phase 3bx (QoL 8). The menu a right-click on a row opens, or the menu key and
 * Shift+F10 for the selected row: `role="menu"`, its items `menuitem`s, the arrows (and Home,
 * End) moving among them, Enter or Space doing one, Esc and Tab closing it with the focus back on
 * the row. A menu's frame (§12.148): it opens once with the menu's motion, its copy fades as it
 * goes, and under reduced motion it is simply there.
 *
 * While it is open the board's keys stand down: `isWindowOpen` counts it (`data-row-menu`), and
 * the press that closes it is stopped here, so it never reaches the board (3bc's closing press).
 * Its keys are this element's own: no listener is added to the window or the document for them.
 *
 * It closes, with nothing done, on a press outside it, a scroll, a resize and the window losing
 * focus; Console closes it when a window opens and when a poll takes its truck off the board. A
 * poll that only changes the truck leaves it open: its items read the live row.
 */
export function RowMenu({
  truckLabel,
  items,
  at,
  onAct,
  onClose,
}: {
  truckLabel: string;
  items: RowMenuItem[];
  /** Where it opens: the pointer, or under the start of the row for a key. */
  at: { x: number; y: number };
  onAct: (id: RowMenuItemId) => void;
  /** `backToRow`: Esc and Tab give the focus back to the row; a press elsewhere keeps its own. */
  onClose: (backToRow: boolean) => void;
}) {
  const anchor = useRef<HTMLDivElement | null>(null);
  const whyId = useId();
  /** Kept inside the window, measured before the first paint. */
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const menu = anchor.current?.firstElementChild as HTMLElement | null;
    if (!menu) return;
    const { offsetWidth: w, offsetHeight: h } = menu;
    const left = Math.max(8, Math.min(at.x, window.innerWidth - w - 8));
    const top = at.y + h > window.innerHeight - 8 ? Math.max(8, at.y - h) : at.y;
    setPlaced({ left, top });
  }, [at.x, at.y]);

  const menuItems = () => [...(anchor.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  // The first item that does something takes the focus as it opens: once placed, because
  // until then the menu is not shown (`visibility: hidden`), and nothing hidden takes focus.
  const focused = useRef(false);
  useEffect(() => {
    if (!placed || focused.current) return;
    focused.current = true;
    const first = menuItems().find((el) => el.getAttribute('aria-disabled') !== 'true') ?? menuItems()[0];
    first?.focus({ preventScroll: true });
  }, [placed]);

  // A press outside, a scroll, a resize or leaving the window: closed, nothing done.
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  useEffect(() => {
    const outside = (event: Event) => {
      if (anchor.current && event.target instanceof Node && anchor.current.contains(event.target)) return;
      latestClose.current(false);
    };
    const quiet = () => latestClose.current(false);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', outside, true);
    window.addEventListener('resize', quiet);
    window.addEventListener('blur', quiet);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', outside, true);
      window.removeEventListener('resize', quiet);
      window.removeEventListener('blur', quiet);
    };
  }, []);

  const act = (item: RowMenuItem) => {
    if (item.disabled) return;
    onAct(item.id);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const list = menuItems();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const stop = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      stop();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      list[(at + step + list.length) % list.length]?.focus({ preventScroll: true });
    } else if (event.key === 'Home' || event.key === 'End') {
      stop();
      list[event.key === 'Home' ? 0 : list.length - 1]?.focus({ preventScroll: true });
    } else if (event.key === 'Enter' || event.key === ' ') {
      stop();
      const id = list[at]?.getAttribute('data-menu-item');
      const item = items.find((i) => i.id === id);
      if (item) act(item);
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      // Stopped: the press that closes the menu is not the board's too.
      stop();
      onClose(true);
    }
  };

  return (
    <div
      ref={anchor}
      className="fixed z-30"
      style={placed ? { left: placed.left, top: placed.top } : { left: at.x, top: at.y, visibility: 'hidden' }}
    >
      <PopFrame
        role="menu"
        aria-label={`Truck ${truckLabel}`}
        data-row-menu=""
        origin="left"
        onKeyDown={onKeyDown}
        // The browser's own menu never opens over this one.
        onContextMenu={(event) => event.preventDefault()}
        className="w-[232px] border border-line-control bg-surface-raised py-1 text-left shadow-modal"
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            tabIndex={-1}
            data-menu-item={item.id}
            aria-disabled={item.disabled ? 'true' : undefined}
            aria-describedby={item.disabled ? `${whyId}-${item.id}` : undefined}
            title={item.disabled ?? undefined}
            onClick={() => act(item)}
            className={`flex h-8 w-full items-center justify-between gap-3 px-3 text-left font-sans text-[13px] outline-none ${
              item.disabled ? 'cursor-default text-text-muted' : 'text-text hover:bg-row-hover focus:bg-row-hover'
            } focus-visible:bg-row-hover`}
          >
            <span>{item.label}</span>
            {item.key ? <kbd className="font-mono text-[10px] text-text-mutedOnSelected">{item.key}</kbd> : null}
            {item.disabled ? (
              <span id={`${whyId}-${item.id}`} className="sr-only">
                {item.disabled}
              </span>
            ) : null}
          </button>
        ))}
      </PopFrame>
    </div>
  );
}
