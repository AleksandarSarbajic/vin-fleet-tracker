/**
 * §12.165. The one way to draw a layer UNDER a host's own content: the host's first child,
 * `absolute -z-10`. A slide's highlight, a leaving copy, a glow, a flash: each sits above the
 * host's ground and below its words.
 *
 * That is right only inside a stacking context of the host's own. Without one, `-z-10` sends the
 * layer under the nearest ancestor that has one, below the host's opaque ground, and nothing is
 * seen: 3bx moved the basemap toggle's placement up a level, the box lost its context with it, and
 * the slide's highlight vanished for its 260ms and popped in at the end (3bx found wrong 1). The
 * host was right only by accident of its own placement.
 *
 * So this module refuses, loudly and where it is called, to lay anything under a host that does
 * not own its stacking context, and it is the only place in the app that writes `-z-10`
 * (`under-layer.test.tsx` fails on any other). A refused motion is skipped: the end state lands at
 * once, which is what the person was going to see anyway.
 *
 * What "owns" means is read from the host's class list, not its computed style, so that jsdom,
 * which applies no stylesheet, sees what the browser will: a position (`relative`, `absolute`,
 * `fixed`, `sticky`) and `isolate`, Tailwind's `position: …` and `isolation: isolate`. Or a
 * stylesheet rule that sets both for an attribute the motion itself puts on its host
 * (`STYLESHEET_HOSTS`, checked against globals.css by the test).
 */

/** The layer's own classes, added here and nowhere else. */
export const UNDER_LAYER_CLASSES = ['absolute', '-z-10'] as const;

const POSITIONED = ['relative', 'absolute', 'fixed', 'sticky'];

/**
 * Hosts whose stacking context a stylesheet rule gives them, and the rule's selector there. A
 * filter chip has no context of its own; `groundPop` marks it `data-ground-host` while its look is
 * on the way, and globals.css makes a marked chip `position: relative; isolation: isolate`.
 */
export const STYLESHEET_HOSTS = ['button[data-ground-host]'] as const;

/** True when `host` makes a stacking context of its own, by its classes or by a known rule. */
export function ownsStackingContext(host: Element): boolean {
  const classes = host.classList;
  const byClasses =
    POSITIONED.some((position) => classes.contains(position)) &&
    classes.contains('isolate') &&
    !classes.contains('static') &&
    !classes.contains('isolation-auto');
  return byClasses || STYLESHEET_HOSTS.some((selector) => host.matches(selector));
}

/** Enough of a host to find it: its tag, label or role, and classes. */
function described(host: Element): string {
  const name = host.getAttribute('aria-label') ?? host.getAttribute('role');
  return `<${host.tagName.toLowerCase()}${name ? ` "${name}"` : ''} class="${host.className}">`;
}

/** The loud half of a refusal: what was refused, under what, and the fix. */
export function refusal(host: Element): string {
  return (
    `§12.165: nothing may be drawn under ${described(host)}, which has no stacking context of its own; ` +
    'the layer would paint under its ground and not be seen. Give the host `relative isolate`.'
  );
}

/**
 * Lays `layer` under `host`'s content, as its first child, or refuses and says so. True when it
 * was laid; a caller that gets false skips its motion.
 */
export function layUnder(host: HTMLElement, layer: HTMLElement): boolean {
  if (!ownsStackingContext(host)) {
    console.error(refusal(host));
    return false;
  }
  layer.classList.add(...UNDER_LAYER_CLASSES);
  host.prepend(layer);
  return true;
}
