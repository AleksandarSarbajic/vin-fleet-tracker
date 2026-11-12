/**
 * §12.149 and §12.153. Whether the page now mounting came by a change of page, or is the
 * page a load landed on.
 *
 * The page a load lands on is the server's first paint: what it shows is already on the
 * screen before any script runs, so a motion started there in a layout effect would show it,
 * hide it and bring it back (a flash). A page reached by a change of page is drawn by React
 * after a commit, and its layout effects run ahead of its first frame, so a motion there
 * starts from nothing.
 *
 * `PageRise` (mounted anew by `app/template.tsx` on each change of page) marks the first one.
 * Its layout effect runs after its page's, so a page asking during its own mount, in render or
 * in a layout effect, reads the answer for itself. A module's flag, not a ref: the template
 * mounts anew.
 */
let landed = false;

/** True on a page reached by a change of page; false on the page the load landed on, and on the server. */
export function cameByPageChange(): boolean {
  return landed;
}

/** `PageRise`'s, once per page: whether this page came by a change of page, and from now on every later one does. */
export function arrive(): boolean {
  const was = landed;
  landed = true;
  return was;
}
