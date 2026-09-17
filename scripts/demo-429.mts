/**
 * Points the REAL SamsaraClient at a local server that returns real HTTP 429s.
 * Not a mock — actual sockets, actual status codes, actual backoff sleeps.
 */
import { createServer } from 'node:http';
import { SamsaraClient } from '../src/samsara/client.ts';

let requests = 0;
let mode: '429-then-ok' | 'always-429' = '429-then-ok';

const server = createServer((req, res) => {
  requests += 1;
  const t = new Date().toISOString().slice(11, 23);
  const failFirst = mode === '429-then-ok' && requests <= 2;

  if (failFirst || mode === 'always-429') {
    console.log(`  [server ${t}] request #${requests} -> 429 Too Many Requests`);
    res.writeHead(429, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'Too many requests' }));
    return;
  }
  console.log(`  [server ${t}] request #${requests} -> 200 OK`);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      data: [{ id: '1', name: 'Truck #147', gps: [] }],
      pagination: { endCursor: 'cursor-after-recovery', hasNextPage: false },
    }),
  );
});

await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;
const baseUrl = `http://127.0.0.1:${port}`;

const log = {
  info: (m: string, f?: Record<string, unknown>) => console.log(`  [client] ${m}`, f ?? ''),
  warn: (m: string, f?: Record<string, unknown>) => console.log(`  [client] ${m}`, JSON.stringify(f)),
  error: (m: string, f?: Record<string, unknown>) => console.log(`  [client] ${m}`, JSON.stringify(f)),
};

console.log('\n=== A: two 429s, then the API recovers ===================');
console.log('(real backoff sleeps — full jitter, so the delays are random)\n');
const started = Date.now();
const client = new SamsaraClient({ token: 'test', baseUrl, logger: log });
const page = await client.vehicleStatsFeed();
console.log(`\n  RESULT: recovered. cursor="${page.endCursor}", ` +
  `${requests} requests, ${Date.now() - started}ms wall clock`);
console.log(`  breaker: ${client.breakerState}`);

console.log('\n=== B: the API stays down — breaker opens ================\n');
mode = 'always-429';
requests = 0;
const b = new SamsaraClient({
  token: 'test',
  baseUrl,
  logger: log,
  maxRetries: 1,
  backoffBaseMs: 50,
  backoffMaxMs: 100,
  breakerThreshold: 3,
  breakerCooldownMs: 60_000,
});

for (let attempt = 1; attempt <= 5; attempt += 1) {
  const before = requests;
  try {
    await b.vehicleStatsFeed();
  } catch (error: unknown) {
    const name = (error as Error).name;
    const calledOut = requests > before;
    console.log(
      `  call ${attempt}: ${name.padEnd(22)} breaker=${b.breakerState.padEnd(10)} ` +
        `network requests made: ${requests - before}` +
        (calledOut ? '' : '   <-- FAILED FAST, no traffic sent'),
    );
  }
}

console.log(`\n  RESULT: ${requests} requests reached the server across 5 calls.`);
console.log('  Once open, the breaker stops the traffic entirely until cooldown.');
server.close();
