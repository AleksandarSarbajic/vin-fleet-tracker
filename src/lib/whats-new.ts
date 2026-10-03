/**
 * §12.101. The account menu's "New" tag on Driver history, dropped after the
 * first visit. Stored as a VERSION rather than a flag, so a later change to
 * the page can raise it to 2 and the tag comes back once for everyone.
 *
 * Browser storage is a per-viewer convenience here and nothing more: when it
 * cannot be read (a private window, blocked site data) the tag shows, and a
 * write that fails is simply not remembered.
 */
export const HISTORY_FEATURE_VERSION = 1;
const KEY = 'ft.history.seen';

export function historyIsNew(): boolean {
  try {
    return Number(window.localStorage.getItem(KEY) ?? '0') < HISTORY_FEATURE_VERSION;
  } catch {
    // Storage unreadable: say it is new rather than hide what is.
    return true;
  }
}

export function markHistorySeen(): void {
  try {
    window.localStorage.setItem(KEY, String(HISTORY_FEATURE_VERSION));
  } catch {
    // Storage unwritable: the tag shows again next time, which is harmless.
  }
}
