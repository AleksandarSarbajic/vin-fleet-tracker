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

export function SearchIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...STROKE} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
