'use client';

import { Popup } from 'react-map-gl/mapbox';
import type { FleetRow } from '@/server/fleet-query';
import { compassPoint, elapsed, mph } from '@/lib/format';
import { StatusChip } from '../StatusChip';

/**
 * Read-only. design-spec §9.3: the popup repeats every fact the detail panel
 * shows, so nothing critical is hover-only.
 *
 * TODO(phase 4): the action row goes at the bottom of this component —
 * "Edit load" (primary) and "Call driver" (secondary, HIDDEN when
 * drivers.phone is null rather than rendered as a dead button). Their absence
 * here is phase-3 scope, not a design decision.
 *
 * TODO(phase 4): Next stop, Appt (with its stop-local time) and Projected
 * join the fact list once loads and stops exist.
 */

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <>
    <span className="text-text-muted">{label}</span>
    <span className="text-text">{children}</span>
  </>
);

export function MapPopup({ row, onClose }: { row: FleetRow; onClose: () => void }) {
  if (row.lat === null || row.lng === null) return null;

  const speed = mph(row.speedMph);
  const compass = compassPoint(row.heading);
  const age = elapsed(row.recordedAt);

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
          <StatusChip status={row.status} />
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
          {row.driverIsPlaceholder ? (
            <Row label="Driver">
              <span className="text-text-muted">placeholder — phase 4</span>
            </Row>
          ) : null}
        </div>
      </div>
    </Popup>
  );
}
