'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useReturnFocus } from '@/components/edit/useModalChrome';
import { isTypingTarget } from '@/lib/keymap';
import { VIEW_NAME_MAX, type SavedView } from '@/lib/views';
import type { TruckList } from '@/lib/truck-lists';
import { chipLabel } from './FilterChips';

/**
 * §12.91 — the scope button (header option 6a). It merges what were two
 * things: the Views menu (§14 feature 11, §12.81, §12.83) and the list title
 * row (§12.90). It names the scope the chip counts belong to — the whole
 * fleet, a shared list, a saved view, or a list AND a view — and opens the one
 * menu where all three are chosen.
 *
 * Every function the Views menu had is here: save the current view, rename,
 * delete, the shared lists above the personal views, New list…, Edit list
 * (and its delete, with its confirm, in the list editor), and both 50 caps,
 * which refuse with the same sentences as before.
 *
 * The menu follows `AccountMenu`: same outside-click, same Esc, same "Tab out
 * closes it", because a menu that swallowed Tab would be a dialog wearing a
 * menu's clothes. It is drawn FIXED from the button's box (§12.83), so no
 * ancestor's overflow can clip it.
 *
 * `V` opens it (§12.91): the key was bound to nothing. Guarded like `P`, and
 * it stands aside while a modal is up.
 */

/**
 * §12.90. The shared lists, shown ABOVE the personal views in the same menu:
 * a list decides which trucks are in scope and a view then narrows them, so
 * the menu reads in the order the board applies them.
 */
export interface ListsMenu {
  items: TruckList[];
  activeId: string | null;
  /** Dispatchers and admins. A viewer sees and applies lists, and is told why not more. */
  canEdit: boolean;
  onApply: (id: string | null) => void;
  onNew: () => void;
  onEdit: (id: string) => void;
}

const MENU_WIDTH = 360;

export function ScopeMenu({
  views,
  active,
  onApply,
  onSave,
  onRemove,
  onRename,
  canSaveCurrent,
  lists,
  scopeCount,
  fleetCount,
  viewCount,
  onClear,
  phone = false,
}: {
  views: SavedView[];
  active: SavedView | null;
  onApply: (view: SavedView) => void;
  /** Returns the sentence to print on a refusal, or null when it saved. */
  onSave: (name: string) => string | null;
  onRemove: (id: string) => void;
  /** §12.81. Returns the sentence to print on a refusal, or null when it renamed. */
  onRename: (id: string, name: string) => string | null;
  /**
   * False when the board is showing a view that is already saved — there is
   * nothing to save, and offering it would invite a duplicate the save then
   * refuses.
   */
  canSaveCurrent: boolean;
  lists?: ListsMenu;
  /** The trucks the scope holds: the fleet's active trucks, the list's, or the view's rows. */
  scopeCount: number;
  /** The whole fleet's active trucks, for "All trucks" in the menu. */
  fleetCount: number;
  /** How many rows a saved view would show in the current list scope. */
  viewCount: (view: SavedView) => number;
  /** Back to the full fleet: clears the list (keeping the chips) and the view (chips and search). */
  onClear: () => void;
  /**
   * §12.96. The phone top bar's copy: 44px, as wide as the bar allows, and no
   * `V` — the desktop copy, hidden but mounted, already listens for it, and a
   * second listener would open both. It carries none of the desktop copy's
   * `data-*` hooks, so a selector finds one scope button, not two.
   */
  phone?: boolean;
}) {
  const activeList = lists?.items.find((l) => l.id === lists.activeId) ?? null;
  const scoped = activeList !== null || active !== null;
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{
    top: number;
    left: number;
    width: number;
    /** On a phone: never taller than the room below the button (§12.96). */
    maxHeight?: number;
  } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [find, setFind] = useState('');
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** §12.81. The one view being renamed, if any, and its draft name. */
  const [renaming, setRenaming] = useState<{
    id: string;
    name: string;
    error: string | null;
  } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  /**
   * Where focus goes when a name field closes. The field is removed, and a
   * removed focused element leaves focus on <body> — which the "focus left
   * the menu, so close it" rule below would read as Tab-ing out. Handing
   * focus back to the menu first keeps one Esc undoing one thing.
   */
  const findField = useRef<HTMLInputElement>(null);
  const refocus = () => findField.current?.focus();
  const menuId = useId();

  useReturnFocus(open);

  const toggle = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) {
      // §12.96, stage 4: on a phone, as wide as the screen allows and never
      // taller than it — 360px ran off 320 and 360, clipping "Save current view…".
      const width = phone ? Math.min(MENU_WIDTH, window.innerWidth - 16) : MENU_WIDTH;
      const top = rect.bottom + 4;
      setAnchor({
        top,
        // Kept on screen when the button sits near the right edge.
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        width,
        ...(phone ? { maxHeight: window.innerHeight - top - 8 } : {}),
      });
    }
    setOpen((was) => !was);
    setFind('');
    setNaming(false);
    setRenaming(null);
    setError(null);
  }, [phone]);

  /** §12.91: `V` opens the menu. Nothing else in the console binds it. */
  useEffect(() => {
    if (phone) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'v' && event.key !== 'V') return;
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (open || document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, toggle, phone]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Esc backs out of a name field first, and closes the menu second.
      // One press should undo one thing.
      event.stopPropagation();
      if (renaming) {
        refocus();
        setRenaming(null);
      } else if (naming) {
        refocus();
        setNaming(false);
      } else setOpen(false);
    };
    const onFocusOut = () => {
      window.setTimeout(() => {
        if (box.current && !box.current.contains(document.activeElement)) setOpen(false);
      }, 0);
    };
    // A fixed menu would stay put while its button moved; close instead.
    const onMove = () => setOpen(false);
    window.addEventListener('resize', onMove);
    document.addEventListener('mousedown', onDown);
    // The phone copy handles no keys (§12.96); a tap outside closes it.
    if (!phone) document.addEventListener('keydown', onKey);
    const node = box.current;
    node?.addEventListener('focusout', onFocusOut);
    return () => {
      window.removeEventListener('resize', onMove);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      node?.removeEventListener('focusout', onFocusOut);
    };
  }, [open, naming, renaming, phone]);

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
    refocus();
    setNaming(false);
  };

  const needle = find.trim().toLowerCase();
  const matches = (text: string) => needle === '' || text.toLowerCase().includes(needle);
  const shownLists = lists?.items.filter((l) => matches(l.name)) ?? [];
  const shownViews = views.filter((v) => matches(v.name));

  /** Everything the button names, in full: its tooltip and accessible name. */
  const fullName = [
    activeList ? `List: ${activeList.name}` : null,
    active ? `View: ${active.name}` : null,
  ]
    .filter((p): p is string => p !== null)
    .join(' · ');
  const described = fullName || 'Fleet: All trucks';

  return (
    <div
      ref={box}
      className={phone ? 'relative flex min-w-0 flex-1' : 'relative flex shrink-0'}
    >
      <div
        {...(phone ? { 'data-phone-scope': '' } : { 'data-scope': '' })}
        // 46px on a phone: 44px of button inside the 1px border.
        className={`flex ${phone ? 'h-[46px] flex-1' : 'h-8'} min-w-0 items-stretch border ${
          scoped ? 'border-accent bg-surface-overlay' : 'border-line-control'
        }`}
      >
        <button
          type="button"
          ref={trigger}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-label={`Scope — ${described} · ${scopeCount} trucks`}
          title={described}
          onClick={toggle}
          className={
            phone
              ? 'flex min-w-0 flex-1 items-center gap-2 px-[10px] text-left'
              : `flex min-w-0 items-center gap-2 px-[10px] ${
                  scoped ? '' : 'hover:bg-row-hover'
                } min-[1280px]:max-w-[260px] min-[1440px]:max-w-[320px] min-[1680px]:max-w-[340px] min-[1920px]:max-w-[360px]`
          }
        >
          {phone ? (
            /*
             * §12.96, stage 2. Two lines on a phone: what kind of scope and how
             * many trucks, then the NAME on a line of its own. Tag, name and
             * count side by side left "Bob's trucks" a few letters at 320px.
             */
            <span className="flex min-w-0 flex-1 flex-col items-start gap-[3px]">
              <span
                className={`font-cond text-[12px] font-semibold uppercase leading-none tracking-[.1em] ${
                  scoped ? 'text-accent' : 'text-text-secondary'
                }`}
              >
                {[activeList ? 'List' : null, active ? 'View' : null]
                  .filter(Boolean)
                  .join(' + ') || 'Fleet'}{' '}
                · <span className="tabular-nums">{scopeCount}</span>
              </span>
              <span
                data-phone-scope-name=""
                className="w-full truncate font-sans text-[14px] font-medium leading-tight text-text"
              >
                {[activeList?.name, active?.name].filter(Boolean).join(' · ') ||
                  'All trucks'}
              </span>
            </span>
          ) : (
            <>
              {activeList ? (
                <>
                  <KindTag active>List</KindTag>
                  <ScopeName data-list-title="">{activeList.name}</ScopeName>
                </>
              ) : null}
              {active ? (
                <>
                  <KindTag active>View</KindTag>
                  <ScopeName data-view-title="">{active.name}</ScopeName>
                </>
              ) : null}
              {!scoped ? (
                <>
                  <KindTag>Fleet</KindTag>
                  <ScopeName>All trucks</ScopeName>
                </>
              ) : null}
              <span
                data-scope-count=""
                className="shrink-0 font-sans text-[13px] font-medium leading-none tabular-nums text-text-secondary"
              >
                {scopeCount}
              </span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                aria-hidden="true"
                className="shrink-0 text-text-secondary"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </>
          )}
        </button>
        {scoped ? (
          <button
            type="button"
            {...(phone ? {} : { 'data-scope-clear': '' })}
            aria-label="Show the full fleet"
            title="Show the full fleet"
            onClick={() => {
              setOpen(false);
              onClear();
            }}
            className={`flex ${phone ? 'w-11' : 'w-7'} shrink-0 items-center justify-center border-l border-accent/40 text-text hover:bg-row-hover`}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        ) : null}
      </div>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Lists and views"
          data-views-menu=""
          style={
            anchor
              ? {
                  top: anchor.top,
                  left: anchor.left,
                  width: anchor.width,
                  ...(anchor.maxHeight ? { maxHeight: anchor.maxHeight } : {}),
                }
              : undefined
          }
          className={`fixed z-30 w-[360px] border border-line-control bg-surface-raised text-left shadow-modal ${
            phone ? 'overflow-y-auto overscroll-contain' : ''
          }`}
        >
          <label
            // 45px on a phone: 44px of field above the 1px rule.
            className={`flex ${phone ? 'h-[45px]' : 'h-9'} items-center gap-2 border-b border-line-soft px-3`}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
              className="shrink-0 text-text-mutedOnOverlay"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m16.5 16.5 4 4" />
            </svg>
            <input
              ref={findField}
              // Not on a phone: it would raise the keyboard over the menu, and
              // the resize that follows on Android closes it (onMove, above).
              autoFocus={!phone}
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Find a list or view"
              aria-label="Find a list or view"
              className={`min-w-0 flex-1 bg-transparent font-sans text-[13px] text-text outline-none placeholder:text-text-mutedOnOverlay ${phone ? 'self-stretch' : ''}`}
            />
          </label>

          <Section title="Fleet">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                if (scoped) onClear();
              }}
              className={`flex ${phone ? 'min-h-11' : 'h-8'} w-full items-center gap-[10px] px-3 text-left hover:bg-row-hover ${
                scoped ? '' : 'bg-surface-overlay'
              }`}
            >
              <KindTag>Fleet</KindTag>
              <span className="flex-1 font-sans text-[13px] font-medium text-text">
                All trucks
              </span>
              <Count>{fleetCount}</Count>
            </button>
          </Section>

          {lists ? (
            <ListsSection
              phone={phone}
              lists={lists}
              shown={shownLists}
              finding={needle !== ''}
              onDone={() => setOpen(false)}
            />
          ) : null}

          <Section title="Saved views · this browser">
            {views.length === 0 ? (
              <p className="px-3 py-2 text-body text-text-mutedOnSelected">
                No saved views yet. Filter the board, then save it here.
              </p>
            ) : shownViews.length === 0 ? (
              <p className="px-3 py-2 text-body text-text-mutedOnSelected">
                No view matches “{find.trim()}”.
              </p>
            ) : (
              /*
               * §12.81. The list scrolls inside a menu of fixed width and capped
               * height, so views grow it DOWNWARD and never wider. The save row
               * stays outside the scroll, always one reach away.
               */
              <div data-view-list="" className="max-h-[min(40vh,280px)] overflow-y-auto">
                {shownViews.map((view) =>
                  renaming?.id === view.id ? (
                    <div key={view.id} className="px-3 py-1.5">
                      <input
                        autoFocus
                        value={renaming.name}
                        maxLength={VIEW_NAME_MAX}
                        aria-label={`New name for ${view.name}`}
                        onChange={(e) =>
                          setRenaming({ ...renaming, name: e.target.value, error: null })
                        }
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          const refusal = onRename(view.id, renaming.name);
                          if (refusal === null) {
                            refocus();
                            setRenaming(null);
                          } else setRenaming({ ...renaming, error: refusal });
                        }}
                        className="w-full border border-line-hair bg-surface-base px-2 py-1 font-sans text-body text-text outline-none"
                      />
                      {renaming.error ? (
                        <p role="alert" className="mt-1 text-small text-status-risk-fg">
                          {renaming.error}
                        </p>
                      ) : (
                        <p className="mt-1 text-small text-text-mutedOnSelected">
                          Enter to rename · Esc to cancel
                        </p>
                      )}
                    </div>
                  ) : (
                    <div key={view.id} className="group/view flex items-center">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onApply(view);
                          setOpen(false);
                        }}
                        className={`flex min-w-0 flex-1 items-center gap-[10px] px-3 py-1.5 text-left hover:bg-row-hover ${
                          view.id === active?.id ? 'text-accent' : 'text-text'
                        } ${phone ? 'min-h-11' : ''}`}
                      >
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-sans text-[13px]">
                            {view.name}
                          </span>
                          <span className="truncate font-sans text-small text-text-mutedOnSelected">
                            {describe(view)}
                          </span>
                        </span>
                        <Count>{viewCount(view)}</Count>
                      </button>
                      <button
                        type="button"
                        aria-label={`Rename the view ${view.name}`}
                        onClick={() =>
                          setRenaming({ id: view.id, name: view.name, error: null })
                        }
                        // On a phone there is no hover to reveal it: shown, 44px.
                        className={
                          phone
                            ? 'min-h-11 min-w-11 shrink-0 px-2 font-cond text-micro uppercase tracking-[.08em] text-text-secondary'
                            : 'shrink-0 px-2 py-1 font-cond text-micro uppercase tracking-[.08em] text-text-mutedOnSelected opacity-0 hover:text-text focus-visible:opacity-100 group-hover/view:opacity-100'
                        }
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete the view ${view.name}`}
                        onClick={() => onRemove(view.id)}
                        className={
                          phone
                            ? 'mr-1 min-h-11 min-w-11 shrink-0 px-2 font-cond text-micro uppercase tracking-[.08em] text-text-secondary'
                            : 'mr-2 shrink-0 px-2 py-1 font-cond text-micro uppercase tracking-[.08em] text-text-mutedOnSelected opacity-0 hover:text-status-late-fg focus-visible:opacity-100 group-hover/view:opacity-100'
                        }
                      >
                        Delete
                      </button>
                    </div>
                  ),
                )}
              </div>
            )}
          </Section>

          <div className="mt-1 border-t border-line-soft">
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
                  className="w-full border border-line-hair bg-surface-base px-2 py-1 font-sans text-body text-text outline-none placeholder:text-text-mutedOnSelected"
                />
                {error ? (
                  <p role="alert" className="mt-1 text-small text-status-risk-fg">
                    {error}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={commit}
                  className={`mt-1.5 border border-line-hair px-2 py-1 font-cond text-micro uppercase tracking-[.09em] text-accent hover:border-accent ${phone ? 'min-h-11 px-4' : ''}`}
                >
                  Save
                </button>
              </div>
            ) : (
              <div
                className={`flex ${phone ? 'min-h-11' : 'h-[34px]'} items-center justify-between px-3`}
              >
                {/* A label, not a control: the list has one order (§12.91). */}
                <span className="font-sans text-[12px] text-text-secondary">
                  Sorted by urgency
                </span>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!canSaveCurrent}
                  onClick={() => setNaming(true)}
                  className={`font-sans text-[12px] text-accent hover:underline disabled:text-text-mutedOnSelected disabled:no-underline ${phone ? 'min-h-11' : ''}`}
                >
                  {canSaveCurrent ? 'Save current view…' : 'This view is already saved'}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** FLEET / LIST / VIEW — never collapses (§12.91). */
function KindTag({ children, active }: { children: string; active?: boolean }) {
  return (
    <span
      data-kind-tag=""
      className={`shrink-0 border px-[5px] py-[3px] font-cond text-[10px] font-semibold uppercase leading-none tracking-[.1em] ${
        active ? 'border-accent text-accent' : 'border-line-tag text-text-secondary'
      }`}
    >
      {children}
    </span>
  );
}

/**
 * The name, with an ellipsis when the button runs out of room; the full name
 * is the button's tooltip. A list and a view side by side SHARE the room:
 * each grows from zero at the same rate up to its own length, so a long view
 * name cannot squeeze a short list name to "Bob'…". Never below 40px. Below
 * 1280 it caps at 200px (§12.91, last resort).
 */
function ScopeName({
  children,
  ...data
}: { children: string } & Record<`data-${string}`, string>) {
  return (
    <span
      {...data}
      className="min-w-[40px] max-w-[min(200px,max-content)] flex-[1_1_0] truncate font-sans text-[13px] font-medium leading-none text-text min-[1280px]:max-w-max"
    >
      {children}
    </span>
  );
}

function Count({ children }: { children: number }) {
  return (
    <span className="shrink-0 font-sans text-[12.5px] font-medium tabular-nums text-text-secondary">
      {children}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pb-1">
      <p className="px-3 pb-1 pt-[10px] font-cond text-micro font-semibold uppercase tracking-[.1em] text-text-mutedOnOverlay">
        {title}
      </p>
      {children}
    </div>
  );
}

/**
 * The second line under each name: what the view actually does, so a
 * dispatcher can tell two similar names apart without applying both.
 */
function describe(view: SavedView): string {
  const parts: string[] = [];
  // The chips' printed names — "Upcoming", "At risk" — not their URL keys.
  if (view.chips.length > 0) parts.push(view.chips.map(chipLabel).join(', '));
  if (view.query) parts.push(`“${view.query}”`);
  return parts.length === 0 ? 'The whole active fleet' : parts.join(' · ');
}

/**
 * §12.90. The shared lists: each with its truck count, the active one marked,
 * and — for dispatchers and admins — new and edit. Scrolls inside its own cap
 * so fifty lists never push the personal views off the menu.
 */
function ListsSection({
  lists,
  shown,
  finding,
  onDone,
  phone = false,
}: {
  lists: ListsMenu;
  shown: TruckList[];
  finding: boolean;
  onDone: () => void;
  /**
   * §12.96, stage 4. A phone applies a list and edits none: the list editor
   * is a 600px panel that ran off the screen, the trap §12.94 closed for the
   * stop editor. It says where lists are edited instead.
   */
  phone?: boolean;
}) {
  return (
    <div data-lists-section="">
      <Section title="Shared lists · every dispatcher">
        {lists.items.length === 0 ? (
          <p className="px-3 py-1.5 text-body text-text-mutedOnSelected">
            No shared lists yet.
          </p>
        ) : shown.length === 0 && finding ? (
          <p className="px-3 py-1.5 text-body text-text-mutedOnSelected">
            No list matches.
          </p>
        ) : (
          <div data-list-items="" className="max-h-[min(30vh,240px)] overflow-y-auto">
            {shown.map((list) => (
              <div key={list.id} className="group/list flex items-center">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    lists.onApply(list.id);
                    onDone();
                  }}
                  className={`flex ${phone ? 'min-h-11' : 'h-8'} min-w-0 flex-1 items-center gap-[10px] px-3 text-left hover:bg-row-hover ${
                    list.id === lists.activeId ? 'text-accent' : 'text-text'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate font-sans text-[13px]">
                    {list.name}
                  </span>
                  <Count>{list.truckIds.length}</Count>
                </button>
                {lists.canEdit && !phone ? (
                  <button
                    type="button"
                    aria-label={`Edit the list ${list.name}`}
                    onClick={() => {
                      lists.onEdit(list.id);
                      onDone();
                    }}
                    className="mr-2 shrink-0 px-2 py-1 font-cond text-micro uppercase tracking-[.08em] text-text-mutedOnSelected opacity-0 hover:text-text focus-visible:opacity-100 group-hover/list:opacity-100"
                  >
                    Edit
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
        {phone ? (
          <p className="px-3 py-2 font-sans text-[13px] text-text-mutedOnSelected">
            Lists are edited on the desktop console
          </p>
        ) : (
          <button
            type="button"
            role="menuitem"
            disabled={!lists.canEdit}
            title={
              lists.canEdit ? undefined : 'Only dispatchers and admins can create lists.'
            }
            onClick={() => {
              lists.onNew();
              onDone();
            }}
            className="w-full px-3 py-1.5 text-left font-sans text-[13px] text-accent hover:bg-row-hover disabled:text-text-mutedOnSelected disabled:hover:bg-transparent"
          >
            New list…
          </button>
        )}
      </Section>
    </div>
  );
}
