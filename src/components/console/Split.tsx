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
  const [dragging, setDragging] = useState(false);
  const [width, setWidth] = useState(0);
  const [mapVisible, setMapVisible] = useState(true);

  // Read on mount, not during render — the server has no localStorage and a
  // mismatch would hydrate wrong.
  useEffect(() => setPct(readStored()), []);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry?.contentRect.width ?? 0),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const splitEnabled = width >= SPLIT_DISABLED_BELOW;

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
      setPct(clamped);
      writeStored(clamped);
      onResizeEnd();
    },
    [clamp, onResizeEnd],
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
        setPct(clamp(((e.clientX - box.left) / box.width) * 100));
      };

      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        setDragging(false);
        // Written on RELEASE, and the map reflows exactly once, here.
        setPct((current) => {
          writeStored(current);
          return current;
        });
        onResizeEnd();
      };

      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    },
    [clamp, onResizeEnd, splitEnabled],
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
      className="grid min-h-0 flex-1"
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
              className={`h-[2px] w-[2px] ${dragging ? 'bg-text-inverse' : 'bg-[#5d646b]'}`}
            />
          ))}
        </span>
      </div>

      <div className="relative min-h-0 min-w-0">{map}</div>
    </div>
  );
}
