'use client';

import type React from 'react';
import { useId, useMemo, useState } from 'react';
import { PopFrame } from '@/components/overlay/PopFrame';
import { matchAddresses, placeLine, type PastAddress } from '@/lib/past-address';
import { Field } from './Field';

/**
 * §12.164, phase 3bx (QoL 2). Street address, with suggestions from the company's own past stops.
 *
 * Typing shows the matches from the one list fetched as the window opened (`GET
 * /api/stops/addresses`). Arrows move through them, Enter or a click picks one, and a pick fills
 * street, city, state and ZIP through the same patch typing sends, so the zone follows it as it
 * follows typing (`followZone`). What was typed stays until a pick: an arrow never writes into
 * the field. Free text stays allowed: nothing has to be picked. Esc closes the list and keeps the
 * text, and that Esc is not also the window's: the window stands down while the list is open
 * (`holdsEscape`), and this field stops the press, so the press that closed the list closes
 * nothing else (the 3bc closing-press finding). Tab leaves, and closes it.
 *
 * Chrome's own suggestions: `autoComplete="off"` stops its history of what was typed into this
 * field before, which would stand over the list. What Chrome offers from a saved address of its
 * own is its decision, which this attribute is reported not to bind on address fields (HANDOFF
 * 3bx, unverified).
 *
 * When the list could not be read, the field is the plain text field it always was, and says
 * suggestions are unavailable.
 */
/** Said under the field when the past addresses could not be read. */
export const SUGGESTIONS_UNAVAILABLE = 'Suggestions from past stops are unavailable. Type the address.';

export function AddressSuggest({
  value,
  addresses,
  failed,
  onType,
  onPick,
  onPaste,
  error,
  check,
  source,
  ai,
  disabled,
}: {
  value: string;
  /** The past addresses; null while they are read, or when there are none to offer. */
  addresses: readonly PastAddress[] | null;
  /** The read failed: the field says so, and works as plain text. */
  failed: boolean;
  onType: (value: string) => void;
  onPick: (address: PastAddress) => void;
  onPaste: (event: React.ClipboardEvent<HTMLInputElement>) => void;
  error: string | undefined;
  check: string | undefined;
  source: string | undefined;
  ai: boolean;
  disabled?: boolean;
}) {
  const listId = useId();
  /** Open while the person is typing here; closed by a pick, Esc, Tab or leaving the field. */
  const [open, setOpen] = useState(false);
  /** The option the arrows are on; -1 is none, so Enter picks nothing. */
  const [cursor, setCursor] = useState(-1);
  const matches = useMemo(
    () => (open && addresses ? matchAddresses(addresses, value) : []),
    [open, addresses, value],
  );
  const shown = matches.length > 0;
  const optionId = (index: number) => `${listId}-${index}`;

  const close = () => {
    setOpen(false);
    setCursor(-1);
  };
  const pick = (address: PastAddress) => {
    close();
    onPick(address);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!shown) {
        // Closed by Esc or a pick: the arrow opens it again on what is typed.
        if (event.key === 'ArrowDown' && addresses && matchAddresses(addresses, value).length > 0) {
          event.preventDefault();
          setOpen(true);
          setCursor(0);
        }
        return;
      }
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setCursor((c) => (c < 0 ? (step > 0 ? 0 : matches.length - 1) : (c + step + matches.length) % matches.length));
      return;
    }
    if (!shown) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      const hit = matches[cursor];
      if (hit) pick(hit);
      else close();
      return;
    }
    if (event.key === 'Escape') {
      // The window's own Esc stood down for this press (`holdsEscape`); nothing after it hears it.
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'Tab') close();
  };

  return (
    <div className="relative">
      <Field
        label="Street address"
        value={value}
        onChange={(v) => {
          onType(v);
          setOpen(true);
          setCursor(-1);
        }}
        onPaste={onPaste}
        error={error}
        check={check}
        source={source}
        ai={ai}
        fill="addressLine"
        {...(disabled === undefined ? {} : { disabled })}
        {...(failed ? { help: SUGGESTIONS_UNAVAILABLE } : {})}
        inputProps={{
          role: 'combobox',
          'aria-autocomplete': 'list',
          'aria-expanded': shown,
          'aria-controls': listId,
          ...(shown && cursor >= 0 ? { 'aria-activedescendant': optionId(cursor) } : {}),
          autoComplete: 'off',
          'data-address-combobox': '',
          onKeyDown,
          onBlur: close,
        }}
      />
      {shown ? (
        <PopFrame
          as="ul"
          id={listId}
          role="listbox"
          aria-label="Past stops"
          data-address-list=""
          // Under the field, not under its message: the input is 24px of label and 40px tall.
          className="absolute left-0 right-0 top-[64px] z-20 max-h-[204px] overflow-y-auto border border-line-control bg-surface-raised py-1 shadow-modal"
        >
          {matches.map((p, index) => (
            <li
              key={`${p.addressLine}|${p.city}|${p.state}|${p.zip}`}
              id={optionId(index)}
              role="option"
              aria-selected={index === cursor}
              data-address-option=""
              // A press here must not take the focus out of the field, or the list would close
              // before the click lands.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setCursor(index)}
              onClick={() => pick(p)}
              className={`flex cursor-pointer items-baseline justify-between gap-3 px-2.5 py-1.5 ${
                index === cursor ? 'bg-row-hover' : ''
              }`}
            >
              <span className="min-w-0 truncate text-body text-text">
                <Marked text={p.addressLine} typed={value} />
              </span>
              <span className="shrink-0 text-small tabular-nums text-text-mutedOnSelected">
                <Marked text={placeLine(p)} typed={value} />
              </span>
            </li>
          ))}
        </PopFrame>
      ) : null}
    </div>
  );
}

/** What was typed, marked where it appears, as the board's search marks it. */
function Marked({ text, typed }: { text: string; typed: string }) {
  const q = typed.trim().toLowerCase().replace(/\s+/g, ' ');
  const at = q ? text.toLowerCase().indexOf(q) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="bg-highlight text-text">{text.slice(at, at + q.length)}</span>
      {text.slice(at + q.length)}
    </>
  );
}

/**
 * The window's Esc asks this first: a press on Street address while its list is open is the
 * list's, and the window does nothing with it.
 */
export function holdsEscape(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.hasAttribute('data-address-combobox') &&
    target.getAttribute('aria-expanded') === 'true'
  );
}
