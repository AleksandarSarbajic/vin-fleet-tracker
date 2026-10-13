/**
 * The local page behind `npm run ratecon:review-redacted` (docs/
 * llm-reader-design.md §8.2): one sample's redacted, numbered lines, for
 * ALEX to read. A standalone script: not part of the Next app or any build;
 * nothing under src/ imports it (src/test/review-redacted.test.ts holds that).
 *
 * - Binds 127.0.0.1 only, on a port the OS picks, under a random path; every
 *   other path is an empty 404.
 * - The page is self-contained: no script, no font, no stylesheet, no image,
 *   no link out. Its Content-Security-Policy refuses any request it might
 *   still try (`default-src 'none'`).
 * - Holds the page in memory: nothing is written to disk, nothing is logged.
 * - Closes itself after `timeoutMs` (the CLI: 30 minutes).
 */
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { MaskCounts, MaskKind } from '../src/lib/ratecon/redact';

export interface ReviewModel {
  sample: number;
  template: string;
  lines: readonly { n: number; page: number | null; text: string; residue: readonly MaskKind[] }[];
  masks: MaskCounts;
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const REVIEW_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function reviewPage(model: ReviewModel): string {
  const flagged = model.lines.filter((l) => l.residue.length > 0);
  const masks = Object.entries(model.masks)
    .map(([k, v]) => `${escape(k)} ${v}`)
    .join(' · ');
  const rows = model.lines
    .map(
      (l) =>
        `<tr${l.residue.length > 0 ? ' class="hit"' : ''}><td>L${l.n}</td><td>${l.page ?? ''}</td>` +
        `<td>${escape(l.text)}</td><td>${escape(l.residue.join(', '))}</td></tr>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<title>Sample ${model.sample}: redacted</title>
<style>
  body { font: 14px/1.45 system-ui, sans-serif; margin: 24px; background: Canvas; color: CanvasText; }
  table { border-collapse: collapse; width: 100%; }
  td { border-bottom: 1px solid GrayText; padding: 3px 8px; vertical-align: top; }
  td:nth-child(3) { font-family: ui-monospace, monospace; white-space: pre-wrap; }
  tr.hit td { background: Mark; color: MarkText; }
</style>
</head>
<body>
<h1>Sample ${model.sample}: the redacted lines, as they would be sent</h1>
<p>Nothing on this page has left this machine. Template: ${escape(model.template)}. Lines: ${model.lines.length}. Masks: ${masks}.</p>
<p>${
    flagged.length === 0
      ? 'The re-scan finds nothing left over: this file could be sent.'
      : `<strong>${flagged.length} highlighted line(s)</strong> still match a detector, so this file would NOT be sent. For each: a missed redaction, or a false alarm?`
  }</p>
<p>Check what is NOT masked: names, phones, emails, rates or anything else that should not leave.</p>
<table>
<thead><tr><td>Line</td><td>Page</td><td>Text</td><td>Re-scan</td></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>
`;
}

export interface Review {
  url: string;
  server: Server;
  close: () => Promise<void>;
}

/** Serves `html` at a random path on 127.0.0.1 until closed or `timeoutMs` passes. */
export async function startReviewServer(html: string, options: { timeoutMs: number; onTimeout?: () => void }): Promise<Review> {
  const token = randomBytes(16).toString('hex');
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== `/${token}`) {
      response.writeHead(404, { 'content-length': '0' }).end();
      return;
    }
    response
      .writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': REVIEW_CSP,
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      })
      .end(html);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  let closing: Promise<void> | null = null;
  // Once only: the timeout and a Ctrl-C can both ask.
  const close = () =>
    (closing ??= new Promise<void>((resolve, reject) => {
      clearTimeout(timer);
      server.closeAllConnections();
      server.close((error) => (error ? reject(error) : resolve()));
    }));
  const timer = setTimeout(() => {
    void close().then(options.onTimeout, options.onTimeout);
  }, options.timeoutMs);
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/${token}`, server, close };
}
