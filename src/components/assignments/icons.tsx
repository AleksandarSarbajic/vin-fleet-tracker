/**
 * The assignment board's icons, drawn as the console draws its own (the
 * search field, the status chips): small inline SVGs in `currentColor`, so
 * each takes its ink from a text class. Decorative: the control around one
 * carries the accessible name.
 */

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

export function LockIcon({ className }: { className?: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" {...STROKE} className={className}>
      <rect x="4" y="11" width="16" height="10" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function PencilIcon({ className }: { className?: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" {...STROKE} className={className}>
      <path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
    </svg>
  );
}

export function WarningIcon({ className }: { className?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" {...STROKE} className={className}>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

export function SearchIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...STROKE} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
