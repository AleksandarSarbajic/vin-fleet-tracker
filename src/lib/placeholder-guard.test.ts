import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The phase-3 status placeholder is the last fabricated data in the app, and
 * it dies in phase 5. Until then, nothing new may come to depend on it:
 * a second caller is how a scaffold becomes load-bearing and survives the
 * phase that was supposed to delete it.
 *
 * This guard is written to FAIL LOUDLY when the module it guards is deleted,
 * rather than quietly passing over an empty search. A guard that does nothing
 * after the thing it guards is gone is worse than no guard — it reads as
 * protection on a file nobody is protecting.
 */

const ROOT = join(process.cwd(), 'src');
const MODULE = join(ROOT, 'lib', 'placeholder-fleet.ts');

/**
 * The complete list. `server/fleet.ts` is the one call site — the seam the
 * engine replaces — plus the module's own tests.
 */
const ALLOWED_IMPORTERS = [
  join(ROOT, 'server', 'fleet.ts'),
  join(ROOT, 'lib', 'placeholder-fleet.test.ts'),
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx|mts)$/.test(entry) ? [path] : [];
  });
}

const IMPORTS_IT = /from\s+['"](?:@\/lib\/placeholder-fleet|\.\/placeholder-fleet|\.\.\/lib\/placeholder-fleet)['"]/;

describe('the status placeholder stays a scaffold', () => {
  it('still exists — delete this guard in the same commit as the module', () => {
    /**
     * Phase 5: when lib/placeholder-fleet.ts goes, this fails. That is
     * deliberate. Deleting this file is part of deleting the placeholder, and
     * the failure is what makes that impossible to forget.
     */
    expect(
      existsSync(MODULE),
      'lib/placeholder-fleet.ts is gone. If the real status engine has landed, ' +
        'delete this guard file too — it no longer guards anything.',
    ).toBe(true);
  });

  it('is imported by exactly one non-test module', () => {
    const importers = sources(ROOT).filter(
      (file) => file !== MODULE && IMPORTS_IT.test(readFileSync(file, 'utf8')),
    );
    expect(importers.sort()).toEqual([...ALLOWED_IMPORTERS].sort());
  });

  it('fabricates a status and nothing else', () => {
    // The driver half died in phase 4 — drivers are real rows now. If this
    // file grows another fabricated field, it is hiding data again.
    const text = readFileSync(MODULE, 'utf8');
    expect(text).not.toMatch(/driverName/);
    expect(text).not.toMatch(/driverIsPlaceholder/);
  });

  it('no fabricated driver survives anywhere in the app', () => {
    const GUARD = join(ROOT, 'lib', 'placeholder-guard.test.ts');
    const offenders = sources(ROOT).filter(
      (file) =>
        file !== GUARD &&
        /driverIsPlaceholder|placeholder — phase 4/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
