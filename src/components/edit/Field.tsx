'use client';

import type React from 'react';

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
}) {
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
        <span className="mt-1 block text-small text-status-late-fg">{error}</span>
      ) : check ? (
        <span data-field-check="" className="mt-1 block text-small text-status-risk-fg">
          Check: {check}
        </span>
      ) : help && !source ? (
        <span className="mt-1 block text-small text-text-mutedOnOverlay">{help}</span>
      ) : null}
      {source ? (
        <span data-field-source="" className="mt-1 block break-words text-small text-text-mutedOnOverlay">
          {source}
        </span>
      ) : null}
    </label>
  );
}
