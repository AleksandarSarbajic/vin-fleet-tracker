import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * §12.144. The worker's Sentry events keep ONE piece of text: the logger's
 * message, which is the event's message and grouping key, and its own
 * breadcrumbs' message. That is safe only while every call passes a string
 * literal — never a template literal, never a variable, never an error's
 * message. This guard proves it for every call through the worker's logger:
 * `logger.error/warn/info(…)` and any other name that holds it (anything
 * typed `Logger`, such as the Samsara client's `this.log`, and aliases).
 *
 * Allowed first arguments: a string literal; literals joined with `+`; or a
 * parameter of the enclosing function when every call of that function in
 * the file passes an allowed argument there (index.ts `die(what, …)`).
 */

const ROOT = join(import.meta.dirname, '..', '..');
const LEVELS = new Set(['error', 'warn', 'info']);

interface Call {
  at: string;
  ok: boolean;
}

/** Every call through a logger in one file, and whether its message is a literal. */
export function loggerCalls(file: string, source: string): Call[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const names = new Set<string>();

  const collect = (node: ts.Node): void => {
    if (
      (ts.isParameter(node) || ts.isPropertyDeclaration(node) || ts.isPropertySignature(node) || ts.isVariableDeclaration(node)) &&
      ts.isIdentifier(node.name)
    ) {
      // Any type named …Logger: the sweeps take narrowed ones (`SweepLogger`, `WarnLogger`).
      if (node.type && /Logger\b/.test(node.type.getText(sf))) names.add(node.name.text);
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.initializer) && names.has(node.initializer.text)) {
        names.add(node.name.text);
      }
    }
    if (ts.isImportSpecifier(node) && node.name.text === 'logger') names.add('logger');
    ts.forEachChild(node, collect);
  };
  // Twice, so an alias declared before the name it copies is still found.
  collect(sf);
  collect(sf);

  const calls: Call[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && LEVELS.has(node.expression.name.text)) {
      const receiver = node.expression.expression;
      const name = ts.isIdentifier(receiver)
        ? receiver.text
        : ts.isPropertyAccessExpression(receiver)
          ? receiver.name.text
          : undefined;
      if (name !== undefined && names.has(name)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        calls.push({ at: `${relative(ROOT, file)}:${line}`, ok: isLiteral(node.arguments[0], node, sf, 0) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return calls;
}

function isLiteral(arg: ts.Expression | undefined, call: ts.Node, sf: ts.SourceFile, depth: number): boolean {
  if (arg === undefined || depth > 3) return false;
  if (ts.isStringLiteral(arg)) return true;
  if (ts.isParenthesizedExpression(arg)) return isLiteral(arg.expression, call, sf, depth);
  if (ts.isBinaryExpression(arg) && arg.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return isLiteral(arg.left, call, sf, depth) && isLiteral(arg.right, call, sf, depth);
  }
  if (ts.isIdentifier(arg)) return isLiteralParameter(arg.text, call, sf, depth);
  return false;
}

/** A parameter of the function around `call`, when every call of that function passes a literal there. */
function isLiteralParameter(name: string, call: ts.Node, sf: ts.SourceFile, depth: number): boolean {
  for (let node: ts.Node | undefined = call.parent; node; node = node.parent) {
    if (!ts.isFunctionLike(node)) continue;
    const index = node.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === name);
    if (index === -1) return false;
    const fn = ts.isFunctionDeclaration(node)
      ? node.name?.text
      : ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)
        ? node.parent.name.text
        : undefined;
    if (fn === undefined) return false;
    const callers: ts.CallExpression[] = [];
    const find = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === fn) callers.push(n);
      ts.forEachChild(n, find);
    };
    find(sf);
    return callers.length > 0 && callers.every((c) => isLiteral(c.arguments[index], c, sf, depth + 1));
  }
  return false;
}

/**
 * The files the worker's logger can reach: everything in src/worker and
 * src/samsara, and any other file that imports it or names a …Logger type
 * (none today; this is what keeps a new one from being skipped).
 */
function loggerFiles(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return walk(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  return walk(join(ROOT, 'src')).filter((file) => {
    const rel = relative(ROOT, file);
    if (rel.startsWith('src/worker/') || rel.startsWith('src/samsara/')) return true;
    const text = readFileSync(file, 'utf8');
    return /from '@\/worker\/logger'/.test(text) || /\b\w*Logger\b/.test(text);
  });
}

describe("every call through the worker's logger passes a literal message", () => {
  const calls = loggerFiles().flatMap((file) => loggerCalls(file, readFileSync(file, 'utf8')));

  it('finds the calls it is meant to check, in the worker, its sweeps and the Samsara client', () => {
    expect(calls.length).toBeGreaterThanOrEqual(50);
    for (const file of [
      'src/samsara/client.ts',
      'src/worker/index.ts',
      // These take narrowed loggers (`SweepLogger`, `WarnLogger`); a guard keyed on `Logger` alone missed them.
      'src/worker/arrival.ts',
      'src/worker/routing.ts',
      'src/worker/eta-marks.ts',
      'src/worker/status-changes.ts',
    ]) {
      expect(calls.some((c) => c.at.startsWith(`${file}:`)), file).toBe(true);
    }
  });

  it('none passes a template literal, a variable or anything built at run time', () => {
    expect(calls.filter((c) => !c.ok).map((c) => c.at)).toEqual([]);
  });
});

describe('the guard on the guard', () => {
  const head = "import { logger } from './logger';\n";
  const check = (body: string) => loggerCalls(join(ROOT, 'src/worker/example.ts'), head + body).map((c) => c.ok);

  it.each<[label: string, body: string, expected: boolean[]]>([
    ['a template literal with a value', 'logger.error(`sweep ${n} failed`);', [false]],
    ['a template literal with no value', 'logger.warn(`sweep failed`);', [false]],
    ['a variable', "const message = 'x';\nlogger.error(message);", [false]],
    ["an error's message", 'logger.error(error.message);', [false]],
    ['literals joined with +', "logger.info('budget past ' + '70%');", [true]],
    ['a parameter every caller fills with a literal', "const die = (what: string) => logger.error(what);\ndie('boom');", [true]],
    ['a parameter one caller fills with a variable', "const die = (what: string) => logger.error(what);\ndie('boom');\ndie(reason);", [false]],
    ['a class field typed Logger', 'class C { private readonly log: Logger; go() { this.log.warn(`x ${y}`); } }', [false]],
    ['a parameter typed with a narrowed …Logger', 'function sweep(logger: SweepLogger) { logger.info(`truck ${n}`); }', [false]],
    ['an alias of the logger', 'const l = logger;\nl.error(m);', [false]],
  ])('%s', (_label, body, expected) => {
    expect(check(body)).toEqual(expected);
  });
});
