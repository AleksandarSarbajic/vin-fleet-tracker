/**
 * Phase 3bw, QoL feature 12 (§12.163), and phase 3bx's one rule (§12.164). A file let go to fill a
 * load: in the edit window, on its rate confirmation strip, or on a truck's row on the board.
 *
 * The rate confirmation strip is offered only while every stop is unsaved (§12.122): a fill
 * replaces stops, and a saved stop is never replaced. Before 3bw it was the only drop target in
 * `src/`, 36px tall, and a file that missed it left the page (3bf's found wrong 2). Now:
 *
 *   - **Offered:** the whole window takes the file, and it goes to the strip, which reads it
 *     exactly as a drop on the strip itself: the same read, the same marks, the same limits.
 *     On the board, the row of a truck the rule allows takes it, and the truck's window opens
 *     with the read started through the strip's same way in (§12.164).
 *   - **Not offered:** the file is swallowed, so the browser never opens it, and what was asked
 *     says that nothing was read and why, in this rule's own words.
 *
 * **One rule, three askers (3bx).** 3bw wrote it twice, as the strip's `stripOffered` and as
 * the window's drop; feature 1 would have made a third. `fileMayFill` is the only place it is
 * written: the window asks it with its form, the strip is offered by it, and the board asks it
 * for a row (`rowFillRule`).
 *
 * Only a drag carrying files is ours: text dragged into a field is the browser's, as before.
 */
import { can, type Role } from '@/lib/roles';

export interface FillRule {
  /** A dispatcher or an admin: a viewer cannot fill a load. */
  mayEdit: boolean;
  /** A save in flight. */
  saving: boolean;
  /** A save has landed and this form is spent (§12.127). */
  spent: boolean;
  /** Some stop on the load is already saved. */
  anyStored: boolean;
}

/** Whether a file may fill the load, and if not, why: a clause that follows "Nothing was read: ". */
export type FillOffer = { offered: true } | { offered: false; reason: string };

/** The rule. Its order is the order the reasons are given in. */
export function fileMayFill(rule: FillRule): FillOffer {
  if (!rule.mayEdit) return { offered: false, reason: 'a viewer cannot fill a load' };
  if (rule.anyStored) {
    return { offered: false, reason: 'this load has saved stops, and a read only fills a new load' };
  }
  if (rule.spent) {
    return { offered: false, reason: 'this load was just saved, and a read only fills a new load' };
  }
  if (rule.saving) return { offered: false, reason: 'a save is on its way' };
  return { offered: true };
}

/** What is said where a file was not read: the rule's reason, as one sentence; on the board, for its truck. */
export const nothingRead = (reason: string, truck?: string) =>
  truck === undefined ? `Nothing was read: ${reason}.` : `Nothing was read for truck ${truck}: ${reason}.`;

/**
 * §12.164. The rule for a truck's row on the board, before its window is open: the window it
 * would open, as it opens. A truck with no next stop opens on a new load (`loadReadKey` is
 * null), every stop unsaved; one with a next stop opens on its load, whose next stop is saved.
 * Nothing is being saved and nothing has landed, because no window is open.
 */
export function rowFillRule(row: { nextStop: unknown }, role: Role): FillRule {
  return { mayEdit: can(role, 'dispatcher'), saving: false, spent: false, anyStored: row.nextStop !== null };
}

/**
 * A drag that said it carried files and handed over none: a folder, or a browser that keeps the
 * file back. Said, never silent (3bx): before, the strip returned on it and the window passed on
 * nothing, so nothing was read and nothing said so.
 */
export const NO_FILE_HANDED =
  'Nothing was read: the drag held no file this page can open (a folder, or a browser that kept the file back).';

/** A drag that carries files, as opposed to text or a link. */
export function carriesFiles(types: readonly string[] | DOMStringList | null | undefined): boolean {
  return Boolean(types) && [...(types as readonly string[])].includes('Files');
}
