'use client';

import { STATUSES, type Status } from '@/lib/status';
import { STATUS_LABEL } from '@/lib/status';
import { elapsed } from '@/lib/format';
import { BASEMAPS, BASEMAP_CREDITS, type Basemap } from '@/lib/basemap';

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
  // Its own row since it gained the slash (§13.4). Until then it was a grey
  // ring with nothing distinct to show, and "Data issue" stood in for it.
  'UNASSIGNED',
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
    // The marker's ⊘ at legend scale — same ring, same slash, same direction
    // (markers.ts). 14px draws the 26-unit box at 0.54, so the 1.8 slash lands
    // near 1 CSS px: the heaviest line in the key, which is what keeps it from
    // blurring into the ring at this size.
    case 'UNASSIGNED':
      return (
        <svg {...common} aria-hidden="true">
          <circle
            cx="13"
            cy="13"
            r="7.2"
            strokeWidth="1.5"
            className="fill-status-neutral-bg stroke-status-neutral-fg"
          />
          <path
            d="M7.91 7.91 18.09 18.09"
            strokeWidth="1.8"
            strokeLinecap="round"
            className="stroke-status-neutral-fg"
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

const BASEMAP_LABEL: Record<Basemap, string> = { dark: 'Map', satellite: 'Satellite' };

/**
 * Dark map or satellite imagery.
 *
 * Beside the zoom control, not beneath it — and that is a measured constraint,
 * not taste. The toast stack (§14 feature 14) anchors to this pane at
 * `right-4 top-[76px]`, directly under the zoom buttons, 340px wide; a control
 * stacked under the zoom would sit exactly where every status toast lands and
 * be covered for six seconds at a time.
 *
 * `right-[56px]` is the zoom stack's 16px inset + 34px width + a 6px gap, so
 * the two read as one cluster of map controls at the same height.
 *
 * A joined pair rather than density's separated one: over satellite imagery a
 * gap between two buttons is a strip of photograph, which reads as clutter. The
 * active side is marked the way density marks it — an accent edge on an
 * overlay ground — so "a setting you chose" looks the same everywhere.
 */
export function BasemapToggle({
  basemap,
  onChange,
}: {
  basemap: Basemap;
  onChange: (basemap: Basemap) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Basemap"
      className="absolute right-[56px] top-[14px] z-10 flex border border-line-hair bg-surface-raised"
    >
      {BASEMAPS.map((option, index) => {
        const active = option === basemap;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option)}
            className={`flex h-8 items-center px-3 font-cond text-micro uppercase tracking-[.08em] transition-colors duration-ground ${
              index > 0 ? 'border-l border-line-hair' : ''
            } ${
              active
                ? 'bg-surface-overlay text-text ring-1 ring-inset ring-accent'
                : 'text-text-muted hover:bg-row-hover'
            }`}
          >
            {BASEMAP_LABEL[option]}
          </button>
        );
      })}
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
  basemap,
}: {
  newestPositionAt: string | null;
  /** Same reference as every other age on screen — see ConsoleHeader. */
  fetchedAt: string | null;
  /** Satellite imagery carries a credit of its own. */
  basemap: Basemap;
}) {
  const age = elapsed(newestPositionAt, fetchedAt ? new Date(fetchedAt) : undefined);
  return (
    /*
      `min-h`, not `h`. The credits below are required and must stay legible;
      a fixed 26px bar was already overflowing when both halves wrapped, and
      satellite adds a fifth credit. The informational half truncates; the
      required half is allowed to wrap onto a second line instead.
    */
    <div className="flex min-h-[26px] shrink-0 items-center justify-between gap-4 border-t border-line-hair px-3 py-1 font-sans text-micro normal-case tracking-normal text-text-muted">
      <span className="min-w-0 truncate">
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
      {/*
        Links, not text, and that is the correction rather than a restyle.

        Mapbox's attribution terms (checked 2026-09-24) require "© Mapbox" and
        "© OpenStreetMap" to be LINKS and require an "Improve this map" link.
        This footer carried the first two as plain text and omitted the third
        since phase 3 — while the comment above it said, correctly, that it is
        the only attribution in the product. Satellite styles additionally
        require "© Maxar". The list lives in lib/basemap.ts so a test can hold
        it to the terms.
      */}
      <span className="text-right" data-testid="map-credits">
        {BASEMAP_CREDITS[basemap].map((credit) => (
          <span key={credit.href}>
            <a
              href={credit.href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline-offset-2 hover:text-text hover:underline"
            >
              {credit.label}
            </a>
            {' · '}
          </span>
        ))}
        This product uses the Census Bureau Data API but is not endorsed or
        certified by the Census Bureau.
      </span>
    </div>
  );
}

export const MARKER_KEY_STATUSES = STATUSES;
