/**
 * Pinned trucks (§14, feature 4).
 *
 * §14.5's ruling, in full:
 *
 * > Above 40 trucks (`3d`) the pinned block sits above the first group
 * > header. Pinned trucks are **removed from their group, not duplicated**,
 * > and the group count reads "Late 4 · +1 pinned". Cap of 5 so the block
 * > never pushes the problem set below the fold.
 *
 * Urgency groups are §5.7 — **specified, not built**, and deliberately so
 * until the fleet crosses 40 trucks. So the half of that rule which lands
 * today is "removed, not duplicated" and the cap; the group-count wording
 * arrives with the groups, and is recorded in §5.7 rather than guessed at
 * here.
 *
 * **Not duplicated** is the load-bearing half. A pinned truck appearing both
 * in the block and in the list below would make the list's own counts wrong
 * — the fold footer, the chip counts and "showing 1–20 of 23" would each
 * have to decide whether to count it once or twice, and they would not all
 * decide the same way.
 */

/** §14.5. Five, so the block cannot push the problem set below the fold. */
export const PIN_CAP = 5;

export const PIN_STORAGE_KEY = 'ft.pinned';

/**
 * Stored as an ORDERED list, not a set: the block is "not re-sorted" (5b), so
 * the order trucks were pinned in is the order they appear, and that order
 * has to survive a reload or the block rearranges itself overnight.
 */
export function readPinned(): string[] {
  try {
    const raw = window.localStorage.getItem(PIN_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string').slice(0, PIN_CAP);
  } catch {
    // Storage unavailable, or someone hand-edited it. An empty block costs
    // nothing; an exception here costs the console.
    return [];
  }
}

export function writePinned(ids: readonly string[]): void {
  try {
    window.localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // The pins are lost on reload. Nothing else is.
  }
}

export interface PinResult {
  ids: string[];
  /** Set when the pin was refused, for the caller to say so. */
  refused: 'cap' | null;
}

/**
 * Toggle, refusing rather than evicting at the cap.
 *
 * Silently dropping the oldest pin would be the friendlier-looking choice and
 * the wrong one: a dispatcher who pins a sixth truck and does not notice the
 * first one vanish has lost a truck they were deliberately watching, which is
 * the precise failure pinning exists to prevent.
 */
export function togglePin(ids: readonly string[], id: string): PinResult {
  if (ids.includes(id)) return { ids: ids.filter((x) => x !== id), refused: null };
  if (ids.length >= PIN_CAP) return { ids: [...ids], refused: 'cap' };
  return { ids: [...ids, id], refused: null };
}
