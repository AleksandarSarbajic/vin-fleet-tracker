// §12.87. A stand-in for Sentry's ingest, for the e2e suite only.
//
// The app under test is built with its DSN pointed here, so every envelope the
// real SDK would have sent to Sentry — errors, and traces now that tracing is
// on — arrives on loopback instead, where a spec can read exactly what would
// have left the building. Held in memory and never written to disk: if the SDK
// ever did capture a cookie, this must not be the thing that persists it.
//
//   POST /<anything>/api/<project>/envelope/   ingest (gzip/deflate/br ok)
//   GET  /items                                 everything received, parsed
//   POST /reset                                 forget everything
//   GET  /health                                readiness for Playwright
//
// Plain Node, no dependencies: it runs as a Playwright webServer before the
// app, outside the TypeScript build.
import { createServer } from 'node:http';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib';

const PORT = Number(process.env.SENTRY_SINK_PORT ?? 3199);
let items = [];

function decode(buf, encoding) {
  if (encoding === 'gzip') return gunzipSync(buf);
  if (encoding === 'deflate') return inflateSync(buf);
  if (encoding === 'br') return brotliDecompressSync(buf);
  return buf;
}

/** Envelope: a header line, then (item header line, payload) pairs. */
function parseEnvelope(raw) {
  const out = [];
  let rest = raw;
  const nl = rest.indexOf('\n');
  if (nl === -1) return out;
  rest = rest.slice(nl + 1);
  while (rest.length > 0) {
    const h = rest.indexOf('\n');
    const headerText = h === -1 ? rest : rest.slice(0, h);
    if (!headerText.trim()) break;
    const header = JSON.parse(headerText);
    rest = h === -1 ? '' : rest.slice(h + 1);
    let payloadText;
    if (typeof header.length === 'number') {
      payloadText = Buffer.from(rest).subarray(0, header.length).toString();
      rest = Buffer.from(rest).subarray(header.length).toString().replace(/^\n/, '');
    } else {
      const p = rest.indexOf('\n');
      payloadText = p === -1 ? rest : rest.slice(0, p);
      rest = p === -1 ? '' : rest.slice(p + 1);
    }
    let payload;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      payload = payloadText;
    }
    out.push({ type: header.type, payload, raw: payloadText });
  }
  return out;
}

createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    if (req.method === 'GET' && req.url === '/health') return res.end('ok');
    if (req.method === 'GET' && req.url === '/items') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify(items));
    }
    if (req.method === 'POST' && req.url === '/reset') {
      items = [];
      return res.end('reset');
    }
    if (req.method === 'POST' && /\/api\/[^/]+\/envelope\/?/.test(req.url ?? '')) {
      try {
        const raw = decode(Buffer.concat(chunks), req.headers['content-encoding']).toString();
        for (const item of parseEnvelope(raw)) items.push({ ...item, receivedAt: Date.now() });
      } catch (error) {
        items.push({ type: 'sink-parse-error', payload: String(error), raw: '' });
      }
      res.setHeader('content-type', 'application/json');
      return res.end('{}');
    }
    res.statusCode = 404;
    res.end();
  });
}).listen(PORT, '127.0.0.1');
