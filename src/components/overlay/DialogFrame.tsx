'use client';

import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { MOTION_MS } from '@/design/tokens';
import { useOpening } from './useOpening';

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
  /** Drawn behind the panel, inside the scrim: a phone sheet's tap to close. */
  backdrop?: ReactNode;
  /** What goes on the panel: on a phone sheet the panel is the dialog. */
  panelProps?: HTMLAttributes<HTMLDivElement> & { [key: `data-${string}`]: string };
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
  backdrop,
  panelProps,
  children,
  ...scrim
}: Props) {
  const { node, entering, style, ended } = useOpening<HTMLDivElement>(
    'window',
    MOTION_MS.dialogIn,
    family,
  );

  return (
    <div
      {...scrim}
      ref={node}
      className={entering ? `${className} animate-scrim-in` : className}
      style={style}
    >
      {backdrop}
      <div
        {...panelProps}
        ref={panelRef}
        className={entering ? `${panelClassName} animate-dialog-in` : panelClassName}
        style={style}
        onAnimationEnd={ended}
      >
        {children}
      </div>
    </div>
  );
}
