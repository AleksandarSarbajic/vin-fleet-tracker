'use client';

import {
  useLayoutEffect,
  useRef,
  useState,
  type AnimationEvent,
  type CSSProperties,
  type RefObject,
} from 'react';
import {
  frameMounted,
  frameUnmounted,
  prefersReducedMotion,
  resumeAt,
  type FrameKind,
} from './dialog-motion';

/**
 * §12.148. What a window's frame and a menu's frame have in common: the
 * opening decided once, the classes off when it ends, and a copy on the way out.
 *
 * Layout, not passive: the decision lands before the first paint, so nothing is
 * seen at full strength and then made to fade in.
 */
export function useOpening<T extends HTMLElement>(
  kind: FrameKind,
  duration: number,
  family?: string,
): {
  node: RefObject<T | null>;
  entering: boolean;
  style: CSSProperties | undefined;
  ended: (event: AnimationEvent<HTMLElement>) => void;
} {
  const node = useRef<T>(null);
  const [owner] = useState(() => ({}));
  /** When this frame's opening began. Set once; StrictMode's re-run keeps it. */
  const openedAt = useRef<number | null>(null);
  /** How far into the opening the motion starts; null when there is none. */
  const [elapsed, setElapsed] = useState<number | null>(null);

  useLayoutEffect(() => {
    const now = performance.now();
    const began = frameMounted(owner, now, family);
    if (openedAt.current === null) {
      openedAt.current = began;
      const gone = now - began;
      if (gone < duration && !prefersReducedMotion()) setElapsed(gone);
    }
    const el = node.current;
    const opening = openedAt.current;
    return () => frameUnmounted(owner, el, opening, family, kind);
  }, [owner, family, kind, duration]);

  return {
    node,
    entering: elapsed !== null,
    style: elapsed === null ? undefined : resumeAt(elapsed),
    /** Its own animation only; one inside it bubbles here too. */
    ended: (event) => {
      if (event.target === event.currentTarget) setElapsed(null);
    },
  };
}
