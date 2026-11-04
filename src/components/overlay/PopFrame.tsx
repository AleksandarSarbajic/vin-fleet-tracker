'use client';

import type { HTMLAttributes, ReactNode, RefObject } from 'react';
import { MOTION_MS } from '@/design/tokens';
import { useOpening } from './useOpening';

const ORIGIN = { left: 'origin-top-left', right: 'origin-top-right' } as const;

type Props = HTMLAttributes<HTMLElement> & {
  className: string;
  /** What it draws as: a list's dropdown is a `ul`. */
  as?: 'div' | 'ul';
  /** The corner it hangs from, so it opens out of what opened it. */
  origin?: keyof typeof ORIGIN;
  children: ReactNode;
};

/**
 * §12.148. A menu or a dropdown: the same rules as `DialogFrame`, on one
 * element. It opens with motion once, leaves nothing on itself when that ends,
 * and closing is its own unmount, at once; a copy of it fades after.
 *
 * Every other attribute (id, role, aria-*, style) goes on the element.
 */
export function PopFrame({
  as = 'div',
  className,
  origin = 'left',
  children,
  ...rest
}: Props) {
  const { node, entering, ended } = useOpening<HTMLDivElement>('menu', MOTION_MS.menuIn);
  // Both draw the same; only the tag differs, so one element's types will do.
  const Tag = as as 'div';
  return (
    <Tag
      {...rest}
      ref={node as RefObject<HTMLDivElement>}
      className={entering ? `${className} animate-menu-in ${ORIGIN[origin]}` : className}
      onAnimationEnd={ended}
    >
      {children}
    </Tag>
  );
}
