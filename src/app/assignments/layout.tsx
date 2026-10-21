import { IBM_Plex_Mono, Public_Sans } from 'next/font/google';

/**
 * §12.136. The assignment page's own faces, "Night desk" (HANDOFF 3an):
 * Public Sans for text, IBM Plex Mono for truck and phone numbers. Both SIL
 * OFL 1.1, self-hosted by next/font at build exactly as Barlow is; no request
 * leaves for Google at runtime.
 *
 * Loaded here, in this route's layout, so no other page downloads them. They
 * reach the page as CSS variables, which the `font-nightDesk` and
 * `font-nightDesk-mono` utilities read.
 */
const publicSans = Public_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-nightdesk-sans',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-nightdesk-mono',
  display: 'swap',
});

export default function AssignmentsLayout({ children }: { children: React.ReactNode }) {
  // `contents`: the wrapper only carries the variables; the page's `main`
  // keeps its window-height layout (§12.131) as if it were the body's child.
  return <div className={`contents ${publicSans.variable} ${plexMono.variable}`}>{children}</div>;
}
