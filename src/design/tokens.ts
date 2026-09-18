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
  },
  row: {
    hover: '#1d2126',
    selected: '#1b222b',
    // Unassigned rows sit marginally sunken — inert, not urgent (4a).
    unassigned: '#1b1e21',
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
  // Search match plate — steel, never yellow; yellow is At risk (2d).
  highlight: '#3d4a57',
  /** The modal scrim (§9.9). */
  scrim: 'rgba(9,11,13,.62)',
} as const;
