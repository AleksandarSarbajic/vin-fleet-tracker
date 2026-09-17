'use client';

import { Popup } from 'react-map-gl/mapbox';
import type { FleetRow } from '@/server/fleet-query';
import { compassPoint, elapsed, mph, timeInZone } from '@/lib/format';
import { StatusChip } from '../StatusChip';
import { OVERRIDE_REASON_LABEL } from '@/lib/override';
import { STATUS_LABEL } from '@/lib/status';

/**
 * Read-only. design-spec §9.3: the popup repeats every fact the detail panel
 * shows, so nothing critical is hover-only.
 *
 * The action row carries "Edit load" only. "Call driver" is NOT here: it is
 * hidden when `drivers.phone` is null rather than rendered as a dead button,
 * and the fleet query does not carry the phone — Samsara returns none for
 * this org, so every value would be null today. It joins when a dispatcher
 * has somewhere to type one.
 *
 * TODO(phase 5): `Projected` joins the fact list with the status engine.
 */

/**
 * FCFS prints its whole window here — the popup has the room the 128px
 * column did not, and "07:00 to 15:00" is the fact a dispatcher needs before
 * phoning a receiver (§12.22).
 */
function apptLine(stop: NonNullable<FleetRow['nextStop']>): string {
  if (!stop.apptTz || !stop.apptStartUtc) return 'none';
  const from = timeInZone(new Date(stop.apptStartUtc), stop.apptTz, { weekday: true });
  if (stop.apptType !== 'FCFS') return from;
  return stop.apptEndUtc
    ? `${from} to ${timeInZone(new Date(stop.apptEndUtc), stop.apptTz)}`
    : from;
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <>
    <span className="text-text-muted">{label}</span>
    <span className="text-text">{children}</span>
  </>
);

export function MapPopup({
  row,
  fetchedAt,
  onEdit,
  onClose,
}: {
  row: FleetRow;
  fetchedAt: string | null;
  onEdit: (id: string) => void;
  onClose: () => void;
}) {
  if (row.lat === null || row.lng === null) return null;

  const speed = mph(row.speedMph);
  const compass = compassPoint(row.heading);
  // Measured from the fetch instant, so server and client agree — see
  // TruckRow's note on hydration.
  const age = elapsed(row.recordedAt, fetchedAt ? new Date(fetchedAt) : undefined);

  return (
    <Popup
      longitude={row.lng}
      latitude={row.lat}
      anchor="bottom"
      offset={18}
      closeButton={false}
      closeOnClick={false}
      onClose={onClose}
      maxWidth="288px"
      className="ft-popup"
    >
      <div className="w-[288px] border border-accent bg-surface-raised">
        <div className="flex items-center justify-between gap-2 border-b border-line-hair px-[10px] py-2">
          <span className="font-sans text-[15px] font-bold tabular-nums text-text">
            {row.truckNumber ?? row.samsaraName}
            {row.driverName ? ` · ${row.driverName}` : ''}
          </span>
          <StatusChip status={row.status} forced={row.override !== null} />
        </div>

        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-[5px] px-[10px] py-[9px] text-[12px]">
          <Row label="Position">{row.formattedLocation ?? '—'}</Row>
          <Row label="Speed">
            <span className="tabular-nums">
              {speed ?? '—'}
              {compass ? ` · heading ${compass}` : ''}
            </span>
          </Row>
          <Row label="GPS age">
            <span className="tabular-nums">{age ?? '—'}</span>
          </Row>
          <Row label="Next stop">
            {row.nextStop
              ? `${row.nextStop.type === 'PU' ? 'Pick up' : 'Deliver'} — ${
                  [
                    row.nextStop.addressLine,
                    row.nextStop.city,
                    row.nextStop.state,
                    row.nextStop.zip,
                  ]
                    .filter(Boolean)
                    .join(', ') || '—'
                }`
              : 'No load on this truck'}
          </Row>
          {row.nextStop ? (
            <Row label={row.nextStop.apptType === 'FCFS' ? 'Receiving' : 'Appt'}>
              <span className="tabular-nums">{apptLine(row.nextStop)}</span>
            </Row>
          ) : null}
          {row.nextStop ? (
            <Row label="Load">
              {row.nextStop.loadNumber ?? (
                <span className="text-text-muted">no number yet</span>
              )}
              {row.openLoadCount > 1 ? ` · ${row.openLoadCount} open loads` : ''}
            </Row>
          ) : null}
          {/**
            * §9.5: Showing and Computed sit adjacent, each in its own colour,
            * so a dispatcher can see exactly what the override is hiding.
            * When the two agree the block collapses to a single line — which
            * here means it does not render at all, because the chip above
            * already says it.
            */}
          {row.override && row.override.forcedStatus !== row.computed ? (
            <>
              <Row label="Computed">
                <span className="text-status-risk-fg">{STATUS_LABEL[row.computed]}</span>
              </Row>
              <Row label="Forced by">
                {row.override.setByName ?? 'a dispatcher'} —{' '}
                {OVERRIDE_REASON_LABEL[row.override.reason]}
              </Row>
            </>
          ) : null}
          <Row label="Driver">
            {row.driverName ?? (
              <span className="text-status-neutral-fg">Unassigned</span>
            )}
          </Row>
        </div>

        <div className="flex justify-end border-t border-line-soft px-[10px] py-2">
          <button
            type="button"
            onClick={() => onEdit(row.id)}
            className="h-7 bg-accent px-2.5 font-cond text-micro font-semibold uppercase tracking-[.09em] text-text-inverse hover:bg-accent-hover"
          >
            Edit load
          </button>
        </div>
      </div>
    </Popup>
  );
}
