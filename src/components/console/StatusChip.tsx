import type { Status } from '@/lib/status';
import { STATUS_LABEL } from '@/lib/status';

/**
 * Every state carries hue + shape + icon + word (design-spec §5.1). The word
 * is always printed and the icon always repeats the marker shape, so the set
 * survives greyscale and colour-blindness.
 *
 * Classes are a static map because Tailwind cannot see a class name built at
 * runtime. No component hardcodes a hex — the token does the work.
 */
const CHIP: Record<Status, string> = {
  LATE: 'bg-status-late-bg border-solid border-status-late-bd text-status-late-fg font-semibold',
  AT_RISK: 'bg-status-risk-bg border-solid border-status-risk-bd text-status-risk-fg font-semibold',
  ON_TIME: 'bg-status-ontime-bg border-solid border-status-ontime-bd text-status-ontime-fg font-semibold',
  ARRIVED: 'bg-status-arrived-bg border-solid border-status-arrived-bd text-status-arrived-fg font-semibold',
  // No fill and weight 400 — the quietest chip in the set.
  TOMORROW: 'bg-transparent border-solid border-status-tomorrow-bd text-status-tomorrow-fg font-normal',
  // The three neutral states share one colour pair and differ ONLY by border
  // style, icon and marker pattern — never by hue.
  NO_APPT: 'bg-status-neutral-bg border-dashed border-status-neutral-bd text-status-neutral-fg font-semibold',
  STALE_GPS: 'bg-status-neutral-bg border-dotted border-status-neutral-bd text-status-neutral-fg font-semibold tabular-nums',
  UNASSIGNED: 'bg-status-neutral-bg border-solid border-status-neutral-bd text-status-neutral-fg font-semibold',
};

const ICON: Record<Status, React.ReactNode> = {
  LATE: (
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  AT_RISK: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  ON_TIME: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </>
  ),
  TOMORROW: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="1" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
    </>
  ),
  ARRIVED: (
    <>
      <path d="M20 10c0 6-8 11-8 11s-8-5-8-11a8 8 0 0 1 16 0Z" />
      <path d="m9 10 2 2 3.5-3.5" />
    </>
  ),
  NO_APPT: (
    <>
      <path d="M9.2 9a3 3 0 1 1 4.3 3c-.9.6-1.5 1.2-1.5 2.3" />
      <path d="M12 18h.01" />
    </>
  ),
  STALE_GPS: (
    <>
      <path d="M13 7 9 3 3 9l4 4" />
      <path d="m17 11 4 4-6 6-4-4" />
      <path d="m3 3 18 18" />
    </>
  ),
  // Driver-slash: a person with a line through them.
  UNASSIGNED: (
    <>
      <path d="M8 21v-2a4 4 0 0 1 4-4h1" />
      <circle cx="12" cy="7" r="3.5" />
      <path d="m3 3 18 18" />
    </>
  ),
};

/** The override glyph: a hand, for a status a person decided. */
const OVERRIDE_GLYPH = (
  <>
    <path d="M12 11V5.5a1.5 1.5 0 0 1 3 0V12" />
    <path d="M9 12V7.5a1.5 1.5 0 0 0-3 0V14a7 7 0 0 0 7 7h1a6 6 0 0 0 6-6v-3.5a1.5 1.5 0 0 0-3 0" />
    <path d="M15 11.5v-2a1.5 1.5 0 0 1 3 0v2" />
  </>
);

interface Props {
  status: Status;
  /**
   * §9.5: a forced chip keeps the status COLOUR, swaps the status icon for
   * the override glyph, and appends " · forced". The stripe and the sort are
   * untouched — the chip is the only place the row changes, so the list still
   * reads by urgency while a reviewer can see which reds are decisions rather
   * than measurements.
   */
  forced?: boolean;
  /** Overrides the word. Stale GPS prints its elapsed age instead. */
  label?: string | undefined;
  className?: string;
}

export function StatusChip({ status, label, forced = false, className = '' }: Props) {
  return (
    <span
      className={`inline-flex h-[21px] shrink-0 items-center gap-1 border px-[7px] font-cond text-micro uppercase leading-none tracking-[.08em] ${CHIP[status]} ${className}`}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
        className="shrink-0"
      >
        {forced ? OVERRIDE_GLYPH : ICON[status]}
      </svg>
      {label ?? STATUS_LABEL[status]}
      {forced ? <span className="opacity-80"> · forced</span> : null}
    </span>
  );
}
