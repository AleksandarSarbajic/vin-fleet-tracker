import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANCHOR_CLEARED, ARRIVAL_CLEARED } from './arrival-columns';

/**
 * §12.88. Clearing an anchor is spelled once. The three paths that clear one
 * — an unticked arrival, an address change, Clear stop — spread these sets;
 * a fourth that typed the columns out would be the copy that misses the
 * next column added.
 */

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.(ts|tsx|mts)$/.test(entry) && !/\.test\.tsx?$/.test(entry))
      found.push(full);
  }
  return found;
}

describe('the arrival-clearing column sets', () => {
  it('clear the whole anchor, and the whole arrival', () => {
    expect(ANCHOR_CLEARED).toEqual({
      arrivalAnchorLat: null,
      arrivalAnchorLng: null,
      arrivalAnchorAt: null,
    });
    expect(ARRIVAL_CLEARED).toEqual({
      arrivedAt: null,
      arrivedSource: null,
      departedAt: null,
      // §12.118. The departure's pair goes with it.
      departedSource: null,
      ...ANCHOR_CLEARED,
    });
  });

  it('are the only place app code writes an anchor column to null', () => {
    const src = join(import.meta.dirname, '..');
    const own = join(src, 'server', 'arrival-columns.ts');
    const offenders = sourceFiles(src)
      .filter((f) => f !== own)
      .filter((f) =>
        /arrivalAnchor(Lat|Lng|At):\s*null\b|arrival_anchor_(lat|lng|at)\s*=\s*null/.test(
          readFileSync(f, 'utf8'),
        ),
      )
      .map((f) => f.slice(src.length + 1));
    expect(
      offenders,
      'Spread ANCHOR_CLEARED or ARRIVAL_CLEARED from arrival-columns.ts',
    ).toEqual([]);
  });

  it('are used by every path that clears one', () => {
    const src = join(import.meta.dirname, '..');
    const read = (f: string) => readFileSync(join(src, f), 'utf8');
    expect(read('server/stop-edit.ts')).toMatch(/\bARRIVAL_CLEARED\b/);
    expect(read('server/clear-stop.ts')).toMatch(/\.set\(ANCHOR_CLEARED\)/);
  });
});
