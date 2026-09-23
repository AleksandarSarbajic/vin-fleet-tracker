/**
 * Row density (§14, feature 5).
 *
 * Two heights, both tokens (`spacing.row-comfortable` / `row-compact`), and
 * the chip scales with them. §14.5's measured consequence: at 14:31 with 30
 * trucks, compact showed 3 pinned + 22 sorted rows against 20 in comfortable
 * — which is the whole argument for the feature. Two more problem rows above
 * the fold is worth a preference.
 *
 * The heights are exported as NUMBERS as well as classes because the list is
 * virtualised: `estimateSize` takes a measurement, not a class name, and a
 * virtualiser whose estimate disagrees with the rendered height scrolls to
 * the wrong row.
 */

export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];

/** Must equal `spacing.row-*` in tailwind.config.ts — asserted in the tests. */
export const ROW_HEIGHT: Record<Density, number> = {
  comfortable: 44,
  compact: 32,
};

export const CHIP_HEIGHT: Record<Density, number> = {
  comfortable: 21,
  compact: 18,
};

export const DENSITY_STORAGE_KEY = 'ft.density';

export function isDensity(value: unknown): value is Density {
  return typeof value === 'string' && (DENSITIES as readonly string[]).includes(value);
}

/**
 * Read the stored preference, defaulting to comfortable.
 *
 * Never throws: private browsing and disabled storage both make
 * `localStorage` a getter that raises, and a console that will not render
 * because it could not read a row height is a worse outcome than a row
 * height nobody chose.
 */
export function readDensity(): Density {
  try {
    const raw = window.localStorage.getItem(DENSITY_STORAGE_KEY);
    return isDensity(raw) ? raw : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

export function writeDensity(density: Density): void {
  try {
    window.localStorage.setItem(DENSITY_STORAGE_KEY, density);
  } catch {
    // The preference is lost on reload. Nothing else is.
  }
}

export const nextDensity = (current: Density): Density =>
  current === 'comfortable' ? 'compact' : 'comfortable';
