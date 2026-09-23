'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Overlay, useOverlay } from './OverlayLayer';
import {
  ACTION,
  KIND_LABEL,
  moveCursor,
  paletteCommands,
  sectionsOf,
  viewOnlyActions,
  type Command,
  type PaletteTruck,
} from '@/lib/palette';
import type { SavedView } from '@/lib/views';
import type { Density } from '@/lib/density';

/**
 * §14 feature 10 — the command palette. **Approved** (5b composite, 5c).
 *
 * §14.5's two rulings are the whole shape of it:
 *
 * > **Search field vs ⌘K.** Two text boxes that both find trucks, split by
 * > verb: `/` filters the list in place, `⌘K` jumps and closes.
 *
 * > **Overlays.** Palette, cheat sheet and tour share one scrim and one
 * > layer, only one open at a time. `⌘K` during the tour ends the tour; `?`
 * > inside the palette types a "?".
 *
 * The second falls out of `OverlayLayer` for free — `show('palette')` while
 * the tour is open replaces it — and `?` typing a "?" falls out of the
 * shared `isTypingTarget` guard, since the field here is an `<input>`.
 *
 * §14.3: **no status writes.** Enforced in `lib/palette`, where the catalogue
 * is built, rather than by remembering it at each call site.
 */

export interface PaletteProps<T extends PaletteTruck> {
  trucks: T[];
  views: SavedView[];
  /** How the selected truck prints, or null when nothing is selected. */
  selectedLabel: string | null;
  selectedPinned: boolean;
  density: Density;
  onSelectTruck: (id: string) => void;
  onApplyView: (view: SavedView) => void;
  onTogglePin: () => void;
  onToggleDensity: () => void;
}

/**
 * The actions live HERE rather than being passed in, because one of them —
 * "Show keyboard shortcuts" — is a move on the overlay layer, and the layer
 * is only reachable from inside its own provider. Console renders the
 * provider, so it cannot call `useOverlay` itself.
 */
export function CommandPalette<T extends PaletteTruck>({
  trucks,
  views,
  selectedLabel,
  selectedPinned,
  density,
  onSelectTruck,
  onApplyView,
  onTogglePin,
  onToggleDensity,
}: PaletteProps<T>) {
  const { open, show } = useOverlay();
  const isOpen = open === 'palette';
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const listId = 'command-palette-list';

  /**
   * ⌘K and Ctrl+K, and deliberately NOT behind `isTypingTarget`.
   *
   * Every other binding in the console is a bare key and has to stand aside
   * while someone is typing. A modifier combination does not collide with
   * typing, and a palette that cannot be opened from the search field is a
   * palette that cannot be reached from where a dispatcher most often is.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'k' && event.key !== 'K') return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      // Toggling, so the same keystroke that opened it closes it.
      show(isOpen ? null : 'palette');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, show]);

  /** Every opening starts from an empty box, never from last time's query. */
  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setCursor(0);
    // The panel mounts with the overlay; focus has to wait for it.
    const id = window.setTimeout(() => field.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [isOpen]);

  const actions = useMemo(
    () => viewOnlyActions({ selectedLabel, pinned: selectedPinned, density }),
    [selectedLabel, selectedPinned, density],
  );

  const commands = useMemo(
    () => paletteCommands({ query, trucks, views, actions }),
    [query, trucks, views, actions],
  );

  // A shorter list must never leave the cursor pointing past the end.
  const safeCursor = commands.length === 0 ? 0 : Math.min(cursor, commands.length - 1);
  const sections = useMemo(() => sectionsOf(commands), [commands]);

  const run = (command: Command) => {
    // "Jumps and closes" (§14.5). One overlay at a time, so a command that
    // opens another surface must replace this one rather than race it.
    if (command.id === ACTION.shortcuts) {
      show('shortcuts');
      return;
    }
    show(null);
    if (command.kind === 'truck') {
      onSelectTruck(command.id.slice('truck:'.length));
      return;
    }
    if (command.kind === 'view') {
      const id = command.id.slice('view:'.length);
      const view = views.find((v) => v.id === id);
      if (view) onApplyView(view);
      return;
    }
    if (command.id === ACTION.pin) onTogglePin();
    else if (command.id === ACTION.density) onToggleDensity();
  };

  return (
    <Overlay name="palette" label="Command palette" width="w-[560px]">
      <div
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setCursor(
              moveCursor(safeCursor, event.key === 'ArrowDown' ? 1 : -1, commands.length),
            );
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            const command = commands[safeCursor];
            if (command) run(command);
          }
        }}
      >
        <div className="border-b border-line-hair px-3 py-2">
          <input
            ref={field}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={commands[safeCursor]?.id}
            aria-label="Jump to a truck, view or action"
            placeholder="Jump to a truck, driver, city or view…"
            className="w-full bg-transparent font-sans text-[14px] text-text outline-none placeholder:text-text-mutedOnOverlay"
          />
        </div>

        <div
          id={listId}
          role="listbox"
          aria-label="Commands"
          className="max-h-[420px] overflow-auto py-1"
        >
          {commands.length === 0 ? (
            <p className="px-3 py-6 text-center text-body text-text-mutedOnOverlay">
              Nothing matches “{query}”.
            </p>
          ) : (
            sections.map((section) => (
              <div key={section.kind}>
                <p className="px-3 pb-1 pt-2 font-cond text-micro uppercase tracking-[.11em] text-text-mutedOnOverlay">
                  {KIND_LABEL[section.kind]}
                </p>
                {section.commands.map((command) => {
                  const index = commands.indexOf(command);
                  const active = index === safeCursor;
                  return (
                    <button
                      key={command.id}
                      id={command.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      // Pointing at a row moves the cursor, so the keyboard
                      // and the mouse never disagree about what Enter means.
                      onMouseMove={() => setCursor(index)}
                      onClick={() => run(command)}
                      className={`flex w-full flex-col items-start px-3 py-1.5 text-left ${
                        active ? 'bg-row-selected' : ''
                      }`}
                    >
                      <span className="w-full truncate text-body text-text">
                        {command.label}
                      </span>
                      <span className="w-full truncate font-sans text-small text-text-mutedOnOverlay">
                        {command.detail}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-line-hair px-3 py-1.5 font-cond text-micro uppercase tracking-[.09em] text-text-mutedOnOverlay">
          <span>
            <Cap>↑</Cap>
            <Cap>↓</Cap> move
          </span>
          <span>
            <Cap>Enter</Cap> run
          </span>
          <span>
            <Cap>Esc</Cap> close
          </span>
          {/* §14.3. Said out loud, so the absence reads as a decision. */}
          <span className="ml-auto normal-case tracking-normal">
            Navigation only — statuses are set on the row
          </span>
        </div>
      </div>
    </Overlay>
  );
}

/** §14.4's key cap: primary ink on base, hair edge. Measured 14.91. */
function Cap({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mr-1 border border-line-hair bg-surface-base px-1 font-mono text-[10px] leading-[1.6] text-text">
      {children}
    </kbd>
  );
}
