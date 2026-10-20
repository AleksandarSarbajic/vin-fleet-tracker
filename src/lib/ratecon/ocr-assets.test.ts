// @vitest-environment happy-dom
import { readFileSync, readdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyOcrAssets } from '../../../scripts/ocr-assets.mjs';
import { OCR_ASSETS, ocrWorkerOptions } from './ocr-assets';

/**
 * §12.128. The scan reader's files come from OUR origin and nowhere else,
 * and only when a scan is dropped. tesseract.js fetches its worker, its core
 * and the language data from cdn.jsdelivr.net unless every one of those
 * paths is set; these tests fail if one is not set, if one set is not
 * same-origin, or if tesseract.js gains a CDN default we do not know about.
 */

const created = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock('tesseract.js', () => {
  const worker = { setParameters: async () => ({}), recognize: async () => ({ data: { blocks: [] } }), terminate: async () => ({}) };
  // As tesseract.js is: CommonJS, everything on its default export.
  return {
    default: {
      OEM: { LSTM_ONLY: 1 },
      PSM: { AUTO: '3' },
      createWorker: async (...args: unknown[]) => {
        created.calls.push(args);
        return worker;
      },
    },
  };
});

const require = createRequire(import.meta.url);
const TESSERACT = dirname(require.resolve('tesseract.js/package.json'));
const ROOT = join(TESSERACT, '..', '..');

/** The option each of tesseract.js's own CDN defaults stands for, by the source file that holds it. */
const CDN_DEFAULTS: Record<string, 'workerPath' | 'corePath' | 'langPath'> = {
  'src/worker/browser/defaultOptions.js': 'workerPath',
  'src/worker-script/browser/getCore.js': 'corePath',
  'src/worker-script/index.js': 'langPath',
};

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
/** Absolute URLs in code, not in comments. */
const urlsIn = (source: string) =>
  source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .flatMap((line) => line.match(/https?:\/\/[^\s'"`)]+/g) ?? []);

/** Every string option that is an absolute URL. */
const urlOptions = (options: Record<string, unknown>) =>
  Object.entries(options).filter((e): e is [string, string] => typeof e[1] === 'string' && /^[a-z]+:\/\//i.test(e[1]));

afterEach(() => {
  created.calls.length = 0;
});

describe('every path is ours', () => {
  it.each(['https://fleet.example', 'http://localhost:3000', 'https://vin-fleet-tracker.vercel.app'])('same-origin for a page at %s', (origin) => {
    const options = ocrWorkerOptions(origin);
    for (const key of ['workerPath', 'corePath', 'langPath'] as const) expect(new URL(options[key]).origin, key).toBe(origin);
    for (const [key, value] of urlOptions(options)) expect(new URL(value).origin, key).toBe(origin);
  });

  it('the worker script is loaded from its URL, not from a blob that would import it', () => {
    expect(ocrWorkerOptions('https://fleet.example').workerBlobURL).toBe(false);
  });

  it('tesseract.js has exactly the CDN defaults we know of, and we set the option for each', () => {
    const found = files(join(TESSERACT, 'src'))
      .filter((path) => path.endsWith('.js'))
      .filter((path) => urlsIn(readFileSync(path, 'utf8')).length > 0)
      .map((path) => relative(TESSERACT, path))
      .sort();
    expect(found).toEqual(Object.keys(CDN_DEFAULTS).sort());
    const options = ocrWorkerOptions('https://fleet.example');
    for (const option of Object.values(CDN_DEFAULTS)) expect(options[option], option).toMatch(/^https:\/\/fleet\.example\/ocr\//);
  });

  it('the worker script we serve fetches from no CDN but those two paths, which we set', () => {
    const urls = urlsIn(readFileSync(join(TESSERACT, 'dist/worker.min.js'), 'utf8'));
    expect(urls.sort()).toEqual(['https://cdn.jsdelivr.net/npm/@tesseract.js-data/', 'https://cdn.jsdelivr.net/npm/tesseract.js-core@v']);
  });

  it('the browser engine is created with those options, for the page it is on', async () => {
    const { openBrowserScanEngine } = await import('./ocr-browser');
    const engine = await openBrowserScanEngine();
    await engine.close();
    expect(created.calls).toHaveLength(1);
    const options = created.calls[0]![2] as Record<string, unknown>;
    expect(options).toMatchObject(ocrWorkerOptions(window.location.origin));
    const urls = urlOptions(options);
    expect(urls.map(([key]) => key).sort()).toEqual(['corePath', 'langPath', 'workerPath']);
    for (const [key, value] of urls) expect(new URL(value).origin, key).toBe(window.location.origin);
  });
});

describe('the files served are the npm packages’, copied, never committed', () => {
  it('every one is installed', () => {
    for (const { from } of OCR_ASSETS) expect(() => require.resolve(from), from).not.toThrow();
  });

  it('every core build the worker may ask for, LSTM only, is served', () => {
    const asked = [...readFileSync(join(TESSERACT, 'src/worker-script/browser/getCore.js'), 'utf8').matchAll(/(tesseract-core-[a-z-]*lstm\.wasm\.js)/g)].map((m) => m[1]!);
    expect(new Set(asked).size).toBe(3);
    for (const name of asked) expect(OCR_ASSETS.map((a) => a.to), name).toContain(`core/${name}`);
  });

  it('copies exactly those files, byte for byte, into an emptied folder', () => {
    const dest = mkdtempSync(join(tmpdir(), 'ocr-assets-'));
    try {
      const written = copyOcrAssets(dest);
      expect(written.map((p) => relative(dest, p)).sort()).toEqual(OCR_ASSETS.map((a) => a.to).sort());
      for (const { from, to } of OCR_ASSETS) expect(readFileSync(join(dest, to)).equals(readFileSync(require.resolve(from))), to).toBe(true);
      expect(files(dest)).toHaveLength(OCR_ASSETS.length);
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });

  it('public/ocr/ is ignored by git', () => {
    expect(readFileSync(join(ROOT, '.gitignore'), 'utf8').split('\n')).toContain('public/ocr/');
  });
});

describe('loaded only when a scan is dropped', () => {
  const app = files(join(ROOT, 'src')).filter((p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) && !p.includes(`${join('src', 'test')}`));

  it('no module of the app imports tesseract.js, except as types, but the browser engine — and that one only lazily', () => {
    const importers = app.filter((p) => /^import (?!type )[^;]*from 'tesseract\.js'/m.test(readFileSync(p, 'utf8')));
    expect(importers).toEqual([]);
    const lazily = app.filter((p) => readFileSync(p, 'utf8').includes("import('tesseract.js')")).map((p) => relative(ROOT, p));
    expect(lazily).toEqual([join('src', 'lib', 'ratecon', 'ocr-browser.ts')]);
  });

  it('the browser engine and the shared engine are reached only through a dynamic import', () => {
    const statically = app
      .filter((p) => /^import [^;]*from '(\.\/|@\/lib\/ratecon\/)(ocr-browser|ocr-engine)'/m.test(readFileSync(p, 'utf8')))
      .map((p) => relative(ROOT, p));
    expect(statically).toEqual([join('src', 'lib', 'ratecon', 'ocr-browser.ts')]);
    const dynamically = app.filter((p) => /import\('(\.\/|@\/lib\/ratecon\/)ocr-browser'\)/.test(readFileSync(p, 'utf8'))).map((p) => relative(ROOT, p));
    expect(dynamically).toEqual([join('src', 'lib', 'ratecon', 'read-pdf.ts')]);
  });
});
