import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * §12.142. Every route under src/app/api answers an unexpected error through
 * `unexpectedFailure` (src/server/route-failure.ts), which is what reports it
 * to Sentry. A route that writes its own console line, its own reference or
 * its own 5xx is one Sentry never hears about: until 3aq that was all 16 of
 * them, each with its own copy.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const API = join(ROOT, 'src', 'app', 'api');

/**
 * The language-model reader's two routes keep their own frozen log line and
 * their own 500 (src/server/ratecon-reader/log.ts, pinned by 3s tests). Whether
 * they should report to Sentry too is HANDOFF 3aq, item 6 — a question, not
 * something this guard decides.
 */
const EXCLUDED = ['src/app/api/ratecon/read/route.ts', 'src/app/api/ratecon/outcome/route.ts'];

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routes(path);
    return name === 'route.ts' ? [relative(ROOT, path)] : [];
  });
}

const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** What makes a route file answer an unexpected error by itself. Empty: it does not. */
function violations(source: string): string[] {
  const code = withoutComments(source);
  const found: string[] = [];
  if (!/import\s*\{[^}]*\bunexpectedFailure\b[^}]*\}\s*from\s*'@\/server\/route-failure'/.test(code)) {
    found.push('does not import unexpectedFailure');
  }
  if (!/\bunexpectedFailure\(/.test(code)) found.push('never calls unexpectedFailure');
  if (/\bconsole\s*\.\s*\w+\s*\(/.test(code)) found.push('writes its own console line');
  if (/-500-/.test(code)) found.push('builds its own -500- reference');
  if (/\bstatus\s*:\s*5\d\d\b/.test(code)) found.push('answers a 5xx itself');
  return found;
}

describe('every API route answers an unexpected error through unexpectedFailure', () => {
  const checked = routes(API).filter((file) => !EXCLUDED.includes(file));

  it('finds the routes it is meant to check', () => {
    expect(checked.length).toBeGreaterThanOrEqual(16);
    expect(checked).toContain('src/app/api/drivers/route.ts');
  });

  it.each(checked)('%s', (file) => {
    expect(violations(readFileSync(join(ROOT, file), 'utf8'))).toEqual([]);
  });

  it('excludes only files that exist, so a renamed reader route is checked rather than skipped', () => {
    for (const file of EXCLUDED) expect(existsSync(join(ROOT, file)), file).toBe(true);
  });
});

describe('the guard on the guard: it fails the shapes it exists to catch', () => {
  const helper = `import { unexpectedFailure } from '@/server/route-failure';\n`;
  const handled = `  } catch (error: unknown) {\n    return unexpectedFailure(error, { prefix: 'X', log: 'x failed', message: 'No.' });\n  }\n`;

  it('the pre-3aq copy: its own reference, its own console line, its own 500', () => {
    const before = [
      `  } catch (error: unknown) {`,
      "    const reference = `X-500-${Date.now().toString(36).toUpperCase()}`;",
      `    console.error('x failed', { reference, error: String(error) });`,
      `    return NextResponse.json({ error: 'No.', reference }, { status: 500 });`,
      `  }`,
    ].join('\n');
    expect(violations(before)).toEqual([
      'does not import unexpectedFailure',
      'never calls unexpectedFailure',
      'writes its own console line',
      'builds its own -500- reference',
      'answers a 5xx itself',
    ]);
  });

  it('a raw console.error beside the helper', () => {
    expect(violations(`${helper}${handled}  console.error('x failed', { reference });\n`)).toEqual([
      'writes its own console line',
    ]);
  });

  it('a 503 answered by hand', () => {
    expect(violations(`${helper}${handled}  return Response.json({}, { status: 503 });\n`)).toEqual([
      'answers a 5xx itself',
    ]);
  });

  it('a route that goes through the helper, with comments that mention what it no longer does', () => {
    expect(violations(`${helper}// was: console.error('x failed') and { status: 500 }\n${handled}`)).toEqual([]);
  });
});
