/**
 * §12.94 — editing is a desktop job.
 *
 * Phones are for CHECKING the board. The phone audit (2026-10-01) found the
 * Edit Stop modal 720px wide on a 390px screen with Save and Cancel off it,
 * and Clear stop's confirm step the same: a dispatcher could open them and
 * not get out. So below this width no route opens either — not the popup,
 * not a row, not the keyboard, not a toast, not the bulk bar — and where an
 * edit control would be, `DESKTOP_ONLY` says where editing is.
 *
 * One number, read in one place, so the rule and its tests cannot drift.
 */
export const EDIT_MIN_WIDTH_PX = 768;
export const EDIT_MEDIA = `(min-width: ${EDIT_MIN_WIDTH_PX}px)`;
export const DESKTOP_ONLY = 'Editing is on the desktop console';

/**
 * Whether editing is allowed at this moment. Read at the moment an edit is
 * asked for, not from a value captured earlier, so a rotated or resized
 * window answers for its size now. Without a window (the server render)
 * nothing is being edited, and the answer does not matter.
 */
export function editingAllowedNow(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
    return true;
  return window.matchMedia(EDIT_MEDIA).matches;
}
