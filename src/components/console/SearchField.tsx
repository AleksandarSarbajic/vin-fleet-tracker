'use client';

import { useEffect, useRef } from 'react';
import { isTypingTarget } from '@/lib/keymap';

interface Props {
  value: string;
  onChange: (value: string) => void;
  matchCount: number;
  totalCount: number;
  /**
   * §12.100. Below 1024 the field is folded behind an icon, and "/" has to
   * open it before anything can be focused. Given, "/" calls this instead of
   * focusing the input itself.
   */
  onSlash?: () => void;
  /** §12.100. Given and returning true, Esc was handled (it closed the field). */
  onEscape?: () => boolean;
}

export function SearchField({
  value,
  onChange,
  matchCount,
  totalCount,
  onSlash,
  onEscape,
}: Props) {
  const ref = useRef<HTMLInputElement | null>(null);

  /** "/" focuses search; Esc clears it, then clears selection (§8.1). */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '/' && !isTypingTarget(event.target)) {
        event.preventDefault();
        if (onSlash) onSlash();
        else ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSlash]);

  const active = value.trim().length > 0;

  return (
    <label className="flex h-8 w-full items-center gap-2 border border-line-rule bg-surface-base px-[10px] focus-within:border-accent">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="shrink-0 text-text-mutedOnOverlay"
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
          if (e.key === 'Escape' && onEscape?.()) {
            e.stopPropagation();
            return;
          }
          if (e.key === 'Escape' && active) {
            e.stopPropagation();
            onChange('');
          }
        }}
        /*
         * §14.5 split the two text boxes by verb: `/` filters the list in
         * place, `⌘K` jumps and closes. The placeholder says which this one
         * is, because "Truck, driver, city, load…" described what it matches
         * and not what it does — and with a second box that matches the same
         * five fields, what it does is the only thing that tells them apart.
         */
        placeholder="Filter list…"
        aria-label="Search the fleet"
        className="min-w-0 flex-1 bg-transparent font-sans text-[13px] text-text outline-none placeholder:text-text-mutedOnOverlay"
      />

      {active ? (
        <>
          <span className="shrink-0 font-sans text-small tabular-nums text-text-muted">
            {matchCount} of {totalCount}
          </span>
          <button
            type="button"
            onClick={() => {
              onChange('');
              // Back to the box: the next keystroke is the next search.
              ref.current?.focus();
            }}
            aria-label="Clear search"
            className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center border border-line-hair text-text-secondary"
          >
            ×
          </button>
        </>
      ) : (
        /*
         * §14.5: "shows both hints". Two caps rather than one, so the box
         * that filters also names the box that jumps — which is the only
         * place a dispatcher will find out the second one exists.
         */
        /*
         * §12.91. Two caps at every supported width — the list-title row
         * that used to carry `/ to filter · ⌘K to jump` is gone, so this is
         * again the only place the second box is named. `⌘K jump` shortens
         * to `⌘K` below 1440; below 1280 the box is 160px and the caps go.
         */
        <span className="hidden shrink-0 items-center gap-1 min-[1280px]:flex">
          <Cap>/</Cap>
          <Cap>
            ⌘K<span className="hidden min-[1440px]:inline"> jump</span>
          </Cap>
        </span>
      )}
    </label>
  );
}

function Cap({ children }: { children: React.ReactNode }) {
  return (
    <span className="whitespace-nowrap border border-line-control px-[5px] py-px font-mono text-[11px] font-medium text-text-secondary">
      {children}
    </span>
  );
}
