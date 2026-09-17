import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { palette } from './tokens';

/**
 * CLAUDE.md: "No hex values in components. Semantic status out of the engine,
 * token in the config, class in the component."
 *
 * That rule held for the chips and broke everywhere else — the row rail, the
 * marker canvas, the Mapbox paint properties, the legend swatches and two
 * arbitrary Tailwind values had all quietly grown their own copies of the
 * palette. A rule nothing enforces is a comment. This enforces it.
 */

const ROOT = join(process.cwd(), 'src');
const ALLOWED = new Set([join(ROOT, 'design', 'tokens.ts')]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) return [];
    return ALLOWED.has(path) ? [] : [path];
  });
}

/**
 * A colour literal, not any `#`. Matching bare `#` + digits would flag
 * "Truck #147" in a comment, which is a Samsara name and not a colour.
 *
 *   'colourLiteral'  a quoted string that is nothing but a hex colour
 *   [#abcdef]        a Tailwind arbitrary value
 *   rgb( / rgba(     a functional colour anywhere at all
 */
const LITERALS: [string, RegExp][] = [
  ['a quoted hex colour', /['"`]#[0-9a-fA-F]{3,8}['"`]/],
  ['a Tailwind arbitrary hex', /\[#[0-9a-fA-F]{3,8}\]/],
  ['an rgb()/rgba() literal', /rgba?\(/],
];

describe('the palette is the only place a colour is written down', () => {
  it('finds no colour literal anywhere under src/, tokens.ts aside', () => {
    const offences: string[] = [];
    for (const file of sources(ROOT)) {
      const text = readFileSync(file, 'utf8');
      for (const [what, pattern] of LITERALS) {
        const hit = pattern.exec(text);
        if (hit) {
          const line = text.slice(0, hit.index).split('\n').length;
          offences.push(
            `${file.replace(`${process.cwd()}/`, '')}:${line} ${what}: ${hit[0]}`,
          );
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it('scans a meaningful number of files, so a broken walk cannot pass', () => {
    expect(sources(ROOT).length).toBeGreaterThan(30);
  });

  it('would catch a hex if one came back', () => {
    // Guards the regexes themselves.
    expect(LITERALS[0]![1].test(`const c = '#ff8a7a';`)).toBe(true);
    expect(LITERALS[1]![1].test('className="bg-[#1a2027]"')).toBe(true);
    expect(LITERALS[2]![1].test(`'rgba(148,188,227,0.14)'`)).toBe(true);
    // And does not fire on the Samsara vehicle name format.
    expect(LITERALS[0]![1].test('/** "Truck #147", never 147. */')).toBe(false);
  });
});

describe('palette', () => {
  it('gives every status a foreground, a ground and a border', () => {
    for (const [name, pair] of Object.entries(palette.status)) {
      expect(pair, name).toHaveProperty('fg');
      expect(pair, name).toHaveProperty('bg');
      expect(pair, name).toHaveProperty('bd');
    }
  });
});
