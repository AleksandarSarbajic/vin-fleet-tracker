import { addressText, loadText } from '@/lib/copy-text';
import type { FleetRow } from '@/server/fleet-query';

/**
 * Phase 3bw, QoL feature 11 (§12.163). C copies the selected row's address.
 *
 * Copied, the row's own address control says so, as it does for a click: the press is lifted
 * into Console, and the row's `CopyButton` is told when one landed (`confirmedAt`). Refused, the
 * row says why in its next-stop cell for `KEY_REFUSAL_MS`, as the pin limit's refusal does.
 */
export interface KeyCopy {
  /** The truck the key acted on. */
  id: string;
  /** When: a new value is a new press, so the same row twice confirms twice. */
  at: number;
  /** Why nothing was copied, or null when it was. */
  refused: string | null;
  /**
   * §12.164 (QoL 8). Which of the row's two copy controls says it: the address (C, and the
   * menu's Copy address) or the load (the menu's Copy load info). The address when not given.
   */
  what?: 'address' | 'load';
}

/** As long as the pin limit's refusal stays (`usePinned`). */
export const KEY_REFUSAL_MS = 2_400;

/** What C copies for a row, or why it copies nothing. */
export function keyCopyText(row: FleetRow): { text: string } | { refused: string } {
  if (!row.nextStop) return { refused: 'No next stop, so no address' };
  const text = addressText(row);
  return text === null ? { refused: 'This stop has no address to copy' } : { text };
}

/**
 * §12.164 (QoL 8). What the row's load copy control copies (`loadText`), for the row menu's Copy
 * load info, or why nothing: the control itself is not drawn without a next stop.
 */
export function loadCopyText(row: FleetRow): { text: string } | { refused: string } {
  const text = loadText(row);
  return text === null ? { refused: 'No next stop, so no load' } : { text };
}

/** The browser's own refusal, in the words the demo used. Never silent: nothing was copied. */
export const CLIPBOARD_REFUSED = 'This browser would not copy, so nothing was copied';
