'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

/** The open list's widest, in px. The class below says the same for a first paint. */
const LIST_MAX = 420;
/** Kept clear of the viewport's right edge, as the modal keeps 1.5rem. */
const VIEWPORT_GUTTER = 16;

/**
 * How wide the open list may be: from the picker's left edge to the nearest
 * right edge that would clip it — any ancestor that scrolls or hides overflow
 * (the edit modal's body, the board's scroll region) and the viewport — but
 * never narrower than the picker itself, and never wider than LIST_MAX.
 *
 * Measured, not set in CSS, because the same picker sits at the LEFT of the
 * board and at the RIGHT of the modal's two-column grid below 1008px, where a
 * fixed 420px ran 67px past the modal's body at 768. Null when there is no
 * layout to measure (a test DOM), and the class's own cap applies.
 */
export function listMaxWidth(box: HTMLElement): number | null {
  const own = box.getBoundingClientRect();
  if (own.width === 0) return null;
  let right = window.innerWidth - VIEWPORT_GUTTER;
  for (let el = box.parentElement; el; el = el.parentElement) {
    const style = window.getComputedStyle(el);
    if (style.overflowX !== 'visible' || style.overflow !== 'visible') {
      const edge = el.getBoundingClientRect().left + el.clientLeft + el.clientWidth;
      if (el.clientWidth > 0) right = Math.min(right, edge);
    }
  }
  return Math.min(LIST_MAX, Math.max(own.width, Math.floor(right - own.left)));
}

interface Props {
  drivers: BoardDriver[];
  value: string | null;
  /** Driver id -> the truck they are on in the CURRENT draft. */
  claimedBy: Map<string, string>;
  /** The truck this select belongs to, so it can ignore its own claim. */
  truckLabel: string;
  disabled: boolean;
  disabledReason?: string | undefined;
  /**
   * Marks this as the modal's opening focus target (see useFocusTrap). The
   * caret lands here; the list does NOT open — see `onFocus` below.
   */
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
   * move to the caller's save: the board's batch (its own confirmation, HANDOFF
   * 3ai), or the edit modal's §9.10 confirm.
   */
  assignToTruckId?: string | null;
  /**
   * §12.134. The board's field: no box at rest, so a column of fourteen
   * pickers reads as a list of names, not a form. The box (border and sunken
   * ground) comes back on hover, on focus and while the list is open, and
   * the cursor is a text cursor. A viewer's locked field (disabled WITH a
   * reason) keeps the box and its 45% as before. The edit modal does not
   * pass it.
   */
  quiet?: boolean;
  /**
   * §12.134. `row` is the board's 32px field, so a row fits the console's
   * 44px `row-comfortable`. The modal keeps the 36px default.
   */
  size?: 'default' | 'row';
}

/** Field height, the list's offset under it, and the tag's box, per size. */
const SIZE = {
  default: { field: 'h-9', list: 'top-[38px]', tag: 'h-9' },
  row: { field: 'h-8', list: 'top-[34px]', tag: 'h-8' },
} as const;

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
  quiet = false,
  size = 'default',
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
  const [maxWidth, setMaxWidth] = useState<number | null>(null);

  // Before paint, so the list never shows at one width and jumps to another.
  useLayoutEffect(() => {
    if (open && box.current) setMaxWidth(listMaxWidth(box.current));
  }, [open]);

  const known = useMemo(
    () =>
      justCreated && !drivers.some((d) => d.id === justCreated.id)
        ? [...drivers, justCreated]
        : drivers,
    [drivers, justCreated],
  );

  const selected = known.find((d) => d.id === value) ?? null;
  /**
   * §12.37's table: the closed input is tagged. It never was — on the board
   * the row's tag came from the Currently column, which now shows only on a
   * changed row (§12.130). Hidden while open: the field then holds a search.
   */
  const tagged = selected !== null && !open && !isEldBacked(selected);
  const field = useRef<HTMLInputElement>(null);
  /** Quiet, unless open (the box shows where the search is) or locked for a viewer. */
  const boxless = quiet && !open && !(disabled && disabledReason !== undefined);

  const matches = useMemo(() => {
    const needle = typed.trim().toLowerCase();
    const list = needle
      ? known.filter((d) => d.name.toLowerCase().includes(needle))
      : known;
    /**
     * Drivers with no truck first (Alex, 2026-10-21), then everyone else,
     * each group in the order it came. On a board where nearly everyone is
     * on a truck, the one free driver was somewhere in a grey list. The
     * 40-match cap counts AFTER the sort, so a free driver is never the one
     * cut off. "No truck" is `claimedBy`: the draft on the board, the saved
     * assignments in the edit modal.
     */
    const free = list.filter((d) => !claimedBy.has(d.id));
    const onATruck = list.filter((d) => claimedBy.has(d.id));
    return [...free, ...onATruck].slice(0, 40);
  }, [known, typed, claimedBy]);

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
        ref={field}
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
        /**
         * Opens on a click, on typing, on the arrow keys, and on TABBING in —
         * never on focus as such.
         *
         * It used to open on any focus, which made the list appear by itself
         * whenever something ELSE put focus here: the edit modal's initial
         * focus on an empty truck, and useFocusTrap's first-focusable
         * fallback when no appointment field is showing. A programmatic
         * focus is not a request to see forty drivers.
         *
         * Tab is told apart by its keyup: the keydown fires on the element
         * being left, the keyup on the one arrived at. A programmatic focus
         * has no key at all.
         */
        onClick={() => setOpen(true)}
        onKeyUp={(e) => {
          if (e.key === 'Tab') setOpen(true);
        }}
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
        className={`${SIZE[size].field} w-full border px-2.5 text-body outline-offset-[-2px] disabled:opacity-45 ${
          selected ? 'text-text' : 'text-text-muted'
        } ${
          boxless
            ? 'cursor-text border-transparent bg-transparent hover:border-line-hair hover:bg-surface-sunken focus:border-line-hair focus:bg-surface-sunken'
            : `bg-surface-sunken ${selected ? 'border-line-hair' : 'border-line-soft'}`
        } ${tagged ? 'pr-16' : ''}`}
      />
      {tagged ? (
        /**
         * Inside the field's right end, so the inputs down the board keep one
         * right edge. A click on it is a click on the field: it opens the
         * list, as the field would.
         */
        <span
          className={`absolute right-2 top-0 flex ${SIZE[size].tag} items-center`}
          onClick={() => {
            if (disabled) return;
            field.current?.focus();
            setOpen(true);
          }}
        >
          <NoEldTag />
        </span>
      ) : null}

      {open ? (
        /**
         * As wide as its widest option, not as its input (§12.37's picker at
         * board scale). It was `left-0 right-0`: on the board the driver
         * column is what the fixed columns leave, about 120px at a 1000px
         * window, so names wrapped onto three lines, the tags were cut off
         * and the list scrolled sideways. Now at least the input's width, at
         * most what `listMaxWidth` measures, and a name that still does not
         * fit truncates on one line with its whole self in the title.
         */
        <ul
          id={listId}
          role="listbox"
          style={maxWidth === null ? undefined : { maxWidth }}
          className={`absolute left-0 ${SIZE[size].list} z-20 max-h-[264px] w-max min-w-full max-w-[420px] overflow-y-auto overflow-x-hidden border border-line-hair bg-surface-raised py-1`}
        >
          <li>
            {/* Secondary ink, not `status.neutral`: clearing is an action, not a status. */}
            <button
              type="button"
              onClick={() => pick(null)}
              className="flex w-full items-center whitespace-nowrap px-2.5 py-1.5 text-left text-body text-text-secondary hover:bg-row-hover"
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
                  className={`flex w-full items-baseline justify-between gap-3 whitespace-nowrap px-2.5 py-1.5 text-left text-body ${
                    index === cursor ? 'bg-row-hover' : ''
                  } ${takenElsewhere ? 'text-text-muted' : 'text-text'}`}
                >
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="truncate" title={driver.name}>
                      {driver.name}
                    </span>
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
