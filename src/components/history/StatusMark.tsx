import { ENTRY_STATUS_LABEL, type EntryStatus } from '@/lib/history';

/**
 * §12.101. A load's status on the history page: a shape AND a colour, so it
 * survives a black-and-white printer. The colour is a token class per status
 * (CLAUDE.md: semantic status out of the data, token in the config, class
 * here); the print variants are the darker inks of `print.*`.
 */
const ICON: Record<EntryStatus, string> = {
  delivered: 'M5 12.5l4.5 4.5L19 7.5',
  cancelled: 'M7 7l10 10M17 7 7 17',
  tonu: 'M7 7l10 10M17 7 7 17',
  progress: 'M5 12h13M13 6l6 6-6 6',
};

export const STATUS_INK: Record<EntryStatus, string> = {
  delivered: 'text-status-ontime-fg print:text-print-delivered',
  cancelled: 'text-history-cancelled print:text-print-cancelled',
  tonu: 'text-history-cancelled print:text-print-cancelled',
  progress: 'text-status-arrived-fg print:text-print-progress',
};

/** The 2px left rule on a load block, in the status colour. */
export const STATUS_RULE: Record<EntryStatus, string> = {
  delivered: 'border-l-status-ontime-fg print:border-l-print-delivered',
  cancelled: 'border-l-history-cancelled print:border-l-print-cancelled',
  tonu: 'border-l-history-cancelled print:border-l-print-cancelled',
  progress: 'border-l-status-arrived-fg print:border-l-print-progress',
};

/** Legend order: what most loads are, first. */
export const LEGEND: EntryStatus[] = ['delivered', 'progress', 'cancelled', 'tonu'];

export function StatusIcon({ status, size = 11 }: { status: EntryStatus; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d={ICON[status]} />
    </svg>
  );
}

export function StatusMark({ status, className = '' }: { status: EntryStatus; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap font-cond text-[10.5px] font-semibold uppercase leading-[1.3] tracking-[.08em] ${STATUS_INK[status]} ${className}`}
    >
      <StatusIcon status={status} />
      {ENTRY_STATUS_LABEL[status]}
    </span>
  );
}
