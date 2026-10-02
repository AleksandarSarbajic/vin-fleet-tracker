import { EDIT_MIN_WIDTH_PX } from './editing';

/**
 * §12.96 — the phone view for checking the board.
 *
 * Below 768px the console draws its phone pieces and hides the desktop ones
 * they replace — in CSS, with Tailwind's `md` (768px) — so the server sends
 * both and the first paint is already right. This number is for the few
 * things CSS cannot decide, such as whether the tour opens itself. It is the
 * editing width (§12.94) by construction: the phone is where editing is not.
 */
export const PHONE_BELOW_PX = EDIT_MIN_WIDTH_PX;
export const PHONE_MEDIA = `(max-width: ${PHONE_BELOW_PX - 1}px)`;

/** Whether this screen is a phone at this moment. The server says no. */
export function isPhoneNow(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
    return false;
  return window.matchMedia(PHONE_MEDIA).matches;
}
