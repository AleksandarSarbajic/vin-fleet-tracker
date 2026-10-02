'use client';

import { Fragment, useEffect, useRef } from 'react';
import type { FleetRow } from '@/server/fleet-query';
import { compassPoint, elapsed, mph } from '@/lib/format';
import { upcomingLabel, STATUS_LABEL } from '@/lib/status';
import { OVERRIDE_REASON_LABEL } from '@/lib/override';
import { DESKTOP_ONLY } from '@/lib/editing';
import { useReturnFocus } from '@/components/edit/useModalChrome';
import { DriverName } from '@/components/DriverName';
import { StatusChip } from '../StatusChip';
import { etaCaution, etaDetails } from '../TruckRow';
import { apptLine, projectedLine } from '../map/MapPopup';

/**
 * §12.96, stage 3 — the truck sheet. On a phone it replaces the map popup
 * (which is not drawn below 768px), and it opens from a card's tap and from
 * a marker's. A sheet from the bottom over the board, never taller than the
 * screen: its header (truck, status, a 44px Close) and its buttons stay put,
 * and the facts between them scroll.
 *
 * The facts are the popup's own, formatted by the popup's own functions, so
 * the two cannot drift: the ETA with its basis ("routed road miles" or
 * "straight-line estimate"), the appointment under an "Appt" label.
 *
 * Call driver is a plain `tel:` link to a number that dials as it stands
 * (`lib/dial`), or nothing. No messaging, no `sms:` — nothing is sent to
 * anyone. The number is in the link only, never printed.
 *
 * Editing stays on the desktop (§12.94): where the popup's Edit load was,
 * the sheet says so. It handles no keys.
 */
export function TruckSheet({
  row,
  fetchedAt,
  feedStale,
  tel,
  onClose,
  onTimeline,
  onShowOnMap,
}: {
  row: FleetRow;
  fetchedAt: string | null;
  feedStale: boolean;
  /** `tel:+1…` for a dialable number, else null (`dialableTel`). */
  tel: string | null;
  onClose: () => void;
  onTimeline: (id: string) => void;
  onShowOnMap: (id: string) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useReturnFocus(true);
  useEffect(() => {
    panel.current?.focus();
  }, [row.id]);

  const label = String(row.truckNumber ?? row.samsaraName);
  const stop = row.nextStop;
  const stale = feedStale || row.status === 'STALE_GPS';
  const reference = fetchedAt ? new Date(fetchedAt) : undefined;
  const age = elapsed(row.recordedAt, reference);
  const speed = mph(row.speedMph);
  const compass = compassPoint(row.heading);
  const details = etaDetails(row);

  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <button
        type="button"
        aria-label="Close the truck sheet"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-scrim"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`Truck ${label}`}
        data-truck-sheet=""
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 flex max-h-[calc(100dvh-12px)] flex-col border-t border-accent bg-surface-raised outline-none"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-line-hair py-1.5 pl-4 pr-2">
          <h2 className="min-w-0 flex-1 font-sans text-[18px] font-bold tabular-nums text-text">
            {label}
          </h2>
          <span data-sheet-field="status" className="flex shrink-0 items-center">
            <StatusChip
              status={feedStale ? 'STALE_GPS' : row.status}
              forced={!feedStale && row.override !== null}
              label={
                stale
                  ? (age ?? undefined)
                  : row.status === 'TOMORROW' && row.upcoming
                    ? upcomingLabel(row.upcoming)
                    : undefined
              }
            />
          </span>
          <button
            type="button"
            onClick={onClose}
            className="h-11 min-w-11 shrink-0 border border-line-control px-3 font-cond text-[13px] font-semibold uppercase tracking-[.08em] text-text"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 font-sans text-[14px] leading-snug">
            <Fact field="next-stop" label="Next stop">
              {stop
                ? `${stop.type === 'PU' ? 'Pick up' : 'Deliver'} — ${
                    [stop.addressLine, stop.city, stop.state, stop.zip]
                      .filter(Boolean)
                      .join(', ') || 'no address'
                  }`
                : 'No load on this truck'}
            </Fact>
            <Fact field="appointment" label="Appt">
              <span className="tabular-nums">
                {stop
                  ? `${stop.apptType === 'FCFS' ? 'receiving ' : ''}${apptLine(stop)}`
                  : 'none'}
              </span>
            </Fact>
            <Fact field="eta" label="ETA">
              <span className="tabular-nums">{stop ? projectedLine(row) : '—'}</span>
              {feedStale && stop ? (
                <span className="block text-status-risk-fg">
                  Feed down: built on positions we no longer trust.
                </span>
              ) : null}
              {row.etaPrecision === 'zip' || row.etaPrecision === 'block' ? (
                <span className="block text-status-risk-fg">{etaCaution(row)}</span>
              ) : null}
              {stop && details.length > 0 ? (
                <details>
                  <summary className="min-h-11 cursor-pointer py-2.5 text-text-secondary">
                    How this was measured
                  </summary>
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                    {details.map((d) => (
                      <Fragment key={d.label}>
                        <dt className="text-text-muted">{d.label}</dt>
                        <dd className="break-words text-text">{d.value}</dd>
                      </Fragment>
                    ))}
                  </dl>
                </details>
              ) : null}
            </Fact>
            <Fact field="position" label="Position">
              {stale ? 'Last seen ' : ''}
              {row.formattedLocation ?? row.cityState ?? '—'}
            </Fact>
            <Fact field="speed" label="Speed">
              <span className="tabular-nums">
                {speed ?? '—'}
                {compass ? ` · heading ${compass}` : ''}
              </span>
            </Fact>
            <Fact field="gps-age" label="GPS age">
              <span className="tabular-nums">{age ?? '—'}</span>
            </Fact>
            <Fact field="load" label="Load">
              {stop?.loadNumber ?? <span className="text-text-muted">no number yet</span>}
              {row.openLoadCount > 1 ? ` · ${row.openLoadCount} open loads` : ''}
            </Fact>
            {row.override && row.override.forcedStatus !== row.computed ? (
              <>
                <Fact field="computed" label="Computed">
                  <span className="text-status-risk-fg">
                    {STATUS_LABEL[row.computed]}
                  </span>
                </Fact>
                <Fact field="forced-by" label="Forced by">
                  {row.override.setByName ?? 'a dispatcher'} —{' '}
                  {OVERRIDE_REASON_LABEL[row.override.reason]}
                </Fact>
              </>
            ) : null}
            <Fact field="driver" label="Driver">
              <DriverName
                name={row.driverName}
                source={row.driverSource}
                samsaraDriverId={row.driverSamsaraId}
                fallback={<span className="text-status-neutral-fg">Unassigned</span>}
              />
            </Fact>
          </dl>
        </div>

        <div className="shrink-0 border-t border-line-soft px-3 pb-3 pt-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onTimeline(row.id)}
              className="h-11 flex-1 border border-line-control px-3 font-cond text-[13px] font-semibold uppercase tracking-[.08em] text-text"
            >
              Timeline
            </button>
            <button
              type="button"
              onClick={() => onShowOnMap(row.id)}
              className="h-11 flex-1 whitespace-nowrap border border-line-control px-3 font-cond text-[13px] font-semibold uppercase tracking-[.08em] text-text"
            >
              Show on map
            </button>
            {tel ? (
              <a
                href={tel}
                data-call-driver=""
                aria-label={row.driverName ? `Call ${row.driverName}` : 'Call driver'}
                className="flex h-11 flex-1 items-center justify-center whitespace-nowrap bg-accent px-3 font-cond text-[13px] font-semibold uppercase tracking-[.08em] text-text-inverse"
              >
                Call driver
              </a>
            ) : null}
          </div>
          <p
            data-desktop-only=""
            className="mt-2 font-sans text-[13px] text-text-mutedOnOverlay"
          >
            {DESKTOP_ONLY}
          </p>
        </div>
      </div>
    </div>
  );
}

function Fact({
  field,
  label,
  children,
}: {
  field: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-text-muted">{label}</dt>
      <dd data-sheet-field={field} className="min-w-0 break-words text-text">
        {children}
      </dd>
    </>
  );
}
