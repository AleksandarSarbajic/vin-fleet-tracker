'use client';

import {
  useLayoutEffect,
  useRef,
  useState,
  type AnimationEvent,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';
import { MOTION_MS } from '@/design/tokens';
import {
  frameMounted,
  frameUnmounted,
  prefersReducedMotion,
  resumeAt,
} from './dialog-motion';

type Props = Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'children' | 'style'> & {
  /** The scrim's classes, exactly as the dialog drew them before §12.148. */
  className: string;
  /** The panel's classes, likewise. */
  panelClassName: string;
  /** The focus trap's container, as before. */
  panelRef?: Ref<HTMLDivElement>;
  /**
   * Frames that stand in for one another: a frame replacing one of its family
   * in the same commit continues that opening. Leave it out and every mount is
   * an opening of its own.
   */
  family?: string | undefined;
  children: ReactNode;
};

/**
 * §12.148. A window's scrim and panel. It opens with motion — the scrim fades
 * in, the panel fades in rising and growing — once per opening, and leaves
 * nothing on either element when that ends. Closing is the window's own
 * unmount, at once; the fading copy is `dialog-motion.ts`'s business.
 *
 * Every other attribute (role, aria-*, data-*) goes on the scrim, where each
 * dialog already had it.
 */
export function DialogFrame({
  className,
  panelClassName,
  panelRef,
  family,
  children,
  ...scrim
}: Props) {
  const scrimRef = useRef<HTMLDivElement>(null);
  const [owner] = useState(() => ({}));
  /** When this frame's opening began. Set once; StrictMode's re-run keeps it. */
  const openedAt = useRef<number | null>(null);
  /** How far into the opening the motion starts; null when there is none. */
  const [entering, setEntering] = useState<number | null>(null);

  // Layout, not passive: the decision lands before the first paint, so the
  // panel is never seen at full strength and then made to fade in.
  useLayoutEffect(() => {
    const now = performance.now();
    const began = frameMounted(owner, now, family);
    if (openedAt.current === null) {
      openedAt.current = began;
      const elapsed = now - began;
      if (elapsed < MOTION_MS.dialogIn && !prefersReducedMotion()) setEntering(elapsed);
    }
    const node = scrimRef.current;
    const opening = openedAt.current;
    return () => frameUnmounted(owner, node, opening, family);
  }, [owner, family]);

  /** The panel's own animation only; one inside it bubbles here too. */
  const ended = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) setEntering(null);
  };
  const style = entering === null ? undefined : resumeAt(entering);

  return (
    <div
      {...scrim}
      ref={scrimRef}
      className={entering === null ? className : `${className} animate-scrim-in`}
      style={style}
    >
      <div
        ref={panelRef}
        className={
          entering === null ? panelClassName : `${panelClassName} animate-dialog-in`
        }
        style={style}
        onAnimationEnd={ended}
      >
        {children}
      </div>
    </div>
  );
}
