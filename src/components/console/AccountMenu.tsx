'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { signOut } from '@/app/login/actions';
import { updateDisplayName, type RenameState } from '@/app/actions/profile';
import { initials } from '@/lib/profile';
import type { Role } from '@/lib/roles';
import { useReturnFocus } from '@/components/edit/useModalChrome';

/**
 * The account menu behind the header circle (§12.45).
 *
 * Initials only — no picture and no upload path, because a Storage bucket and
 * its RLS policies are not worth writing to tell five accounts apart.
 *
 * The one editable field is the display name. `role` is admin-only and set
 * elsewhere; `email` is the auth identity, and changing it is an auth flow
 * rather than a profile edit.
 */

export interface AccountUser {
  fullName: string;
  email: string | null;
  role: Role;
}

const EMPTY: RenameState = { error: null, savedName: null };

export function AccountMenu({ user }: { user: AccountUser }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const [state, submit, pending] = useActionState(updateDisplayName, EMPTY);

  /**
   * Focus goes back to the circle when the menu closes — the shared hook, not
   * a second copy of it (§12.45). `useFocusTrap` is deliberately NOT used: a
   * Tab trap is a modal's contract, and a menu should let Tab leave.
   */
  useReturnFocus(open);

  // The name the server accepted closes the editor, rather than the editor
  // closing optimistically and leaving a rejected name looking saved.
  const saved = state.savedName;
  useEffect(() => {
    if (saved !== null) setEditing(false);
  }, [saved]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    /**
     * Tab OUT closes it. A menu that swallowed Tab would be a dialog wearing a
     * menu's clothes, and the next control in the header would be unreachable
     * without a mouse.
     */
    const onFocusOut = () => {
      window.setTimeout(() => {
        if (box.current && !box.current.contains(document.activeElement)) setOpen(false);
      }, 0);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    box.current?.addEventListener('focusout', onFocusOut);
    const node = box.current;
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      node?.removeEventListener('focusout', onFocusOut);
    };
  }, [open]);

  // Opening always starts from the summary, never mid-edit from last time.
  const toggle = () => {
    setOpen((was) => {
      if (was) return false;
      setEditing(false);
      return true;
    });
  };

  return (
    <div ref={box} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account: ${user.fullName}`}
        onClick={toggle}
        className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border border-line-hair font-cond text-[11px] font-semibold text-text-secondary hover:bg-row-hover"
      >
        {initials(user.fullName)}
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-[38px] z-30 w-[260px] border border-line-hair bg-surface-raised py-2 text-left"
        >
          <div className="border-b border-line-hair px-3 pb-2">
            {editing ? (
              <form action={submit}>
                <label
                  htmlFor={`${menuId}-name`}
                  className="mb-1 block font-cond text-micro uppercase tracking-[.09em] text-text-muted"
                >
                  Display name
                </label>
                <input
                  id={`${menuId}-name`}
                  name="fullName"
                  defaultValue={user.fullName}
                  maxLength={120}
                  autoFocus
                  className="h-8 w-full border border-line-hair bg-surface-sunken px-2 text-body text-text"
                />
                {state.error ? (
                  <p role="alert" className="mt-1 text-small text-status-late-fg">
                    {state.error}
                  </p>
                ) : null}
                <div className="mt-2 flex gap-2">
                  <button
                    type="submit"
                    disabled={pending}
                    className="h-7 border border-line-hair bg-surface-sunken px-2.5 font-cond text-micro uppercase tracking-[.09em] text-text disabled:text-text-muted"
                  >
                    {pending ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    className="h-7 px-2.5 font-cond text-micro uppercase tracking-[.09em] text-text-muted"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p className="truncate text-body font-semibold text-text">{user.fullName}</p>
                {user.email ? (
                  <p className="truncate text-small text-text-muted">{user.email}</p>
                ) : null}
                <p className="mt-0.5 font-cond text-micro uppercase tracking-[.09em] text-text-secondary">
                  {user.role}
                </p>
              </>
            )}
          </div>

          {!editing ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => setEditing(true)}
              className="w-full px-3 py-1.5 text-left text-body text-text hover:bg-row-hover"
            >
              Edit display name
            </button>
          ) : null}

          <form action={signOut}>
            <button
              type="submit"
              role="menuitem"
              className="w-full px-3 py-1.5 text-left text-body text-text-secondary hover:bg-row-hover"
            >
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
