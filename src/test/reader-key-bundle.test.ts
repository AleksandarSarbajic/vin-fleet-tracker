import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The language-model reader's key cannot reach the browser bundle
 * (CLAUDE.md, non-negotiable; docs/llm-reader-design.md §4, Keys) — shown
 * from the source, without a build.
 *
 * What would put the key in a browser:
 *   1. a client module importing, at any depth, the code that holds it — the
 *      env loader, the reader's wiring, the adapter, the SDK;
 *   2. a `NEXT_PUBLIC_*` variable carrying it, which Next inlines;
 *   3. a server component handing it to a client one as a prop.
 * (1) is walked here, import by import, from every `'use client'` module.
 * (2) is refused at boot by the env schema (`readerKeyIsNotPublic`, tested in
 * schema.test.ts) and checked here by name. (3) is held by naming every
 * module that mentions the key: none renders anything.
 *
 * Not a substitute for scanning `.next/static` for the key's value after a
 * production build; that needs a build, and is proposed separately.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const SRC = join(ROOT, 'src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const ALL = sources(SRC);
const text = new Map(ALL.map((f) => [f, readFileSync(f, 'utf8')]));
const rel = (f: string) => relative(ROOT, f);

/** A directive as the module's first statement, after comments. */
const directive = (t: string, name: string) =>
  new RegExp(`^(?:\\s|//[^\\n]*\\n|/\\*[\\s\\S]*?\\*/)*['"]${name}['"]`).test(t);
const isClient = (t: string) => directive(t, 'use client');
/**
 * A Server Action module. A client component that imports one gets a
 * reference to call over the network, not its code: the walk stops there.
 */
const isServerAction = (t: string) => directive(t, 'use server');

/**
 * Every module specifier a file imports, re-exports or imports dynamically.
 * `import type` and `export type` are skipped: under `verbatimModuleSyntax`
 * (tsconfig) they are erased whole, so nothing of them is bundled. An inline
 * `import { type X }` is kept — that one survives as a side-effect import.
 */
function specifiers(t: string): string[] {
  const out: string[] = [];
  const re =
    /(import|export)(\s+type)?\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;
  for (const m of t.matchAll(re)) {
    if (m[2]) continue;
    out.push((m[3] ?? m[4] ?? m[5])!);
  }
  return out;
}

/** A specifier as a file under src/, or null for a package. */
function resolveIn(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`${rel(from)} imports ${spec}, which resolves to no file`);
}

/** Every module the browser can load from the client entry points, and every package they name. */
function clientGraph() {
  const entries = ALL.filter((f) => isClient(text.get(f)!));
  const files = new Set<string>();
  const packages = new Map<string, string>();
  const actions = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    const source = text.get(file) ?? readFileSync(file, 'utf8');
    if (isServerAction(source)) {
      actions.add(rel(file));
      continue;
    }
    files.add(file);
    for (const spec of specifiers(source)) {
      const target = resolveIn(spec, file);
      if (target === null) packages.set(spec, rel(file));
      else queue.push(target);
    }
  }
  return { entries, files: [...files].map(rel), packages, actions };
}

describe("the reader's key cannot reach the browser bundle", () => {
  const graph = clientGraph();

  it('walks a real graph: the rate-confirmation strip is a client entry point', () => {
    expect(graph.entries.map(rel)).toContain('src/components/edit/RateconStrip.tsx');
    expect(graph.files.length).toBeGreaterThan(graph.entries.length);
  });

  it('stops at Server Actions, which reach the browser as references — and there are some, so the stop is real', () => {
    expect([...graph.actions].sort()).toEqual([
      'src/app/actions/profile.ts',
      'src/app/login/actions.ts',
    ]);
  });

  it('no client module reaches server code, the env loader, or anything marked server-only', () => {
    expect(
      graph.files.filter((f) => f.startsWith('src/server/') || f === 'src/env/server.ts'),
    ).toEqual([]);
    expect(graph.packages.get('server-only')).toBeUndefined();
  });

  it('no client module reaches the Anthropic SDK', () => {
    expect(
      [...graph.packages.keys()].filter((p) => p.startsWith('@anthropic-ai/')),
    ).toEqual([]);
  });

  it('no client module reads the key from the environment, or reaches the parsed server env', () => {
    const reads =
      /process\.env(?:\.LLM_READER_API_KEY\b|\[\s*['"]LLM_READER_API_KEY['"]\s*\])|\bserverEnv\b/;
    expect(
      graph.files.filter((f) => reads.test(readFileSync(join(ROOT, f), 'utf8'))),
    ).toEqual([]);
  });

  it('the one client module that names it is the shared schema, which only describes it: the value is never read there', () => {
    // `src/env/client.ts` parses ClientEnv from the same file, so the
    // schema ships to the browser. It names LLM_READER_API_KEY as a field
    // and reads only NEXT_PUBLIC_* values from process.env.
    expect(
      graph.files.filter((f) =>
        readFileSync(join(ROOT, f), 'utf8').includes('LLM_READER_API_KEY'),
      ),
    ).toEqual(['src/env/schema.ts']);
    const schema = text.get(join(SRC, 'env', 'schema.ts'))!;
    expect(schema.match(/process\.env(?:\.[A-Z_]+|\[['"][A-Z_]+['"]\])/g)).toEqual([
      "process.env['NEXT_PUBLIC_SENTRY_DSN']",
    ]);
  });

  it('next.config inlines no environment into the bundle (no `env:` block)', () => {
    expect(readFileSync(join(ROOT, 'next.config.ts'), 'utf8')).not.toMatch(
      /^\s*env\s*:/m,
    );
  });

  it('only the env schema, the wiring and the log line name the key — none of them renders anything', () => {
    expect(
      ALL.filter((f) => text.get(f)!.includes('LLM_READER_API_KEY'))
        .map(rel)
        .sort(),
    ).toEqual([
      'src/env/schema.ts',
      'src/server/ratecon-reader/live.ts',
      'src/server/ratecon-reader/log.ts',
    ]);
  });

  it('the SDK is imported only on the server, by modules that import server-only first', () => {
    const importers = ALL.filter((f) =>
      specifiers(text.get(f)!).some((s) => s.startsWith('@anthropic-ai/')),
    );
    expect(importers.map(rel)).toEqual(['src/server/ratecon-reader/anthropic.ts']);
    for (const f of importers)
      expect(specifiers(text.get(f)!)[0], rel(f)).toBe('server-only');
  });

  it('no NEXT_PUBLIC_ variable is named for the reader or for Anthropic, in the source or the env template', () => {
    const named = [
      ...ALL.map((f) => text.get(f)!),
      readFileSync(join(ROOT, '.env.example'), 'utf8'),
    ]
      .flatMap((t) => t.match(/NEXT_PUBLIC_[A-Z0-9_]+/g) ?? [])
      .filter((n) => /LLM|READER|ANTHROPIC|CLAUDE/.test(n));
    expect(named).toEqual([]);
  });
});
