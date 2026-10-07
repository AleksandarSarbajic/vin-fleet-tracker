'use client';

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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  help?: string;
  error?: string | undefined;
  placeholder?: string;
  disabled?: boolean;
  inputRef?: (el: HTMLInputElement | null) => void;
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
        className={`h-10 w-full border bg-surface-sunken px-2.5 text-body text-text disabled:opacity-60 ${
          error ? 'border-status-late-fg' : 'border-line-hair'
        }`}
      />
      {error ? (
        <span className="mt-1 block text-small text-status-late-fg">{error}</span>
      ) : help ? (
        <span className="mt-1 block text-small text-text-mutedOnOverlay">{help}</span>
      ) : null}
    </label>
  );
}
