import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND } from './brand';
import { palette } from '@/design/tokens';

/**
 * The brand set held to design-spec §10, file by file (§12.71).
 *
 * These are the properties a re-export could quietly lose: a raster smuggled
 * into an "outlined" SVG, a second colour in a single-colour lockup, a
 * hairline in the 16px favicon, a transparent corner on an icon the spec says
 * is opaque.
 */

const PUBLIC = join(process.cwd(), 'public');
const read = (url: string) => readFileSync(join(PUBLIC, url));
const text = (url: string) => read(url).toString('utf8');

/** PNG IHDR: width, height, and colour type (2 = RGB, no alpha channel). */
function png(url: string): { width: number; height: number; colourType: number } {
  const b = read(url);
  expect(b.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colourType: b.readUInt8(25) };
}

const fills = (svg: string) => [...svg.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]);

describe('every reference in lib/brand.ts resolves to a file', () => {
  const urls = [
    BRAND.markKnockout.src,
    BRAND.markNavy.src,
    BRAND.monogram.src,
    BRAND.favicon.svg,
    BRAND.favicon.ico,
    BRAND.appleTouchIcon,
    ...Object.values(BRAND.pwa),
  ];
  it.each(urls)('%s', (url) => expect(existsSync(join(PUBLIC, url))).toBe(true));
});

describe('the lockups', () => {
  const knockout = text(BRAND.markKnockout.src);
  const navy = text(BRAND.markNavy.src);

  it('are outlined vector only — no raster, no clip-path, no text', () => {
    for (const svg of [knockout, navy]) {
      expect(svg).not.toMatch(/<image|data:|clipPath|clip-path|<text/);
    }
  });

  it('are one colour each: #ffffff, and brand navy', () => {
    expect(new Set(fills(knockout))).toEqual(new Set(['#ffffff']));
    expect(new Set(fills(navy))).toEqual(new Set([palette.brand.navy]));
  });

  it('share one geometry', () => {
    const d = (svg: string) => /\sd="([^"]+)"/.exec(svg)?.[1];
    expect(d(knockout)).toBeTruthy();
    expect(d(knockout)).toBe(d(navy));
  });
});

it('the monogram has a square viewBox', () => {
  const [, , w, h] = (/viewBox="([^"]+)"/.exec(text(BRAND.monogram.src))?.[1] ?? '').split(' ');
  expect(w).toBeTruthy();
  expect(w).toBe(h);
});

describe('the favicon, drawn for 16px', () => {
  const svg = text(BRAND.favicon.svg);

  it('is a 16-unit square', () => {
    expect(svg).toContain('viewBox="0 0 16 16"');
  });

  /** One weight, no hairline: every drawn stroke is 2 units — 2px at 16. */
  it('draws every glyph stroke at 2px', () => {
    const glyph = [...svg.matchAll(/<path[^>]*stroke-width="([^"]+)"/g)].map((m) => Number(m[1]));
    expect(glyph.length).toBeGreaterThan(0);
    for (const w of glyph) expect(w).toBe(2);
  });

  /** 5a: a navy tile disappears on a dark tab bar at 1.34:1 without it. */
  it('carries the 1px cyan edge on the navy tile', () => {
    expect(svg).toContain(`fill="${palette.brand.navy}"`);
    expect(svg).toMatch(new RegExp(`<rect[^>]*stroke="${palette.brand.cyan}"[^>]*stroke-width="1"`));
  });

  it('ships an .ico with 16, 32 and 48px frames', () => {
    const ico = read(BRAND.favicon.ico);
    const count = ico.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => ico.readUInt8(6 + 16 * i));
    expect(sizes).toEqual([16, 32, 48]);
  });
});

describe('the icons are the specified size and opaque', () => {
  it.each([
    [BRAND.appleTouchIcon, 180],
    [BRAND.pwa.icon192, 192],
    [BRAND.pwa.icon512, 512],
    [BRAND.pwa.maskable512, 512],
  ])('%s is %ipx square with no alpha channel', (url, size) => {
    const p = png(url);
    expect([p.width, p.height]).toEqual([size, size]);
    expect(p.colourType).toBe(2);
  });
});
