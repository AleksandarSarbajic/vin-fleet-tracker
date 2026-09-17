'use client';

import { STATUSES, type Status } from '@/lib/status';
import { STATUS_LABEL } from '@/lib/status';
import { elapsed } from '@/lib/format';

/**
 * Map chrome from design-spec §9.3: zoom control, marker key, and the 26px
 * footer.
 *
 * The footer is not decoration. `attributionControl` is disabled on the Map so
 * Mapbox's own control does not fight this layout, which means the "© Mapbox ·
 * OpenStreetMap" line here is the ONLY attribution in the product — and
 * attribution is a condition of the Mapbox terms, not a nicety. Do not remove
 * it without replacing it.
 */

const KEY_ROWS: Status[] = [
  'LATE',
  'AT_RISK',
  'ON_TIME',
  'ARRIVED',
  'TOMORROW',
  'STALE_GPS',
];

/**
 * Small flat swatches matching the marker shapes, at legend scale.
 *
 * `fill-*` and `stroke-*` are Tailwind utilities over the same colour tokens
 * as the chips, so the key cannot drift from the markers it explains.
 */
function Swatch({ status }: { status: Status }) {
  const common = { width: 14, height: 14, viewBox: '0 0 26 26' } as const;
  switch (status) {
    case 'LATE':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M13 4 22 20H4Z" className="fill-status-late-fg" />
        </svg>
      );
    case 'AT_RISK':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M13 4 21 12l-8 8-8-8Z" className="fill-status-risk-fg" />
        </svg>
      );
    case 'ON_TIME':
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="13" cy="13" r="7.5" className="fill-status-ontime-fg" />
        </svg>
      );
    case 'ARRIVED':
      return (
        <svg {...common} aria-hidden="true">
          <rect x="6" y="6" width="14" height="14" className="fill-status-arrived-fg" />
        </svg>
      );
    case 'TOMORROW':
      return (
        <svg {...common} aria-hidden="true">
          <circle
            cx="13"
            cy="13"
            r="7"
            fill="none"
            strokeWidth="1.5"
            className="stroke-status-tomorrow-fg"
          />
        </svg>
      );
    default:
      return (
        <svg {...common} aria-hidden="true">
          <circle
            cx="13"
            cy="13"
            r="7.2"
            strokeWidth="1.5"
            strokeDasharray="1.5 2.2"
            className="fill-status-neutral-bg stroke-status-neutral-fg"
          />
        </svg>
      );
  }
}

export function ZoomControl({
  onZoom,
}: {
  onZoom: (direction: 1 | -1) => void;
}) {
  return (
    <div className="absolute right-4 top-[14px] z-10 flex flex-col border border-line-hair">
      {([1, -1] as const).map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => onZoom(d)}
          aria-label={d === 1 ? 'Zoom in' : 'Zoom out'}
          className={`flex h-8 w-8 items-center justify-center bg-surface-raised font-sans text-base text-text ${d === 1 ? 'border-b border-line-hair' : ''}`}
        >
          {d === 1 ? '+' : '−'}
        </button>
      ))}
    </div>
  );
}

export function MarkerKey() {
  return (
    <div className="absolute bottom-[14px] right-4 z-10 flex flex-col gap-[5px] border border-line-hair bg-surface-scrim px-[11px] py-[9px]">
      <span className="mb-0.5 font-cond text-micro uppercase text-text-muted">
        Marker key
      </span>
      {KEY_ROWS.map((status) => (
        <span
          key={status}
          className="flex items-center gap-[7px] font-sans text-[11px] text-text-secondary"
        >
          <Swatch status={status} />
          {status === 'STALE_GPS' ? 'Data issue' : STATUS_LABEL[status]}
        </span>
      ))}
    </div>
  );
}

export function MapFooter({
  newestPositionAt,
  fetchedAt,
}: {
  newestPositionAt: string | null;
  /** Same reference as every other age on screen — see ConsoleHeader. */
  fetchedAt: string | null;
}) {
  const age = elapsed(newestPositionAt, fetchedAt ? new Date(fetchedAt) : undefined);
  return (
    <div className="flex h-[26px] shrink-0 items-center justify-between border-t border-line-hair px-3 font-sans text-micro normal-case tracking-normal text-text-muted">
      <span>
        Positions from ELD{age ? ` · newest ${age} ago` : ''} · problem markers
        never cluster
      </span>
      {/*
        * Required credit, both of them.
        *
        * Mapbox's terms require theirs and the Map's own control is disabled.
        * The Census notice is the Bureau's own prescribed wording: the
        * geocoder's API docs state no terms, but the Census Bureau API Terms
        * of Service require this notice "prominently within the application",
        * and the scope is ambiguous enough that including it costs one line
        * and excluding it is a bet. Phase 3 already missed an attribution
        * once; this is what not repeating that looks like.
        */}
      <span>
        © Mapbox · OpenStreetMap · This product uses the Census Bureau Data API
        but is not endorsed or certified by the Census Bureau.
      </span>
    </div>
  );
}

export const MARKER_KEY_STATUSES = STATUSES;
