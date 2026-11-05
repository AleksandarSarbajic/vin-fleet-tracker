'use client';

import { useLayoutEffect, useRef } from 'react';
import { rollNumber } from '@/lib/number-roll';

/**
 * §12.149. A number that rolls when it changes, and is a plain number otherwise. Never
 * on its first render, so the server and the first client render are the same text.
 */
export function RollingNumber({ value, className }: { value: number; className?: string }) {
  const box = useRef<HTMLSpanElement | null>(null);
  const number = useRef<HTMLSpanElement | null>(null);
  const last = useRef(value);

  useLayoutEffect(() => {
    const was = last.current;
    last.current = value;
    if (was !== value && box.current && number.current) {
      rollNumber(box.current, number.current, was);
    }
  }, [value]);

  return (
    <span ref={box} data-roll={value} className={className}>
      <span ref={number}>{value}</span>
    </span>
  );
}
