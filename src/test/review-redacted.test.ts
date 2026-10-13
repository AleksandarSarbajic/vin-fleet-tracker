import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { redactedForReview } from '@/lib/ratecon/redact';
import { SENTINEL, UNKNOWN_LAYOUT, pdfLine } from '@/test/model-read-fixtures';
import { REVIEW_CSP, reviewPage, startReviewServer, type Review } from '../../scripts/ratecon-review-server.mjs';
import { sampleByNumber } from '../../scripts/ratecon-corpus.mjs';

/**
 * `npm run ratecon:review-redacted` (docs/llm-reader-design.md §8.2), tested
 * on INVENTED documents only. The real samples' pages are for Alex to read;
 * no test or tool opens one.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const model = (lines = UNKNOWN_LAYOUT) => {
  const review = redactedForReview(lines);
  return { sample: 7, template: 'not recognised', lines: review.lines, masks: review.masks };
};

const open: Review[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((r) => r.close()));
});
const serve = async (html: string, timeoutMs = 60_000, onTimeout?: () => void) => {
  const review = await startReviewServer(html, { timeoutMs, ...(onTimeout ? { onTimeout } : {}) });
  open.push(review);
  return review;
};

describe('the server', () => {
  it('binds to 127.0.0.1 only, on a port the OS chose', async () => {
    const r = await serve('<p>x</p>');
    const address = r.server.address();
    expect(address).toMatchObject({ address: '127.0.0.1', family: 'IPv4' });
    expect(r.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}$/);
  });

  it('serves the page at its random path, and nothing anywhere else', async () => {
    const r = await serve('<p>the page</p>');
    expect(await (await fetch(r.url)).text()).toBe('<p>the page</p>');
    const base = new URL(r.url).origin;
    for (const path of ['/', '/favicon.ico', `/${'0'.repeat(32)}`, `${new URL(r.url).pathname}/x`]) {
      const res = await fetch(base + path);
      expect([path, res.status, await res.text()]).toEqual([path, 404, '']);
    }
    expect((await fetch(r.url, { method: 'POST' })).status).toBe(404);
  });

  it('sends the page with a policy that refuses every outside request, and no caching', async () => {
    const res = await fetch((await serve('<p>x</p>')).url);
    expect(res.headers.get('content-security-policy')).toBe(REVIEW_CSP);
    expect(REVIEW_CSP).toContain("default-src 'none'");
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('two runs get two different paths', async () => {
    expect((await serve('a')).url).not.toBe((await serve('a')).url);
  });

  it('closes itself when its time is up', async () => {
    let timedOut = false;
    const r = await serve('<p>x</p>', 30, () => {
      timedOut = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(timedOut).toBe(true);
    expect(r.server.listening).toBe(false);
    await expect(fetch(r.url)).rejects.toThrow();
  });
});

describe('the page', () => {
  it('shows every redacted line, numbered, with its page', () => {
    const html = reviewPage(model());
    const review = redactedForReview(UNKNOWN_LAYOUT);
    for (const l of review.lines) expect(html).toContain(`<td>L${l.n}</td><td>${l.page}</td>`);
    expect(html).toContain(SENTINEL);
  });

  it('asks for nothing from outside: no script, no link, no font, no image, no URL of any kind', () => {
    const html = reviewPage(model());
    expect(html).not.toMatch(/<script|<link|<img|<iframe|<object|@import|url\(|@font-face/i);
    expect(html).not.toMatch(/https?:|\/\/[a-z0-9]|src=|href=/i);
  });

  it('escapes the text, so a document cannot inject markup', () => {
    const html = reviewPage(model([...UNKNOWN_LAYOUT, pdfLine(2, '<script>alert(1)</script> "x" & y')]));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &quot;x&quot; &amp; y');
  });

  it('highlights a line the re-scan still flags, and says the file would not be sent', () => {
    // Given as data: since the joined-line pass (3a-2) no invented line is
    // known that the masking leaves for the re-scan.
    const m = model();
    const html = reviewPage({ ...m, lines: [...m.lines, { n: m.lines.length + 1, page: 2, text: 'left over', residue: ['email'] }] });
    expect(html).toMatch(/<tr class="hit">[^\n]*<td>email<\/td><\/tr>/);
    expect(html).toContain('would NOT be sent');
  });
});

describe('which sample', () => {
  const files = ['a.pdf', 'b.pdf', 'c.pdf'];
  it.each([0, 4, -1, 1.5, Number.NaN])('an unknown number (%s) names no file, so nothing is served', (n) => {
    expect(sampleByNumber(files, n)).toBeNull();
  });
  it('a known number names its file, by name order', () => {
    expect(sampleByNumber(files, 2)).toBe('b.pdf');
  });
});

describe('the review script stays out of the app', () => {
  it('no module under src/ (tests aside) imports anything from scripts/', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
      });
    const importsScripts = /from\s+['"](?:\.\.\/)+scripts\/|from\s+['"]@\/\.\.\/scripts|import\(\s*['"](?:\.\.\/)+scripts\//;
    expect(walk(join(ROOT, 'src')).filter((f) => importsScripts.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f))).toEqual([]);
  });
});
