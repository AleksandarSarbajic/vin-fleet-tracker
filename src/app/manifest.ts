import type { MetadataRoute } from 'next';
import { palette } from '@/design/tokens';
import { BRAND } from '@/lib/brand';

/**
 * The PWA set from design-spec §10, served at `/manifest.webmanifest`.
 *
 * `standalone` because the phone view is full parity (§9.13): added to a home
 * screen, the console opens as an app rather than inside a browser tab. The
 * ground is `surface.base` — the same #15181b the icons are drawn on, so the
 * launch splash and the icon are one colour.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Fleet Tracker — Vin Logistics',
    short_name: 'Fleet Tracker',
    description: 'Dispatch console. Authorised users only.',
    start_url: '/',
    display: 'standalone',
    background_color: palette.surface.base,
    theme_color: palette.surface.base,
    icons: [
      { src: BRAND.pwa.icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: BRAND.pwa.icon512, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: BRAND.pwa.maskable512, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
