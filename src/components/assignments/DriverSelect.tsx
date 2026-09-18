'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { BoardDriver } from '@/server/assignments';
import { isEldBacked } from '@/lib/driver';
import { NoEldTag } from '@/components/DriverName';
import { AddDriverInline } from './AddDriverInline';

/**
 * Searchable driver picker (design-spec §9.9's assignment group, at board
 * scale). Type a surname; the list filters.
 *
 * Each option carries the driver's CURRENT truck — and, while the board is
 * dirty, the truck they are about to be on. Without that, the only way to
 * discover that row 4 already took this driver is to save and be refused.
 *
 * Correction 1 applies here as everywhere: no HOS, no duty status. The only
 * availability signal is `drivers.active`.
 */

interface Props {
  drivers: BoardDriver[];
  value: string | null;
  /** Driver id -> the truck they are on in the CURRENT draft. */
  claimedBy: Map<string, string>;
  /** The truck this select belongs to, so it can ignore its own claim. */
  truckLabel: string;
  disabled: boolean;
  disabledReason?: string | undefined;
  /** Marks this as the modal's opening focus target (see useFocusTrap). */
  autoFocus?: boolean;
  onChange: (driverId: string | null) => void;
  /**
   * §12.37: refreshes the board after a driver is created here, so the new
   * row reaches every other surface. Absent means the picker offers no
   * "+ Add driver" — the edit modal passes it too, but a caller that cannot
   * refresh must not offer a control that appears to do nothing.
   */
  onDriverCreated?: (
    driverId: string,
    name: string,
    assignedTruckId: string | null,
  ) => void | Promise<void>;
  /**
   * §12.38: the truck this picker assigns to, when it is EMPTY. Null when it
   * already has a driver, which makes the create a create-only and leaves the
   * move to the existing reassignment confirm.
   */
  assignToTruckId?: string | null;
}

export function DriverSelect({
  drivers,
  value,
  claimedBy,
  truckLabel,
  disabled,
  disabledReason,
  autoFocus = false,
  onChange,
  onDriverCreated,
  assignToTruckId = null,
}: Props) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [cursor, setCursor] = useState(0);
  const [adding, setAdding] = useState(false);
  /**
   * The driver this picker just created, held until the `drivers` prop
   * catches up (§12.38).
   *
   * Without it the picker depends on its parent refetching before the
   * selection renders — the board does, the edit modal cannot as cheaply, and
   * an input that goes blank after a successful create looks like a failure.
   * Holding it here removes the ordering dependency from both callers.
   */
  const [justCreated, setJustCreated] = useState<BoardDriver | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  const known = useMemo(
    () =>
      justCreated && !drivers.some((d) => d.id === justCreated.id)
        ? [...drivers, justCreated]
        : drivers,
    [drivers, justCreated],
  );

  const selected = known.find((d) => d.id === value) ?? null;

  const matches = useMemo(() => {
    const needle = typed.trim().toLowerCase();
    const list = needle
      ? known.filter((d) => d.name.toLowerCase().includes(needle))
      : known;
    return list.slice(0, 40);
  }, [known, typed]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (driverId: string | null) => {
    onChange(driverId);
    setOpen(false);
    setTyped('');
    setAdding(false);
  };

  /**
   * Offered when the search finds nothing, or so few that the driver they
   * want is evidently not there. Not offered on an unfiltered list: the
   * control belongs to the moment of not finding someone.
   */
  const offerAdd = onDriverCreated !== undefined && typed.trim() !== '' && matches.length <= 2;

  return (
    <div ref={box} className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        data-initial-focus={autoFocus ? '' : undefined}
        aria-label={`Driver for truck ${truckLabel}`}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        value={open ? typed : (selected?.name ?? '')}
        placeholder={selected ? '' : 'Unassigned'}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setTyped(e.target.value);
          setCursor(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
            setCursor((c) =>
              Math.max(0, Math.min(matches.length - 1, c + (e.key === 'ArrowDown' ? 1 : -1))),
            );
          } else if (e.key === 'Enter' && open) {
            e.preventDefault();
            const hit = matches[cursor];
            if (hit) pick(hit.id);
          } else if (e.key === 'Escape' && open) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            setTyped('');
          } else if (e.key === 'Backspace' && !typed && selected) {
            pick(null);
          }
        }}
        className={`h-9 w-full border bg-surface-sunken px-2.5 text-body outline-offset-[-2px] disabled:opacity-45 ${
          selected ? 'border-line-hair text-text' : 'border-line-soft text-text-muted'
        }`}
      />

      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-[38px] z-20 max-h-[264px] overflow-auto border border-line-hair bg-surface-raised py-1"
        >
          <li>
            <button
              type="button"
              onClick={() => pick(null)}
              className="flex w-full items-center px-2.5 py-1.5 text-left text-body text-status-neutral-fg hover:bg-row-hover"
            >
              Unassigned — clear this truck
            </button>
          </li>
          {matches.map((driver, index) => {
            const claim = claimedBy.get(driver.id);
            const takenElsewhere = claim !== undefined && claim !== truckLabel;
            return (
              <li key={driver.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={driver.id === value}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => pick(driver.id)}
                  className={`flex w-full items-baseline justify-between gap-3 px-2.5 py-1.5 text-left text-body ${
                    index === cursor ? 'bg-row-hover' : ''
                  } ${takenElsewhere ? 'text-text-muted' : 'text-text'}`}
                >
                  <span className="flex items-baseline gap-1.5">
                    {driver.name}
                    {/**
                     * §12.35: provenance, not status — so it borrows no status
                     * colour and no icon. A dispatcher needs it because only
                     * one of these two kinds of driver has an ELD behind them,
                     * and that decides whether a truck with no position is
                     * expected or broken.
                     */}
                    {isEldBacked(driver) ? null : <NoEldTag />}
                  </span>
                  <span className="shrink-0 font-cond text-micro uppercase tracking-[.08em] text-text-muted">
                    {takenElsewhere
                      ? `on truck ${claim}`
                      : driver.truckLabel
                        ? `currently ${driver.truckLabel}`
                        : 'unassigned'}
                  </span>
                </button>
              </li>
            );
          })}
          {matches.length === 0 && !adding ? (
            <li className="px-2.5 py-2 text-body text-text-muted">
              No driver matches “{typed}”.
            </li>
          ) : null}
          {/**
           * §12.37: the answer sits directly under the empty result, because
           * that is the moment a dispatcher needs it. A new hire is on the
           * board before anyone has added them to the ELD.
           */}
          {offerAdd && !adding ? (
            <li>
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="w-full border-t border-line-hair px-2.5 py-2 text-left text-body text-text-secondary hover:bg-row-hover"
              >
                + Add “{typed.trim()}” as a new driver
              </button>
            </li>
          ) : null}
          {adding ? (
            <li>
              <AddDriverInline
                suggestedName={typed.trim()}
                assignToTruckId={assignToTruckId}
                onCancel={() => setAdding(false)}
                onCreated={(driverId, name, assignedTruckId) => {
                  setAdding(false);
                  setTyped('');
                  setOpen(false);
                  setJustCreated({
                    id: driverId,
                    name,
                    active: true,
                    source: 'app',
                    samsaraDriverId: null,
                    phone: null,
                    truckId: assignedTruckId,
                    truckLabel: assignedTruckId === null ? null : truckLabel,
                  });
                  /**
                   * `onChange` FIRST, then the refresh (§12.38).
                   *
                   * It used to be the other way round, awaiting a refresh that
                   * resolves before the new props arrive — so the selection was
                   * written into the draft and then wiped when the board data
                   * landed. The draft now survives a refresh by rebasing, and
                   * ordering it this way means the selection is never the thing
                   * racing.
                   */
                  onChange(driverId);
                  void onDriverCreated?.(driverId, name, assignedTruckId);
                }}
              />
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
