/**
 * The palette. One source of truth, lifted from design-spec §1 (design doc
 * `2g` theme extension), verbatim — every contrast ratio in the spec was
 * independently verified, so do not retype or "tidy" these values.
 *
 * This file is plain data with no imports, because `tailwind.config.ts` reads
 * it: a token added here becomes a Tailwind class automatically, and the
 * handful of places that cannot use a class — canvas rasterisers and Mapbox
 * paint properties — import the same object rather than repeating a hex.
 *
 * Components use CLASSES. Import `palette` only where there is no class to
 * use: a `2d` canvas context or a Mapbox layer spec. If you are reaching for
 * it inside JSX, the answer is a Tailwind utility instead.
 *
 * Light theme (spec §1.2) is deliberately absent — specified but incomplete,
 * with no line/row/neutral values and no measured ratios. See spec §12.16.
 */
export const palette = {
  surface: {
    sunken: '#0f1215',
    base: '#15181b',
    raised: '#1d2126',
    overlay: '#252a30',
    /** Chrome bars: the list footer, the search result banner (§9.1, §9.4). */
    bar: '#1a2027',
    /** `surface.base` at 92%, for the marker key floating over live tiles. */
    scrim: 'rgba(21,24,27,.92)',
  },
  line: {
    hair: 'rgb(255 255 255 / .13)',
    soft: 'rgb(255 255 255 / .08)',
    /** The split handle's grip dots (§3.4). */
    grip: '#5d646b',
  },
  text: {
    DEFAULT: '#e9ebed',
    secondary: '#a9b0b6',
    muted: '#858d94',
    inverse: '#15181b',
    mutedOnSelected: '#949ca4',
    /**
     * §14.2. Muted ink on `surface.overlay`, where `text.muted` fails.
     *
     *     #858d94 on #252a30 : 4.29   under the 4.5 floor
     *     #949ca4 on #252a30 : 5.20   passes
     *
     * The same value as `mutedOnSelected` and a different name on purpose:
     * they are two grounds, and if one moves the other should not follow by
     * accident. Every modal (`2c`, `3a`, `4a`, `4c`) renders the failing pair
     * today.
     */
    mutedOnOverlay: '#949ca4',
  },
  row: {
    hover: '#1d2126',
    selected: '#1b222b',
    // Unassigned rows sit marginally sunken — inert, not urgent (4a).
    unassigned: '#1b1e21',
    /**
     * §14.5. A checked row and a selected row are the same ground, written
     * twice because they are different states that happen to agree. Checked
     * is carried by the tick as well, which is what lets the flash borrow
     * this ground for 1.6s without losing the fact.
     */
    checked: '#1b222b',
    /**
     * §14.4. The flash grounds: `status.bg` at **60%** over `surface.base`,
     * the only derived colours in the pass.
     *
     * Sixty and not a hundred because at full strength every one of them
     * fails muted ink — 4.48 late, 4.02 risk, 4.23 on time, 4.34 arrived.
     * Mixed down they clear it: 4.85, 4.56, 4.70, 4.73, and 4.70 neutral.
     * Risk at 4.56 is the floor of the set, so a flash ground may not be
     * darkened further without re-measuring.
     */
    flash: {
      late: '#2b1c1c',
      risk: '#2b2417',
      ontime: '#15261d',
      arrived: '#19232c',
      neutral: '#1f2327',
    },
  },
  brand: { navy: '#0d2b6b', cyan: '#29b6d8' },
  accent: {
    DEFAULT: '#94bce3',
    hover: '#b5d3ef',
    press: '#749dc4',
    /**
     * The selection ring's fill. Written as `rgba()` rather than the
     * `rgb(… / …)` slash form because Mapbox parses colours with its own
     * parser, not the browser's.
     */
    veil: 'rgba(148,188,227,0.14)',
  },
  status: {
    /**
     * `dim` is the offline banner's secondary ink (§9.8) — the `auto-retry in
     * 14s` countdown beside `Retry now`. One step down from `fg` so the
     * countdown does not compete with the sentence that matters, while
     * staying inside the red family rather than dropping to a neutral, which
     * would read as unrelated chrome. Measured on `status.late.bg`
     * (`#3a1f1c`): **6.45**, against 6.58 for `late.fg` on the same ground —
     * so it is a step down in WEIGHT, not in legibility, which is the point.
     */
    late: { fg: '#ff8a7a', bg: '#3a1f1c', bd: '#6b3129', dim: '#d79b91' },
    risk: { fg: '#f2b23f', bg: '#3a2c15', bd: '#6b5224' },
    ontime: { fg: '#5ed69b', bg: '#15301f', bd: '#27573a' },
    tomorrow: {
      fg: '#858d94',
      bg: 'transparent',
      bd: 'rgb(255 255 255 / .14)',
    },
    arrived: { fg: '#9cc4e8', bg: '#1c2a38', bd: '#37516b' },
    neutral: { fg: '#b3bac0', bg: '#262a2f', bd: '#6e767d' },
  },
  /**
   * §14.4. The movement trail's dot colour — `accent.DEFAULT`, named for its
   * own use because Mapbox reads it from here rather than from a class.
   * The opacity ramp is `TRAIL_RAMP` below: it is not a colour and would
   * break the Tailwind spread if it lived in here.
   */
  trail: '#94bce3',
  // Search match plate — steel, never yellow; yellow is At risk (2d).
  highlight: '#3d4a57',
  /** The modal scrim (§9.9). */
  scrim: 'rgba(9,11,13,.62)',
  /**
   * §14.4. The scrim behind the three shared overlays — palette, cheat sheet
   * and tour.
   *
   * Deliberately NOT the same as `scrim` above. Turn 5 measured .72 without
   * the spec in hand, and §9.9's modal scrim has been .62 since phase 2.
   * Changing the modal to match would restyle four existing dialogs that
   * nobody asked to have restyled, so the new surface takes the new value and
   * the old one is left alone. If they should converge, that is a ruling, not
   * a tidy-up.
   */
  scrimOverlay: 'rgba(9,11,13,.72)',
} as const;

/**
 * §14.4. Trail dot opacity, newest → ~30 minutes old.
 *
 * Not in `palette` because `tailwind.config.ts` spreads that object into
 * `colors`, where an array of numbers is not a colour.
 *
 * The tail falls below 3:1 **on purpose**: past roughly twelve minutes a dot
 * carries direction only, and the marker carries status. Do not "fix" the
 * last two steps.
 */
export const TRAIL_RAMP = [1, 0.75, 0.5, 0.3, 0.15] as const;

/**
 * §14.4's motion budget, as numbers.
 *
 * Here rather than in `tailwind.config.ts` for the same reason the palette is
 * here: two readers need the same values and only one of them can use a
 * class. The config builds its `transitionDuration`, `keyframes` and
 * `animation` from this object, and the hooks that have to OUTLIVE an
 * animation — the flash ledger, the toast's exit — read the same numbers.
 *
 * A row that stops flashing 200ms before its ground finishes decaying, or a
 * toast unmounted mid-fade, is the failure this prevents. Both have one
 * cause: a duration written down twice.
 */
export const MOTION_MS = {
  /** §8.3. Ground and selection. */
  ground: 120,
  /** §8.3. Map pan; the map jumps instead under reduced motion. */
  map: 150,
  /** §14.4. Flash ground decays to the resting ground over this. */
  flash: 1600,
  /** §14.4. Chip crossfade. The WIDTH snaps — only opacity is animated. */
  chip: 160,
  toastIn: 180,
  /** Shorter than `toastIn` on purpose: a dismissal must never feel stuck. */
  toastOut: 120,
  overlay: 120,
} as const;

/**
 * §14.4. Under `prefers-reduced-motion` the flash is not dropped — it becomes
 * a static tag for a minute, because the signal has to survive the motion
 * being taken away. Sixty seconds is the dwell of a thing you were not
 * looking at when it happened.
 */
export const FLASH_TAG_MS = 60_000;

export const EASING = {
  /** Jumps, then decays: the flash is at full ground on frame one. */
  flash: 'cubic-bezier(.2,0,0,1)',
  toast: 'cubic-bezier(.2,.8,.2,1)',
} as const;
