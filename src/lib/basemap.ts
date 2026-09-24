/**
 * Which basemap the map draws on: the dark style it was designed against, or
 * satellite imagery.
 *
 * Same shape as `density.ts` on purpose — a tiny pure module the hook wraps —
 * so the two console preferences are stored, defaulted and guarded the same
 * way, and a reader who understands one understands both.
 */

export const BASEMAPS = ['dark', 'satellite'] as const;
export type Basemap = (typeof BASEMAPS)[number];

/**
 * The Mapbox style for each. `satellite-streets-v12` rather than plain
 * `satellite-v9`: a dispatcher looking at imagery still needs the road names
 * and place labels to say where a truck IS, and the bare imagery has none.
 */
export const BASEMAP_STYLE: Record<Basemap, string> = {
  dark: 'mapbox://styles/mapbox/dark-v11',
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
};

export const BASEMAP_STORAGE_KEY = 'ft.basemap';

export function isBasemap(value: unknown): value is Basemap {
  return typeof value === 'string' && (BASEMAPS as readonly string[]).includes(value);
}

/**
 * Read the stored preference, defaulting to dark.
 *
 * Never throws, for density's reason: private browsing and disabled storage
 * make `localStorage` a getter that raises, and a map that will not render
 * because a preference could not be read is worse than the default basemap.
 */
export function readBasemap(): Basemap {
  try {
    const raw = window.localStorage.getItem(BASEMAP_STORAGE_KEY);
    return isBasemap(raw) ? raw : 'dark';
  } catch {
    return 'dark';
  }
}

export function writeBasemap(basemap: Basemap): void {
  try {
    window.localStorage.setItem(BASEMAP_STORAGE_KEY, basemap);
  } catch {
    // The preference is lost on reload. Nothing else is.
  }
}

/**
 * The credit each basemap REQUIRES, as data rather than as a sentence in JSX.
 *
 * Mapbox's attribution terms, checked 2026-09-24
 * (docs.mapbox.com/help/getting-started/attribution): every Mapbox map must
 * link "© Mapbox" to /about/maps, link "© OpenStreetMap" to the OSM copyright
 * page, and link "Improve this map" to the feedback app. Satellite styles must
 * ADDITIONALLY link "© Maxar". The map's own attribution control is disabled
 * (see MapFooter), so these links are the only compliant credit the product
 * shows — a list here is what a test can check.
 */
export interface Credit {
  label: string;
  href: string;
}

const BASE_CREDITS: Credit[] = [
  { label: '© Mapbox', href: 'https://www.mapbox.com/about/maps' },
  { label: '© OpenStreetMap', href: 'https://www.openstreetmap.org/copyright' },
  { label: 'Improve this map', href: 'https://apps.mapbox.com/feedback/' },
];

export const BASEMAP_CREDITS: Record<Basemap, Credit[]> = {
  dark: BASE_CREDITS,
  satellite: [...BASE_CREDITS, { label: '© Maxar', href: 'https://www.maxar.com/' }],
};
