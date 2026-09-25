/**
 * Every brand asset reference, in one file (design-spec §10): swapping an
 * asset is a change here and in `public/`, and no layout moves.
 *
 * The files are derived from `design/logo-Photoroom.png` — a 500×302 RGBA raster,
 * the same artwork as the phase-0 JPEG with its background removed (§12.71).
 * The lockup and the monogram are TRACED, not redrawn: 4x upsample, potrace,
 * 96.6% pixel overlap with the source. The favicon is the exception and is
 * REDRAWN: at 16px the traced mark is a one-pixel cyan sliver, so it is two
 * strokes at one weight — the crescent and the S — on 5a's navy tile.
 *
 * `width`/`height` are intrinsic (the SVG's own size) so an `<Image>` can
 * reserve the right box before the file arrives.
 */
export const BRAND = {
  /** Full lockup, #ffffff, outlined — the login card (54px). Not the header: §12.71. */
  markKnockout: { src: '/brand/mark-knockout.svg', width: 504, height: 268 },
  /** Same geometry in brand navy, for light grounds and print. */
  markNavy: { src: '/brand/mark-navy.svg', width: 504, height: 268 },
  /** The mark alone, navy knocked out to white and the cyan kept — the header (30px). */
  monogram: { src: '/brand/monogram.svg', width: 64, height: 64 },
  favicon: { svg: '/brand/favicon.svg', ico: '/favicon.ico' },
  appleTouchIcon: '/brand/apple-touch-icon.png',
  pwa: {
    icon192: '/brand/icon-192.png',
    icon512: '/brand/icon-512.png',
    maskable512: '/brand/icon-maskable-512.png',
  },
  alt: 'Vin Logistics Inc',
} as const;
