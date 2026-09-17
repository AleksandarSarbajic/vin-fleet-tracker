'use client';

import { StatusChip } from '@/components/console/StatusChip';
import {
  EXPIRY_LABEL,
  EXPIRY_PRESETS,
  OVERRIDE_REASON_LABEL,
  type ExpiryPreset,
} from '@/lib/override';
import { OVERRIDE_REASONS, type ForcedStatus, type Status } from '@/lib/status';
import { timeInZone } from '@/lib/format';

/**
 * design-spec §9.5, held back from phase 4 because it renders the COMPUTED
 * status beside the forced one and the engine that computes it did not exist.
 *
 * A forced status changes the chip and nothing else: the stripe and the sort
 * are untouched, so the list still reads by urgency while a reviewer can see
 * which reds are decisions rather than measurements.
 */

export interface OverrideDraft {
  /** 'AUTO' means no override — the segmented control's rest state. */
  forced: ForcedStatus | 'AUTO';
  reason: (typeof OVERRIDE_REASONS)[number] | '';
  reasonNote: string;
  expiry: ExpiryPreset;
  customDate: string;
  customTime: string;
}

const SEGMENTS: { value: ForcedStatus | 'AUTO'; label: string }[] = [
  { value: 'AUTO', label: 'Auto' },
  { value: 'LATE', label: 'Force late' },
  { value: 'ARRIVED', label: 'Arrived' },
  { value: 'NO_APPT', label: 'No appt' },
];

export function OverrideBlock({
  draft,
  onChange,
  computed,
  live,
  disabled,
  onClearNow,
  errors,
}: {
  draft: OverrideDraft;
  onChange: (next: OverrideDraft) => void;
  /** What the engine says right now, override or not. */
  computed: Status;
  /** The override currently in force, if any. */
  live: {
    forcedStatus: ForcedStatus;
    reasonLabel: string;
    setByName: string | null;
    setAtUtc: string;
    expiresAtUtc: string;
  } | null;
  disabled: boolean;
  onClearNow: () => void;
  errors: (field: string) => string | undefined;
}) {
  const set = (patch: Partial<OverrideDraft>) => onChange({ ...draft, ...patch });
  const forcing = draft.forced !== 'AUTO';
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <fieldset disabled={disabled} className="mt-4 border-0 p-0">
      <legend className="mb-2 w-full border-b border-line-soft pb-1.5 font-cond text-micro uppercase tracking-[.11em] text-text-muted">
        Status override
      </legend>

      <div className="flex border border-line-hair">
        {SEGMENTS.map((segment) => (
          <button
            key={segment.value}
            type="button"
            onClick={() => set({ forced: segment.value })}
            aria-pressed={draft.forced === segment.value}
            className={`h-9 flex-1 border-l border-line-hair px-3 font-cond text-micro uppercase tracking-[.08em] first:border-l-0 ${
              draft.forced === segment.value
                ? 'bg-accent text-text-inverse'
                : 'bg-surface-overlay text-text-muted'
            }`}
          >
            {segment.label}
          </button>
        ))}
      </div>

      {/* The engine keeps computing the real status the whole time (§9.5). */}
      <div className="mt-2 flex items-center justify-between border border-line-hair bg-surface-raised px-[11px] py-[9px]">
        <span className="text-small text-text-muted">
          {forcing ? 'Computed status, currently overridden' : 'Computed status'}
        </span>
        <StatusChip status={computed} />
      </div>

      {forcing ? (
        <>
          <div className="mt-3 grid grid-cols-[1.4fr_1fr] gap-3">
            <label className="block">
              <span className="mb-1 block text-small text-text-secondary">
                Reason <span className="text-status-late-fg">· required</span>
              </span>
              <select
                value={draft.reason}
                onChange={(e) =>
                  set({ reason: e.target.value as OverrideDraft['reason'] })
                }
                className={`h-10 w-full border bg-surface-sunken px-2 text-body text-text ${
                  errors('reason') ? 'border-status-late-fg' : 'border-line-hair'
                }`}
              >
                <option value="">Pick a reason…</option>
                {OVERRIDE_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {OVERRIDE_REASON_LABEL[reason]}
                  </option>
                ))}
              </select>
              {errors('reason') ? (
                <span className="mt-1 block text-small text-status-late-fg">
                  {errors('reason')}
                </span>
              ) : null}
            </label>

            <label className="block">
              <span className="mb-1 block text-small text-text-secondary">Expires</span>
              <div className="flex flex-wrap gap-1.5">
                {EXPIRY_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => set({ expiry: preset })}
                    aria-pressed={draft.expiry === preset}
                    className={`h-[26px] border px-2 font-cond text-micro uppercase tracking-[.08em] ${
                      draft.expiry === preset
                        ? 'border-accent bg-surface-overlay text-text'
                        : 'border-line-soft text-text-muted'
                    }`}
                  >
                    {EXPIRY_LABEL[preset]}
                  </button>
                ))}
              </div>
            </label>
          </div>

          {/* Countable in review rather than merely readable (§9.5). */}
          {draft.reason === 'OTHER' ? (
            <label className="mt-3 block">
              <span className="mb-1 block text-small text-text-secondary">
                What does &ldquo;Other&rdquo; mean here{' '}
                <span className="text-status-late-fg">· required</span>
              </span>
              <input
                type="text"
                value={draft.reasonNote}
                onChange={(e) => set({ reasonNote: e.target.value })}
                className={`h-10 w-full border bg-surface-sunken px-2.5 text-body text-text ${
                  errors('reasonNote') ? 'border-status-late-fg' : 'border-line-hair'
                }`}
              />
              {errors('reasonNote') ? (
                <span className="mt-1 block text-small text-status-late-fg">
                  {errors('reasonNote')}
                </span>
              ) : null}
            </label>
          ) : null}

          {draft.expiry === 'CUSTOM' ? (
            <div className="mt-3 grid grid-cols-3 gap-3">
              <label className="block">
                <span className="mb-1 block text-small text-text-secondary">
                  Expiry date
                </span>
                <input
                  type="date"
                  value={draft.customDate}
                  onChange={(e) => set({ customDate: e.target.value })}
                  className="h-10 w-full border border-line-hair bg-surface-sunken px-2.5 text-body tabular-nums text-text"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-small text-text-secondary">
                  Expiry time ({zone})
                </span>
                <input
                  type="time"
                  value={draft.customTime}
                  onChange={(e) => set({ customTime: e.target.value })}
                  className="h-10 w-full border border-line-hair bg-surface-sunken px-2.5 text-body tabular-nums text-text"
                />
              </label>
              <p className="col-span-1 self-end pb-2.5 text-small text-text-muted">
                Wall time in your own zone, converted on the server — the same
                path an appointment takes.
              </p>
            </div>
          ) : (
            <p className="mt-2 text-small text-text-muted">
              There is no &ldquo;never&rdquo;. At expiry the row returns to its
              computed status silently — nothing was decided by a person at that
              moment, so there is no toast.
            </p>
          )}
        </>
      ) : null}

      {live ? (
        <div className="mt-3 border border-status-risk-bd bg-surface-base p-[14px]">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-cond text-[12px] uppercase tracking-[.11em] text-status-risk-fg">
              Status forced by a dispatcher
            </span>
            <button
              type="button"
              onClick={onClearNow}
              className="h-[22px] border border-line-hair px-2 font-cond text-micro uppercase tracking-[.08em] text-text-secondary"
            >
              Clear now
            </button>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-[14px] gap-y-[7px] text-body">
            <dt className="text-text-muted">Showing</dt>
            <dd className="text-text">{live.forcedStatus} — forced</dd>
            <dt className="text-text-muted">Reason</dt>
            <dd className="text-text">{live.reasonLabel}</dd>
            <dt className="text-text-muted">Set by</dt>
            <dd className="text-text">
              {live.setByName ?? 'unknown'} ·{' '}
              {timeInZone(new Date(live.setAtUtc), zone, { weekday: true })}
            </dd>
            <dt className="text-text-muted">Expires</dt>
            <dd className="tabular-nums text-text">
              {timeInZone(new Date(live.expiresAtUtc), zone, { weekday: true })}
            </dd>
          </dl>
        </div>
      ) : null}
    </fieldset>
  );
}
