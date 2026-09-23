'use client';

import type { ReassignPreview } from '@/server/reassign';
import { timeInZone } from '@/lib/format';
import { useFocusTrap } from './useModalChrome';
import { DriverName } from '@/components/DriverName';

/**
 * §9.10 — two trucks affected, both sides stated, rendered entirely from the
 * SERVER's preview. The client cannot know what the losing truck's next
 * appointment is; a dialog that guesses is a dialog that lies on the one
 * occasion it matters.
 */

function Appt({ utc, tz }: { utc: string | null; tz: string | null }) {
  if (!utc || !tz) return <span className="text-text-mutedOnOverlay">none</span>;
  return <span className="tabular-nums">{timeInZone(new Date(utc), tz, { weekday: true })}</span>;
}

export function ReassignConfirm({
  preview,
  busy,
  onCancel,
  onConfirm,
}: {
  preview: ReassignPreview;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const trap = useFocusTrap(true);
  const { gaining, losing } = preview;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-scrim p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm reassignment"
    >
      <div
        ref={trap}
        className="w-[620px] max-w-full border border-line-hair bg-surface-overlay shadow-modal"
      >
        <div className="border-b border-line-soft px-4 py-3">
          <h2 className="font-cond text-[17px] font-semibold uppercase leading-[1.1] tracking-[.06em] text-text">
            {losing ? 'Confirm reassignment — two trucks affected' : 'Confirm assignment'}
          </h2>
        </div>

        <div className="p-4">
          <div className="grid grid-cols-2 border border-line-hair">
            <div className="border-r border-line-hair p-3">
              <p className="font-sans text-data font-bold tabular-nums text-text">
                {gaining.truckLabel}
              </p>
              <p className="mb-2 font-cond text-micro uppercase tracking-[.1em] text-text-mutedOnOverlay">
                gains a driver
              </p>
              <Line label="From">
                <span className="line-through">
                  <DriverName
                    name={gaining.driverName}
                    source={gaining.driverSource}
                    samsaraDriverId={gaining.driverSamsaraId}
                    fallback="Unassigned"
                  />
                </span>
              </Line>
              <Line label="To">{gaining.toDriverName ?? 'Unassigned'}</Line>
              <Line label="Next appt">
                <Appt utc={gaining.nextApptUtc} tz={gaining.nextApptTz} />
              </Line>
            </div>

            <div className="bg-surface-sunken p-3">
              {losing ? (
                <>
                  <p className="font-sans text-data font-bold tabular-nums text-text">
                    {losing.truckLabel}
                  </p>
                  <p className="mb-2 font-cond text-micro uppercase tracking-[.1em] text-status-neutral-fg">
                    loses its driver
                  </p>
                  <Line label="Was">
                    <span className="line-through">
                      <DriverName
                        name={losing.driverName}
                        source={losing.driverSource}
                        samsaraDriverId={losing.driverSamsaraId}
                        fallback="—"
                      />
                    </span>
                  </Line>
                  <Line label="Becomes">
                    <span className="text-status-neutral-fg">Unassigned</span>
                  </Line>
                  <Line label="Next appt">
                    <Appt utc={losing.nextApptUtc} tz={losing.nextApptTz} />
                  </Line>
                </>
              ) : (
                <p className="text-body text-text-mutedOnOverlay">
                  No other truck is affected — this driver is not on one.
                </p>
              )}
            </div>
          </div>

          <p className="mt-3 text-[13px] leading-[1.6] text-text">{preview.summary}</p>
          <p className="mt-2 text-small text-text-mutedOnOverlay">{preview.note}</p>
        </div>

        <div className="flex items-center justify-between border-t border-line-hair bg-surface-raised px-4 py-3">
          <span className="text-small text-text-mutedOnOverlay">
            {losing
              ? `Reversible from truck ${losing.truckLabel}'s history — history ships in v2.`
              : 'Reversible by clearing the driver again.'}
          </span>
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={onCancel}
              className="h-10 border border-line-hair px-4 font-cond text-micro uppercase tracking-[.09em] text-text-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className="h-10 bg-accent px-4 font-cond text-micro font-semibold uppercase tracking-[.09em] text-text-inverse hover:bg-accent-hover disabled:opacity-45"
            >
              {busy ? 'Saving…' : losing ? 'Reassign both trucks' : 'Assign driver'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="grid grid-cols-[76px_1fr] gap-x-2 text-body text-text">
      <span className="text-text-mutedOnOverlay">{label}</span>
      <span className="truncate">{children}</span>
    </p>
  );
}
