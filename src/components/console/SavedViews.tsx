'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useReturnFocus } from '@/components/edit/useModalChrome';
import { VIEW_NAME_MAX, type SavedView } from '@/lib/views';

/**
 * §14 feature 11 — saved filter views. **Interpretation**: turn 5 listed the
 * feature and drew no screen for it.
 *
 * In the header beside the chips, because a view IS a chip set and a search
 * term (§9.6) and a control that applies them belongs where they live. Not in
 * the list toolbar: §14.5 put the health strip and density there because they
 * are read WITH the list, and a view is chosen before the list is read.
 *
 * The menu follows `AccountMenu` rather than inventing a second dropdown —
 * same outside-click, same Esc, same "Tab out closes it", because a menu that
 * swallowed Tab would be a dialog wearing a menu's clothes.
 *
 * No single-key binding. §14 proposed `? ⌘K P X D` and no more, and inventing
 * a sixth would be the kind of addition a cheat sheet cannot justify. ⌘K
 * reaches the views instead (§14.3: "⌘K is navigation plus view-only actions
 * — apply a saved view").
 */
export function SavedViews({
  views,
  active,
  onApply,
  onSave,
  onRemove,
  canSaveCurrent,
}: {
  views: SavedView[];
  active: SavedView | null;
  onApply: (view: SavedView) => void;
  /** Returns the sentence to print on a refusal, or null when it saved. */
  onSave: (name: string) => string | null;
  onRemove: (id: string) => void;
  /**
   * False when the board is showing a view that is already saved — there is
   * nothing to save, and offering it would invite a duplicate the save then
   * refuses.
   */
  canSaveCurrent: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const menuId = useId();

  useReturnFocus(open);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Esc backs out of the name field first, and closes the menu second.
      // One press should undo one thing.
      event.stopPropagation();
      if (naming) setNaming(false);
      else setOpen(false);
    };
    const onFocusOut = () => {
      window.setTimeout(() => {
        if (box.current && !box.current.contains(document.activeElement)) setOpen(false);
      }, 0);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    const node = box.current;
    node?.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      node?.removeEventListener('focusout', onFocusOut);
    };
  }, [open, naming]);

  // The field is only there once, and focus belongs in it the moment it is.
  useEffect(() => {
    if (naming) field.current?.focus();
  }, [naming]);

  const commit = () => {
    const refusal = onSave(name);
    if (refusal !== null) {
      setError(refusal);
      return;
    }
    setError(null);
    setName('');
    setNaming(false);
  };

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setOpen((was) => !was);
          setNaming(false);
          setError(null);
        }}
        className={`flex h-[26px] shrink-0 items-center gap-1.5 border px-3 font-cond text-micro uppercase tracking-[.09em] ${
          active
            ? 'border-accent text-accent'
            : 'border-line-hair text-text-secondary hover:bg-row-hover'
        }`}
      >
        {/* The active view's name IS the label when one is showing, so the
            header says what the board is, not just what the control does. */}
        <span className="max-w-[140px] truncate">{active ? active.name : 'Views'}</span>
        <span aria-hidden="true" className="text-[8px] leading-none">
          ▼
        </span>
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Saved views"
          className="absolute left-0 top-[30px] z-30 w-[280px] border border-line-hair bg-surface-raised py-1 text-left"
        >
          {views.length === 0 ? (
            <p className="px-3 py-2 text-body text-text-mutedOnSelected">
              No saved views yet. Filter the board, then save it here.
            </p>
          ) : (
            views.map((view) => (
              <div key={view.id} className="group/view flex items-center">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onApply(view);
                    setOpen(false);
                  }}
                  className={`flex min-w-0 flex-1 flex-col items-start px-3 py-1.5 text-left hover:bg-row-hover ${
                    view.id === active?.id ? 'text-accent' : 'text-text'
                  }`}
                >
                  <span className="w-full truncate text-body">{view.name}</span>
                  <span className="w-full truncate font-sans text-small text-text-mutedOnSelected">
                    {describe(view)}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete the view ${view.name}`}
                  onClick={() => onRemove(view.id)}
                  className="mr-2 shrink-0 px-2 py-1 font-cond text-micro uppercase tracking-[.08em] text-text-muted opacity-0 hover:text-status-late-fg focus-visible:opacity-100 group-hover/view:opacity-100"
                >
                  Delete
                </button>
              </div>
            ))
          )}

          <div className="mt-1 border-t border-line-hair pt-1">
            {naming ? (
              <div className="px-3 py-1.5">
                <input
                  ref={field}
                  value={name}
                  maxLength={VIEW_NAME_MAX}
                  onChange={(e) => {
                    setName(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commit();
                    }
                  }}
                  placeholder="Name this view"
                  aria-label="Name this view"
                  className="w-full border border-line-hair bg-surface-base px-2 py-1 font-sans text-body text-text outline-none placeholder:text-text-muted"
                />
                {error ? (
                  <p role="alert" className="mt-1 text-small text-status-risk-fg">
                    {error}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={commit}
                  className="mt-1.5 border border-line-hair px-2 py-1 font-cond text-micro uppercase tracking-[.09em] text-accent hover:border-accent"
                >
                  Save
                </button>
              </div>
            ) : (
              <button
                type="button"
                role="menuitem"
                disabled={!canSaveCurrent}
                onClick={() => setNaming(true)}
                className="w-full px-3 py-1.5 text-left text-body text-accent hover:bg-row-hover disabled:text-text-muted disabled:hover:bg-transparent"
              >
                {canSaveCurrent ? 'Save current view…' : 'This view is already saved'}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The second line under each name: what the view actually does, so a
 * dispatcher can tell two similar names apart without applying both.
 */
function describe(view: SavedView): string {
  const parts: string[] = [];
  if (view.chips.length > 0) parts.push(view.chips.join(', '));
  if (view.query) parts.push(`“${view.query}”`);
  return parts.length === 0 ? 'The whole active fleet' : parts.join(' · ');
}
