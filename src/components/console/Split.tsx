'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** design-spec §3.2. */
const STORAGE_KEY = 'ft.splitPct';
const DEFAULT_PCT = 60;
const LIST_MIN_PX = 560;
const MAP_MIN_PX = 520;
const HANDLE_PX = 6;
/** 560 + 6 + 520. Below this the split is off and the map becomes a toggle. */
const SPLIT_DISABLED_BELOW = LIST_MIN_PX + HANDLE_PX + MAP_MIN_PX;
const KEY_STEP_PCT = 2;

function readStored(): number {
  if (typeof window === 'undefined') return DEFAULT_PCT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const value = Number.parseFloat(raw ?? '');
    // Missing or unparseable falls back to 60, per the spec.
    return Number.isFinite(value) && value > 0 && value < 100 ? value : DEFAULT_PCT;
  } catch {
    // Private browsing, or storage disabled. A default is fine; a crash is not.
    return DEFAULT_PCT;
  }
}

function writeStored(pct: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, pct.toFixed(1));
  } catch {
    // Not being able to remember the split is not worth an error boundary.
  }
}

interface Props {
  list: React.ReactNode;
  map: React.ReactNode;
  /** Called on drag-end so the map reflows once, never mid-drag. */
  onResizeEnd: () => void;
}

export function Split({ list, map, onResizeEnd }: Props) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [pct, setPct] = useState(DEFAULT_PCT);
  /**
   * §12.29. The drag handlers are plain DOM listeners registered once at
   * pointerdown, so they close over the `pct` from that moment and can never
   * see a later one. The old code worked around that by reading the current
   * value inside a `setPct` updater and calling `writeStored` from in there —
   * the same shape as the chip bug: a side effect in an updater, which React
   * runs during the render phase and StrictMode runs twice.
   *
   * A ref is the honest fix. It is mutable state that is not render state,
   * which is exactly what a pointer drag needs.
   */
  const pctRef = useRef(DEFAULT_PCT);
  const applyPct = useCallback((next: number) => {
    pctRef.current = next;
    setPct(next);
  }, []);
  const [dragging, setDragging] = useState(false);
  const [width, setWidth] = useState(0);
  const [mapVisible, setMapVisible] = useState(true);

  // Read on mount, not during render — the server has no localStorage and a
  // mismatch would hydrate wrong.
  useEffect(() => applyPct(readStored()), [applyPct]);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry?.contentRect.width ?? 0),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /**
   * `width` is 0 until the ResizeObserver first fires — on the server, and on
   * the client's first paint. Treating unmeasured as "too narrow" collapses
   * the console to the map-only layout on every desktop load and then snaps
   * to the split a frame later. Unmeasured means "assume the split", which is
   * the overwhelmingly common case; only a real measurement collapses it.
   */
  const measured = width > 0;
  const splitEnabled = !measured || width >= SPLIT_DISABLED_BELOW;

  /** Keeps both panes above their minimums whatever the container width. */
  const clamp = useCallback(
    (next: number): number => {
      if (width <= 0) return next;
      const usable = width - HANDLE_PX;
      const min = (LIST_MIN_PX / usable) * 100;
      const max = ((usable - MAP_MIN_PX) / usable) * 100;
      if (min > max) return next;
      return Math.min(max, Math.max(min, next));
    },
    [width],
  );

  const commit = useCallback(
    (next: number) => {
      const clamped = clamp(next);
      applyPct(clamped);
      writeStored(clamped);
      onResizeEnd();
    },
    [applyPct, clamp, onResizeEnd],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!splitEnabled) return;
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      setDragging(true);

      const move = (e: PointerEvent) => {
        const box = boxRef.current?.getBoundingClientRect();
        if (!box) return;
        applyPct(clamp(((e.clientX - box.left) / box.width) * 100));
      };

      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        setDragging(false);
        // Written on RELEASE, from the ref, and the map reflows exactly once
        // — here, in the event, not in a state updater (§12.29).
        writeStored(pctRef.current);
        onResizeEnd();
      };

      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    },
    [applyPct, clamp, onResizeEnd, splitEnabled],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!splitEnabled) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        commit(pct - KEY_STEP_PCT);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        commit(pct + KEY_STEP_PCT);
      } else if (event.key === 'Home') {
        event.preventDefault();
        commit(DEFAULT_PCT);
      }
    },
    [commit, pct, splitEnabled],
  );

  // Below 1086px the split is off: the list runs full width and the map is a
  // toggle.
  if (!splitEnabled) {
    return (
      <div ref={boxRef} className="relative flex min-h-0 flex-1 flex-col">
        <button
          type="button"
          onClick={() => setMapVisible((v) => !v)}
          className="flex h-8 shrink-0 items-center justify-center border-b border-line-hair bg-surface-raised font-cond text-micro uppercase tracking-[.08em] text-accent"
        >
          {mapVisible ? 'Hide map' : 'Show map'}
        </button>
        <div className="min-h-0 flex-1">{mapVisible ? map : list}</div>
      </div>
    );
  }

  return (
    <div
      ref={boxRef}
      /*
       * `grid-rows-[minmax(0,1fr)]` is load-bearing, not tidiness.
       *
       * With columns declared and no rows, the grid gets ONE IMPLICIT `auto`
       * ROW, and an auto row is sized by its content. So a list of 40 trucks
       * made the row 1,978px tall inside a 630px container, the overflow
       * escaped to the document, and the whole page scrolled — header out of
       * view at the top, map attribution sliding past the bottom. §12.17 and
       * §14 both specify the opposite: the list scrolls inside its own box
       * while the header and map stay put.
       *
       * `minmax(0, 1fr)` pins the row to the container's height and gives its
       * children a definite height to resolve `100%` and `flex-1` against.
       * The `0` minimum is the half that matters: a bare `1fr` has an `auto`
       * minimum and grows to fit content exactly as before.
       */
      className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)]"
      style={{ gridTemplateColumns: `${pct}% ${HANDLE_PX}px 1fr` }}
    >
      {list}

      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={Math.round(pct)}
        aria-label="Resize list and map"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onDoubleClick={() => commit(DEFAULT_PCT)}
        title="Drag to resize · double-click to reset to 60/40"
        className={[
          'relative flex cursor-col-resize items-center justify-center',
          // 12px grab margin on a 6px handle, without changing the layout.
          'after:absolute after:inset-y-0 after:-left-[12px] after:-right-[12px] after:content-[""]',
          dragging ? 'bg-accent outline outline-1 outline-accent-hover' : 'bg-line-hair hover:bg-accent',
        ].join(' ')}
      >
        <span className="flex flex-col gap-[3px]" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <span
              key={i}
              className={`h-[2px] w-[2px] ${dragging ? 'bg-text-inverse' : 'bg-line-grip'}`}
            />
          ))}
        </span>
      </div>

      <div className="relative min-h-0 min-w-0">{map}</div>
    </div>
  );
}
