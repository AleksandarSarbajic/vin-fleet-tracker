import type { Metadata, Viewport } from 'next';
import { Barlow, Barlow_Condensed } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { BRAND } from '@/lib/brand';

const barlow = Barlow({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-barlow',
  display: 'swap',
});

const barlowCondensed = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-barlow-cond',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Fleet Tracker — Vin Logistics',
  description: 'Dispatch console. Authorised users only.',
  /**
   * The SVG first for every browser that takes one; the .ico (16/32/48) for
   * those that do not, and for the `/favicon.ico` request browsers make
   * whatever the page says. Paths live in lib/brand.ts (§10).
   */
  icons: {
    icon: [
      { url: BRAND.favicon.svg, type: 'image/svg+xml' },
      { url: BRAND.favicon.ico, sizes: '16x16 32x32 48x48' },
    ],
    apple: { url: BRAND.appleTouchIcon, sizes: '180x180' },
  },
};

export const viewport: Viewport = { colorScheme: 'dark' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${barlow.variable} ${barlowCondensed.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
