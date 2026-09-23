'use client';

import { useEffect, useRef } from 'react';
import { isTypingTarget } from '@/lib/keymap';

interface Props {
  value: string;
  onChange: (value: string) => void;
  matchCount: number;
  totalCount: number;
}

export function SearchField({ value, onChange, matchCount, totalCount }: Props) {
  const ref = useRef<HTMLInputElement | null>(null);

  /** "/" focuses search; Esc clears it, then clears selection (§8.1). */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '/' && !isTypingTarget(event.target)) {
        event.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const active = value.trim().length > 0;

  return (
    <label className="flex h-[34px] items-center gap-2 border border-line-hair bg-surface-base px-[10px] focus-within:border-accent">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="shrink-0 text-text-muted"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>

      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && active) {
            e.stopPropagation();
            onChange('');
          }
        }}
        placeholder="Truck, driver, city, load…"
        aria-label="Search the fleet"
        className="min-w-0 flex-1 bg-transparent font-sans text-[13px] text-text outline-none placeholder:text-text-muted"
      />

      {active ? (
        <>
          <span className="shrink-0 font-sans text-small tabular-nums text-text-muted">
            {matchCount} of {totalCount}
          </span>
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Clear search"
            className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center border border-line-hair text-text-secondary"
          >
            ×
          </button>
        </>
      ) : (
        <span className="shrink-0 border border-line-hair px-[5px] py-px font-mono text-[11px] text-text-muted">
          /
        </span>
      )}
    </label>
  );
}
