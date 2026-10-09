'use client';

import { Fragment, type ReactNode } from 'react';
import type { Status } from '@/lib/status';
import { StatusChip } from '@/components/console/StatusChip';
import { AppointmentFields } from './AppointmentFields';
import { ArrivalFields } from './ArrivalFields';
import { Field } from './Field';
import { splitPastedAddress, type AddressField } from '@/lib/paste-address';
import { zipStateCheck } from '@/lib/geo/zip-state';
import { sourceLine } from './ratecon-fill';
import {
  LEFT_STOP_NOTE,
  zoneSource,
  type RemoveBlock,
  type StopFlags,
  type StopForm as StopFormState,
} from './load-form';
import { STOP_FORM_ID, stopTabId } from './StopList';

/**
 * §12.119. The selected stop's form: where and when it is, whether the truck
 * reached and left it, and the note. The fields, labels and rules are the
 * one-stop modal's; what is new is that they belong to ONE stop of several.
 *
 *   - A stop the truck has LEFT keeps its address, type and appointment
 *     (§12.116 D4); its note, arrival and departure stay correctable.
 *   - Its arrival cannot be ticked while an earlier stop has not been left
 *     (D5) — the reason is under the box.
 *   - The status override, the ETA basis and the computed status belong to
 *     the board's NEXT stop only (D2): the engine computes nothing for the
 *     others. They are passed in for that stop and absent for the rest.
 */
export function StopForm({
  stop,
  index,
  flags,
  mayEdit,
  loadExists,
  dispatchTz,
  storedWindow,
  initialFocus,
  addressChanged,
  computed,
  basisDetails,
  overrideBlock,
  notNextNote,
  errorFor,
  onChange,
  onConfirmZone,
  onPasteAddress,
  onUndoPaste,
  onTakePasted,
  removeBlocked,
  onRemove,
  orderNote,
}: {
  stop: StopFormState;
  index: number;
  flags: StopFlags;
  mayEdit: boolean;
  /** False on a new load: there is nothing to have arrived at yet. */
  loadExists: boolean;
  dispatchTz: string;
  storedWindow: number | undefined;
  initialFocus: boolean;
  addressChanged: boolean;
  /** The board's computed status, for the next stop of an existing load. */
  computed: Status | null;
  basisDetails: { label: string; value: string }[];
  overrideBlock: ReactNode;
  /** Said instead of the override on a stop that is not the next one. */
  notNextNote: string | null;
  errorFor: (field: string) => string | undefined;
  onChange: (patch: Partial<StopFormState>) => void;
  /** §12.120. "Zone is right", under an uncertain zone. */
  onConfirmZone: () => void;
  /** §12.121. An address pasted into Street, already split. */
  onPasteAddress: (pasted: NonNullable<ReturnType<typeof splitPastedAddress>>) => void;
  /** §12.121. ⌘/Ctrl+Z straight after a paste. */
  onUndoPaste: () => void;
  /** §12.121. "Use the pasted ones" for what was kept. */
  onTakePasted: () => void;
  /** Why this stop cannot be removed — reached, the only one, the role — or null. */
  removeBlocked: RemoveBlock | null;
  onRemove: () => void;
  /** §12.119. The delivery-before-pickup note, under the appointment; display only. */
  orderNote: string | null;
}) {
  const locked = flags.departed;
  const paste = stop.paste;
  const fill = stop.fill;
  /**
   * §12.122. A ZIP that is not in its state — said for a stop being entered
   * or changed here, not for one opened as it was saved.
   */
  const addressTouched =
    !stop.stored ||
    stop.stored.state !== (stop.state.trim().toUpperCase() || null) ||
    stop.stored.zip !== (stop.zip.trim() || null);
  const zipState = addressTouched ? zipStateCheck(stop.state, stop.zip) : null;
  const checkOf = (field: AddressField) => paste?.checks[field] ?? fill?.checks[field];
  const lockedTitle = locked ? LEFT_STOP_NOTE : undefined;
  const removeWhyId = `${STOP_FORM_ID}-remove-why`;

  return (
    <div
      id={STOP_FORM_ID}
      role="tabpanel"
      aria-labelledby={stopTabId(stop.key)}
      data-stop-form={index + 1}
      className="flex min-w-0 flex-col gap-3 px-4 pb-4 pt-3"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="font-cond text-[15px] font-semibold uppercase tracking-[.07em] text-text">
          Stop {index + 1}
        </span>
        <div role="group" aria-label="Stop type" className="flex">
          {(
            [
              ['PU', 'Pick up'],
              ['DEL', 'Deliver'],
            ] as const
          ).map(([type, label]) => {
            const on = stop.stopType === type;
            return (
              <button
                key={type}
                type="button"
                aria-pressed={on}
                disabled={!mayEdit || locked}
                title={lockedTitle}
                onClick={() => onChange({ stopType: type })}
                className={`h-[30px] border px-3 font-cond text-micro font-semibold uppercase tracking-[.09em] disabled:opacity-60 ${
                  on
                    ? 'border-accent bg-accent text-text-inverse'
                    : 'border-line-hair text-text-secondary'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        {flags.next && loadExists ? (
          <span className="inline-flex h-5 items-center bg-accent px-[7px] font-cond text-[10.5px] font-bold uppercase leading-none tracking-[.09em] text-text-inverse">
            Next stop
          </span>
        ) : null}
        {flags.next && computed ? <StatusChip status={computed} /> : null}
        <button
          type="button"
          data-remove-stop=""
          disabled={removeBlocked !== null}
          title={removeBlocked?.text}
          aria-describedby={removeBlocked ? removeWhyId : undefined}
          onClick={onRemove}
          className="ml-auto h-[30px] border border-line-hair px-3 font-cond text-micro uppercase tracking-[.09em] text-text-secondary hover:border-status-late-bd hover:text-status-late-fg disabled:opacity-45 disabled:hover:border-line-hair disabled:hover:text-text-secondary"
        >
          Remove stop
        </button>
        {removeBlocked && !removeBlocked.reached ? (
          <span id={removeWhyId} className="sr-only">
            {removeBlocked.text}
          </span>
        ) : null}
      </div>

      {fill?.sources.stopType || fill?.checks.stopType ? (
        <div data-type-fill="" className="flex flex-col gap-0.5 text-small">
          {fill.checks.stopType ? <p className="text-status-risk-fg">Check: {fill.checks.stopType}</p> : null}
          {fill.sources.stopType ? (
            <p className="break-words text-text-mutedOnOverlay">{sourceLine(fill.sources.stopType)}</p>
          ) : null}
        </div>
      ) : null}

      {/* A stop the truck reached says so, in words, not only on hover. */}
      {removeBlocked?.reached ? (
        <p
          id={removeWhyId}
          className="border-l border-line-soft pl-3 text-small text-text-mutedOnOverlay"
          data-remove-why=""
        >
          {removeBlocked.text}
        </p>
      ) : null}

      {locked ? (
        <p className="border-l border-line-soft pl-3 text-small text-text-mutedOnOverlay" data-left-stop-note="">
          {LEFT_STOP_NOTE}
        </p>
      ) : null}

      {errorFor('*') ? (
        <p role="alert" className="border border-status-late-bd bg-status-late-bg px-3 py-2 text-body text-status-late-fg">
          {errorFor('*')}
        </p>
      ) : null}

      <fieldset
        disabled={!mayEdit || locked}
        title={lockedTitle}
        className="border-0 p-0"
        onKeyDown={(e) => {
          // §12.121. The paste was one step, so its undo is one step — only
          // until a field is typed in, when the browser's own undo takes over.
          if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && paste?.before) {
            e.preventDefault();
            onUndoPaste();
          }
        }}
      >
        <div className="grid grid-cols-4 gap-x-3 gap-y-2">
          <div className="col-span-4">
            <Field
              label="Street address"
              value={stop.addressLine}
              onChange={(v) => onChange({ addressLine: v })}
              onPaste={(e) => {
                // Only a paste, never typing; and text that is not an address to
                // split goes in exactly as the browser would put it.
                const pasted = splitPastedAddress(e.clipboardData.getData('text/plain'));
                if (!pasted) return;
                e.preventDefault();
                onPasteAddress(pasted);
              }}
              error={errorFor('addressLine')}
              check={checkOf('addressLine')}
              source={sourceLine(fill?.sources.addressLine)}
            />
          </div>
          <Field
            label="ZIP"
            value={stop.zip}
            onChange={(v) => onChange({ zip: v })}
            error={errorFor('zip')}
            check={checkOf('zip') ?? zipState ?? undefined}
            source={sourceLine(fill?.sources.zip)}
          />
          <div className="col-span-2">
            <Field
              label="City"
              value={stop.city}
              onChange={(v) => onChange({ city: v })}
              error={errorFor('city')}
              check={checkOf('city')}
              source={sourceLine(fill?.sources.city)}
            />
          </div>
          <Field
            label="State"
            value={stop.state}
            onChange={(v) => onChange({ state: v })}
            placeholder="IL"
            error={errorFor('state')}
            check={checkOf('state')}
            source={sourceLine(fill?.sources.state)}
          />
        </div>
      </fieldset>

      {paste ? <PasteNote paste={paste} onTakePasted={onTakePasted} mayEdit={mayEdit && !locked} /> : null}

      {/* §12.33: the basis in full, under the address that produced it. */}
      {basisDetails.length > 0 ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-l border-line-soft py-1 pl-3 text-small">
          {basisDetails.map((detail) => (
            <Fragment key={detail.label}>
              <dt className="text-text-mutedOnOverlay">{detail.label}</dt>
              <dd className="text-text-secondary">{detail.value}</dd>
            </Fragment>
          ))}
        </dl>
      ) : null}

      <AppointmentFields
        draft={stop.appointment}
        onChange={(next) => onChange({ appointment: next })}
        storedWindow={storedWindow}
        dispatchTz={dispatchTz}
        disabled={!mayEdit || locked}
        initialFocus={initialFocus}
        error={errorFor('appointment.time')}
        dateError={errorFor('appointment.date')}
        endError={errorFor('appointment.endTime')}
        zoneCheck={errorFor('appointment.tz')}
        zoneSource={zoneSource(stop)}
        fillSource={sourceLine(fill?.sources.appointment)}
        fillCheck={fill?.checks.appointment}
        onConfirmZone={onConfirmZone}
      />

      {orderNote ? (
        <p className="border-l border-line-soft pl-3 text-small text-text-mutedOnOverlay" data-order-note="">
          {orderNote}
        </p>
      ) : null}

      <ArrivalFields
        draft={stop.arrival}
        onChange={(next) => onChange({ arrival: next })}
        departure={stop.departure}
        onDepartureChange={(next) => onChange({ departure: next })}
        zone={stop.appointment.tz}
        storedSource={stop.stored?.arrivedSource ?? null}
        addressChanged={addressChanged}
        disabled={!mayEdit || !loadExists}
        arrivalBlocked={flags.arrivalBlocked}
        error={
          errorFor('arrivedAt.time') ??
          errorFor('arrivedAt.date.y') ??
          errorFor('arrivedAt.date.m') ??
          errorFor('arrivedAt.date.d') ??
          errorFor('arrivedAt.time.h') ??
          errorFor('arrivedAt.time.min')
        }
        departureError={
          errorFor('departedAt.time') ??
          errorFor('departedAt.date.y') ??
          errorFor('departedAt.date.m') ??
          errorFor('departedAt.date.d') ??
          errorFor('departedAt.time.h') ??
          errorFor('departedAt.time.min')
        }
      />

      <fieldset disabled={!mayEdit} className="border-0 p-0">
        <legend className="mb-2 w-full border-b border-line-soft pb-1.5 font-cond text-micro uppercase tracking-[.11em] text-text-mutedOnOverlay">
          Dispatcher note · visible to the next shift
        </legend>
        <textarea
          value={stop.note}
          onChange={(e) => onChange({ note: e.target.value })}
          className="h-14 w-full border border-line-hair bg-surface-sunken p-2 text-[13px] leading-[1.5] text-text"
        />
      </fieldset>

      {overrideBlock}
      {notNextNote ? (
        <p className="text-small text-text-mutedOnOverlay" data-override-elsewhere="">
          {notNextNote}
        </p>
      ) : null}
    </div>
  );
}

const FIELD_NAMES: Record<AddressField, string> = {
  addressLine: 'street',
  city: 'city',
  state: 'state',
  zip: 'ZIP',
};

const listed = (names: string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/**
 * §12.121. What the paste did, under the address: what it filled, what it
 * kept of the dispatcher's and why, and what it left out. Nothing is saved
 * until Save.
 */
function PasteNote({
  paste,
  onTakePasted,
  mayEdit,
}: {
  paste: NonNullable<StopFormState['paste']>;
  onTakePasted: () => void;
  mayEdit: boolean;
}) {
  const kept = (Object.entries(paste.kept) as [AddressField, string][]);
  return (
    <div data-paste-note="" className="flex flex-col gap-1 border-l border-line-soft pl-3 text-small">
      {paste.filled.length > 0 ? (
        <p className="text-text-secondary">
          Filled {listed(paste.filled.map((f) => FIELD_NAMES[f]))} from the paste.
          {paste.before ? ' ⌘Z or Ctrl+Z puts back what was there.' : ''}
        </p>
      ) : null}
      {kept.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p data-paste-kept="" className="text-status-risk-fg">
            Kept what you had in {listed(kept.map(([f]) => FIELD_NAMES[f]))}. The paste said{' '}
            {listed(kept.map(([f, v]) => `${FIELD_NAMES[f]} “${v}”`))}.
          </p>
          {mayEdit ? (
            <button
              type="button"
              onClick={onTakePasted}
              className="h-[26px] border border-status-risk-bd px-2.5 font-cond text-micro font-semibold uppercase tracking-[.09em] text-status-risk-fg"
            >
              Use the pasted ones
            </button>
          ) : null}
        </div>
      ) : null}
      {paste.leftOut.length > 0 ? (
        <p data-paste-left-out="" className="text-text-mutedOnOverlay">
          Left out: {paste.leftOut.map((l) => `“${l}”`).join(', ')} — not part of the street.
        </p>
      ) : null}
    </div>
  );
}
