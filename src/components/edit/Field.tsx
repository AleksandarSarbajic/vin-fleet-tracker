'use client';

import type React from 'react';
import { useLayoutEffect, useRef } from 'react';
import { checkSaid } from './check-said';
import { dropIn } from '@/lib/appear-motion';
import { MOTION_MS, MOTION_SHAPE } from '@/design/tokens';

/** A labelled text input, its error under it, never in a summary banner (§9.9). */
export function Field({
  label,
  value,
  onChange,
  help,
  error,
  placeholder,
  disabled,
  inputRef,
  onPaste,
  check,
  source,
  ai = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  help?: string;
  error?: string | undefined;
  placeholder?: string;
  disabled?: boolean;
  inputRef?: (el: HTMLInputElement | null) => void;
  onPaste?: (event: React.ClipboardEvent<HTMLInputElement>) => void;
  /** §12.121. Something to look at, not a fault: said in the at-risk colour. */
  check?: string | undefined;
  /** §12.122. Where a fill got this value: the exact text, and its page. */
  source?: string | undefined;
  /** The language-model reader filled it, and nobody has confirmed it yet: the source is its AI mark. */
  ai?: boolean;
}) {
  /**
   * §12.152. A new message drops in under its field: keyed by its words, so a re-render
   * with the same message plays nothing, and neither does mounting with one (choosing
   * another stop remounts its form). Messages come as a person types and from a refused
   * save, so a person is behind every one.
   */
  const message = useRef<HTMLSpanElement | null>(null);
  const said = useRef(error);
  useLayoutEffect(() => {
    const before = said.current;
    said.current = error;
    if (error && error !== before && message.current) {
      dropIn(message.current, MOTION_MS.invalidDrop, MOTION_SHAPE.invalidDropPx);
    }
  });

  return (
    <label className="block">
      <span className="mb-1 block text-small text-text-secondary">{label}</span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onPaste={onPaste}
        className={`h-10 w-full border bg-surface-sunken px-2.5 text-body text-text disabled:opacity-60 ${
          error ? 'border-status-late-fg' : 'border-line-hair'
        }`}
      />
      {error ? (
        <span ref={message} className="mt-1 block text-small text-status-late-fg">
          {error}
        </span>
      ) : check ? (
        <span data-field-check="" className="mt-1 block text-small text-status-risk-fg">
          {checkSaid(check)}
        </span>
      ) : help && !source ? (
        <span className="mt-1 block text-small text-text-mutedOnOverlay">{help}</span>
      ) : null}
      {source ? (
        <span
          data-field-source=""
          {...(ai ? { 'data-field-ai': '' } : {})}
          className={`mt-1 block break-words text-small ${ai ? 'text-text-secondary' : 'text-text-mutedOnOverlay'}`}
        >
          {source}
        </span>
      ) : null}
    </label>
  );
}
