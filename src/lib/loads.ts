/**
 * Load status vocabulary. Mirrors the `load_status` pg enum.
 *
 * TONU — "truck ordered not used" — is the broker cancelling AFTER the truck
 * is committed, and we bill for it. It is distinct from CANCELLED on purpose:
 * dispatchers need the two apart, and DISPATCHED can go straight to TONU.
 */
export const LOAD_STATUSES = [
  'AVAILABLE',
  'DISPATCHED',
  'AT_SHIPPER',
  'LOADED',
  'AT_RECEIVER',
  'DELIVERED',
  'TONU',
  'CANCELLED',
] as const;

export type LoadStatus = (typeof LOAD_STATUSES)[number];

/**
 * The only rule. Everything else is open.
 *
 * There is deliberately NO transition table and no ordering check: real loads
 * skip states constantly, and a state machine that refuses a legitimate jump
 * at 3am is worse than no state machine. A load may move from any
 * non-terminal status to any other.
 */
const TERMINAL = new Set<LoadStatus>(['DELIVERED', 'TONU', 'CANCELLED']);

export function isTerminal(status: LoadStatus): boolean {
  return TERMINAL.has(status);
}

/** True when a load is still running and the status engine should score it. */
export function isOpen(status: LoadStatus): boolean {
  return !isTerminal(status);
}

/**
 * Whether a change is allowed. Only reopening a closed load is refused —
 * that is a correction, not a status change, and it should go through an
 * explicit reopen with an audit entry rather than a quiet edit.
 */
export function canTransition(from: LoadStatus, to: LoadStatus): boolean {
  if (from === to) return true;
  return !isTerminal(from);
}

/** Sentence case for the UI. The token, never a hardcoded string in a component. */
export const LOAD_STATUS_LABEL: Record<LoadStatus, string> = {
  AVAILABLE: 'Available',
  DISPATCHED: 'Dispatched',
  AT_SHIPPER: 'At shipper',
  LOADED: 'Loaded',
  AT_RECEIVER: 'At receiver',
  DELIVERED: 'Delivered',
  TONU: 'TONU',
  CANCELLED: 'Cancelled',
};
