/**
 * Phase 3bw, QoL feature 12 (§12.163). A file let go anywhere in the edit window.
 *
 * The rate confirmation strip is offered only while every stop is unsaved (§12.122): a fill
 * replaces stops, and a saved stop is never replaced. Before 3bw it was the only drop target in
 * `src/`, 36px tall, and a file that missed it left the page (3bf's found wrong 2). Now:
 *
 *   - **Offered:** the whole window takes the file, and it goes to the strip, which reads it
 *     exactly as a drop on the strip itself: the same read, the same marks, the same limits.
 *   - **Not offered:** the file is swallowed, so the browser never opens it, and the window says
 *     that nothing was read and why, in the strip rule's own terms.
 *
 * Only a drag carrying files is ours: text dragged into a field is the browser's, as before.
 */
export interface DropRule {
  /** A dispatcher or an admin: a viewer cannot fill a load. */
  mayEdit: boolean;
  /** A save in flight. */
  saving: boolean;
  /** A save has landed and this form is spent (§12.127). */
  spent: boolean;
  /** Some stop on the load is already saved. */
  anyStored: boolean;
}

/** What a file let go in the window does: read by the strip, or refused with the reason. */
export function windowDrop(rule: DropRule): { read: true } | { refused: string } {
  if (!rule.mayEdit) return { refused: 'Nothing was read: a viewer cannot fill a load.' };
  if (rule.anyStored) {
    return { refused: 'Nothing was read: this load has saved stops, and a read only fills a new load.' };
  }
  if (rule.spent) return { refused: 'Nothing was read: this load was just saved, and a read only fills a new load.' };
  if (rule.saving) return { refused: 'Nothing was read: a save is on its way.' };
  return { read: true };
}

/** A drag that carries files, as opposed to text or a link. */
export function carriesFiles(types: readonly string[] | DOMStringList | null | undefined): boolean {
  return Boolean(types) && [...(types as readonly string[])].includes('Files');
}
