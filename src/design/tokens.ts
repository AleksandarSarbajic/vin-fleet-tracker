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
    /**
     * §12.91, the header's option 6a. Three steps between `hair` and a
     * border that reads as a control: the search box and the chip-group
     * divider (`rule`), buttons and the quiet chips (`control`), and the
     * scope button's kind tag (`tag`).
     */
    rule: 'rgb(255 255 255 / .14)',
    control: 'rgb(255 255 255 / .16)',
    tag: 'rgb(255 255 255 / .2)',
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
   * §12.101. The driver history page's grounds: the narrower weekend columns,
   * and today's column (a 5% accent tint on the cells, 8% on its head, 12%
   * behind the "Current week" tag).
   */
  history: {
    /**
     * A cancelled (or TONU) load: the design's one new value, kept apart from
     * `status.late.fg`, which means something live. 7.10 on `surface.raised`,
     * the load block's fill. Here and not under `status`: it is a load's
     * state, not one the status engine emits for a truck.
     */
    cancelled: '#e3998e',
    weekend: '#131619',
    weekendHead: '#1a1e22',
    today: 'rgba(148,188,227,.05)',
    todayHead: 'rgba(148,188,227,.08)',
    currentTag: 'rgba(148,188,227,.12)',
  },
  /**
   * §12.101. The printed driver history: light, on paper, with every status
   * a darker ink of its screen colour so a black-and-white printer still
   * tells them apart (each also keeps its shape icon).
   */
  print: {
    paper: '#ffffff',
    ink: '#1d1f20',
    inkSecondary: '#4b4f53',
    inkMuted: '#6a6f74',
    rule: '#9ea3a8',
    ruleSoft: '#c9cccf',
    head: '#eceded',
    weekend: '#f6f6f7',
    delivered: '#12603a',
    cancelled: '#8e2c1d',
    progress: '#2c455d',
  },
  /**
   * §12.91. The header's feed-down block: a brighter square than `late.fg`,
   * so it reads as a light rather than as text, on a late-tinted ground. Its
   * text and border are `status.late.fg` and `status.late.bd`.
   */
  feed: {
    down: '#ff5a47',
    downBg: 'rgba(255,138,122,.08)',
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
  /** §8.3. A pan the dispatcher asked for by hand; the map jumps under reduced motion. */
  map: 150,
  /**
   * §12.149. The map going to a selected truck. Long enough to see which way it went,
   * and it is Mapbox's default curve, so the pan keeps its own easing.
   */
  mapTravel: 700,
  /** §14.4. Flash ground decays to the resting ground over this. */
  flash: 1600,
  /** §14.4. Chip crossfade. The WIDTH snaps — only opacity is animated. */
  chip: 160,
  toastIn: 180,
  /** Shorter than `toastIn` on purpose: a dismissal must never feel stuck. */
  toastOut: 120,
  /** §12.148. A window's opening: the scrim fades in, the panel rises and grows. */
  dialogIn: 220,
  /**
   * §12.148. The fading copy of a closed window. Shorter than `dialogIn` for
   * the toast's reason; the window itself is already gone.
   */
  dialogOut: 140,
  /** §12.148. A menu or a dropdown, smaller, so quicker than a window. */
  menuIn: 180,
  menuOut: 100,
  /** §12.148. A ground under a pointer. A lift takes `pressOut`. */
  hover: 160,
  /** §12.148. A press answers at once and lets go slowly. */
  pressIn: 60,
  pressOut: 180,
  /** §12.149. A segment's highlight, from what was chosen to what is. */
  segmentSlide: 260,
  /** §12.149. A count, on a poll that changed it. */
  countRoll: 400,
  /** §12.149. A new page's fade and rise. */
  pageIn: 260,
  /** §12.149. The bulk bar, in and out of its slot. */
  bulkBar: 300,
  /** §12.149. The board's opening, once per load: all of it, and each row's share. */
  boardOpen: 500,
  boardOpenRow: 200,
  /** So three rows do not take the whole opening. Normally the rows in view set the gap. */
  boardOpenGapMax: 35,
  /** §12.149. The selected row's ground, from the row it was on. */
  selectionSlide: 280,
  /** §12.149. Rows going to their new places, on a chip, a list or the reorder bar. */
  rowGlide: 380,

  /*
   * §12.152. The small motions (phase 3bj), at the demo's Bold. One token each, so one can
   * be taken back on its own: its On value from §12.152's table, or 0, which turns it off.
   */
  /** A chip's chosen look arriving or leaving, on a person's click or key. */
  chipGround: 270,
  /** The box a person clicked, and only that one. */
  checkPop: 270,
  /** The empty list, when a person emptied it. Never on a poll. */
  emptyDrop: 270,
  /** The two banners and the reorder bar come by themselves, so they only fade. */
  feedBannerFade: 270,
  fetchBannerFade: 270,
  reorderFade: 270,
  /** The note beside the chips, when Drivers only hides trucks. */
  noteDrop: 270,
  /** The tick on a copy button. */
  copiedPop: 270,
  /** A field's message, when it is a new one. */
  invalidDrop: 270,
  /** The edit window's strips. */
  unsavedDrop: 270,
  savedDrop: 270,
  rateconDrop: 270,
  /** The palette's results, on every key: opacity only, and short. */
  palResultsFade: 180,
  /** A tour step coming in from the side it is on, on Next and Back. */
  tourStep: 270,

  /*
   * §12.153. The small motions of the pages that are not the board (phase 3bk), at the
   * demo's Bold. One token each, as above: 0 turns one off, its On value weakens it.
   */
  /**
   * Driver history's rows in view drawing in, when a change of page opens it: all of it,
   * each row's share, and the gap's ceiling. Its own, not the board's (§12.149: 500/200/35).
   */
  histRowsDraw: 450,
  histRowsDrawRow: 180,
  histRowsDrawGapMax: 30,
  /** The loads a folded day shows on "+N more". */
  histFoldDrop: 270,
  /** The Assignments rows in view, as History's. */
  asgRowsDraw: 450,
  asgRowsDrawRow: 180,
  asgRowsDrawGapMax: 30,
  /** A row's driver and its "was" line, on a person's pick. Never on a refresh's rebase. */
  asgDriverDrop: 270,
  /** The picker's "Add a driver" form, on "+ Add". */
  asgAddDrop: 270,
  /** "Saved — …" in the footer. */
  asgSavedDrop: 270,
  /**
   * The login form arriving on a page load: a CSS animation in the server's HTML, so it
   * needs no script to start or to end (tailwind.config.ts, `login-in`).
   */
  loginFormIn: 330,
  /** The sign-in's refusal, under the password. */
  loginErrorDrop: 270,
} as const;

/**
 * §12.148. The distances and sizes of that motion, beside its durations and for
 * the same reason: the keyframes are built from them, and a test can name them.
 */
export const MOTION_SHAPE = {
  dialogFromScale: 0.96,
  dialogRisePx: 8,
  menuFromScale: 0.96,
  /** A menu hangs from what opened it, so it drops into place, not rises. */
  menuDropPx: 4,
  pressScale: 0.96,
  /** A row, a menu item, anything long: 4% of a wide thing is a lot. */
  flatPressScale: 0.995,
  hoverLiftPx: 1,
  /** §12.149. A new page comes up this far. */
  pageRisePx: 10,
  /** The row's grey hover bar, in `text.muted`. */
  rowBarOpacity: 0.8,

  /*
   * §12.152, beside the durations above. A drop comes from above, because nothing above a
   * scroller's content can make it grow; a pop and a chip's look grow from smaller.
   */
  chipGroundFromScale: 0.75,
  checkPopFromScale: 0.5,
  emptyDropPx: 14,
  noteDropPx: 14,
  copiedPopFromScale: 0.5,
  invalidDropPx: 14,
  unsavedDropPx: 14,
  savedDropPx: 14,
  rateconDropPx: 14,
  tourStepPx: 28,

  /** §12.153, beside its durations above. */
  histFoldDropPx: 14,
  asgDriverDropPx: 14,
  asgAddDropPx: 14,
  asgSavedDropPx: 14,
  /**
   * The login form comes UP this far, from below, and grows from this scale: the demo's own
   * shape. Scaled from its middle, its bottom edge starts higher than the rise takes it down
   * for any form 400px tall or more, so the page never grows (§12.153).
   */
  loginFormRisePx: 16,
  loginFormFromScale: 0.92,
  loginErrorDropPx: 14,
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
  /**
   * §12.148, and softer than the toast's on purpose. That curve does 68% of its
   * motion in the first fifth of the time: at 150ms and 2% an opening read as a
   * snap, which is how 3ba looked like no change at all. This one does 50%,
   * so the time a window takes is time you can see, with no slow start.
   */
  dialog: 'cubic-bezier(.22,.61,.36,1)',
  /** §12.149. What only fades, and goes nowhere, has no reason to speed up or slow down. */
  fade: 'linear',
} as const;
