'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * A copy control (§14, feature 3).
 *
 * §14.4's token line is the whole spec for the feedback: **"Copied — icon +
 * word, never hue alone"**. So the confirmation swaps the glyph AND the
 * label, and a dispatcher who cannot distinguish the two colours still sees
 * the tick and reads the word.
 *
 * §14.5 put these on hover only, in cells that must not widen. They are
 * absolutely positioned against the cell's right edge, over the truncation
 * rather than beside it, so the column is the same width whether or not a
 * pointer is in the row.
 */
export function CopyButton({
  value,
  label,
  glyph,
  offset,
}: {
  /** Null disables the control — there is nothing to copy. */
  value: string | null;
  /** Names the action for assistive tech and the tooltip. */
  label: string;
  glyph: 'address' | 'load';
  /** Distance from the cell's right edge, so two can sit side by side. */
  offset: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_400);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = useCallback(
    async (event: React.MouseEvent) => {
      // The row beneath means select-and-follow-on-map; this does not.
      event.stopPropagation();
      if (value === null) return;
      try {
        await navigator.clipboard.writeText(value);
        setCopied(true);
      } catch {
        /*
         * Clipboard access is refused outside a secure context and in some
         * embedded browsers. Staying silent would be a lie -- the dispatcher
         * would paste whatever was there before -- so the control simply does
         * not confirm, and the value is still readable in the tooltip.
         */
        setCopied(false);
      }
    },
    [value],
  );

  if (value === null) return null;

  return (
    <button
      type="button"
      title={copied ? 'Copied' : label}
      aria-label={label}
      onClick={copy}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{ right: offset }}
      className={`absolute top-1/2 flex -translate-y-1/2 items-center gap-1 border border-line-hair bg-surface-raised px-1 leading-none transition-opacity duration-ground ${
        copied
          ? 'text-status-ontime-fg opacity-100'
          : 'text-text-muted opacity-0 hover:text-text group-hover/row:opacity-100 focus-visible:opacity-100'
      }`}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        {copied ? (
          <path d="M20 6L9 17l-5-5" />
        ) : glyph === 'address' ? (
          <>
            <path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" />
            <circle cx="12" cy="10" r="2.4" />
          </>
        ) : (
          <>
            <rect x="9" y="9" width="11" height="11" rx="1" />
            <path d="M5 15V5a1 1 0 011-1h10" />
          </>
        )}
      </svg>
      {/* The word, not only the tick: never hue alone (§14.4). */}
      <span className="font-cond text-[9.5px] uppercase tracking-[.08em]">
        {copied ? 'Copied' : glyph === 'address' ? 'Addr' : 'Load'}
      </span>
    </button>
  );
}
