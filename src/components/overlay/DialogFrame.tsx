'use client';

import {
  cloneElement,
  isValidElement,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';
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
  /**
   * §12.160, phSheet. Only the phone's truck sheet and More sheet pass it: the sheet's own
   * "a person closed me", which its close handlers set. With it, the panel comes up from below
   * the screen while the backdrop fades in, and a person's close leaves a copy that goes back
   * down while its backdrop fades. With `phSheet` at 0, or without it, a frame is §12.148's.
   */
  sheet?: { readonly current: boolean };
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
  sheet,
  children,
  ...scrim
}: Props) {
  const slide = sheet !== undefined && MOTION_MS.phSheet > 0;
  const { node, entering, style, ended } = useOpening<HTMLDivElement>(
    'window',
    slide ? MOTION_MS.phSheet : MOTION_MS.dialogIn,
    family,
    slide ? sheet : undefined,
  );

  return (
    <div
      {...scrim}
      ref={node}
      className={entering && !slide ? `${className} animate-scrim-in` : className}
      style={slide ? undefined : style}
    >
      {slide && entering ? fadingIn(backdrop, style) : backdrop}
      <div
        {...panelProps}
        ref={panelRef}
        className={
          entering
            ? `${panelClassName} ${slide ? 'animate-sheet-in' : 'animate-dialog-in'}`
            : panelClassName
        }
        style={style}
        onAnimationEnd={ended}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * §12.160. A sheet's scrim is its backdrop, the tap to close: it fades in on its own, so the
 * panel coming up stays opaque. The class comes off with the panel's when the opening ends.
 */
function fadingIn(backdrop: ReactNode, style: CSSProperties | undefined): ReactNode {
  if (!isValidElement<{ className?: string; style?: CSSProperties }>(backdrop)) return backdrop;
  const own = backdrop.props.className;
  const className = own ? `${own} animate-scrim-in` : 'animate-scrim-in';
  return cloneElement(backdrop, style ? { className, style } : { className });
}
