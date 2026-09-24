// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BASEMAPS,
  BASEMAP_CREDITS,
  BASEMAP_STORAGE_KEY,
  BASEMAP_STYLE,
  isBasemap,
  readBasemap,
  writeBasemap,
} from './basemap';

/**
 * The satellite toggle's preference and its required credits (§12.70).
 *
 * Storage is stubbed exactly as density.test.ts stubs it, and for the same
 * reason: happy-dom has no localStorage unless node is given one, which is
 * the condition the reads are written to survive.
 */
const store = new Map<string, string>();
const stub = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as unknown as Storage;

beforeEach(() => {
  store.clear();
  Object.defineProperty(window, 'localStorage', { value: stub, configurable: true, writable: true });
});
afterEach(() => store.clear());

describe('the stored preference', () => {
  it('defaults to the dark map it was designed against', () => {
    expect(readBasemap()).toBe('dark');
  });

  it('round-trips each basemap', () => {
    for (const basemap of BASEMAPS) {
      writeBasemap(basemap);
      expect(readBasemap()).toBe(basemap);
    }
  });

  it('ignores a stored value it does not recognise', () => {
    // A renamed option, or somebody editing storage by hand, must land on the
    // default rather than on a style URL of `undefined`.
    store.set(BASEMAP_STORAGE_KEY, 'hybrid');
    expect(readBasemap()).toBe('dark');
    expect(isBasemap('hybrid')).toBe(false);
  });

  it('does not share a key with any other console preference', () => {
    expect(BASEMAP_STORAGE_KEY).toBe('ft.basemap');
  });

  it('survives storage being unavailable, rather than taking the map down', () => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('denied');
      },
      configurable: true,
    });
    expect(readBasemap()).toBe('dark');
    expect(() => writeBasemap('satellite')).not.toThrow();
  });
});

describe('the styles', () => {
  it('uses satellite-STREETS, so imagery still says where a truck is', () => {
    expect(BASEMAP_STYLE.satellite).toBe('mapbox://styles/mapbox/satellite-streets-v12');
    expect(BASEMAP_STYLE.dark).toBe('mapbox://styles/mapbox/dark-v11');
  });
});

/**
 * Mapbox's attribution terms, checked 2026-09-24. The map's own attribution
 * control is disabled, so this list is the product's only compliant credit.
 */
describe('the credits the terms require', () => {
  const hrefs = (basemap: (typeof BASEMAPS)[number]) =>
    Object.fromEntries(BASEMAP_CREDITS[basemap].map((c) => [c.label, c.href]));

  it.each(BASEMAPS)('%s links Mapbox, OpenStreetMap and "Improve this map"', (basemap) => {
    expect(hrefs(basemap)).toMatchObject({
      '© Mapbox': 'https://www.mapbox.com/about/maps',
      '© OpenStreetMap': 'https://www.openstreetmap.org/copyright',
      'Improve this map': 'https://apps.mapbox.com/feedback/',
    });
  });

  it('adds Maxar for satellite imagery, and only there', () => {
    expect(hrefs('satellite')['© Maxar']).toBe('https://www.maxar.com/');
    expect(hrefs('dark')['© Maxar']).toBeUndefined();
  });
});
