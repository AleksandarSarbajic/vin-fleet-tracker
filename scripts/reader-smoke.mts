/**
 * ONE live call to Anthropic, with INVENTED text (docs/llm-reader-design.md
 * §6, phase 2b; Alex, 2026-10-13/14: at most 5 calls in the phase).
 *
 *   READER_SMOKE=yes npm run reader:smoke
 *
 * The npm script runs Node with `--env-file=.env.local`, so the key is read
 * by Node, never by hand, and only through `ReaderSmokeEnv`. It refuses
 * unless READER_SMOKE=yes and the key and an allowed model are set.
 *
 * What is sent: the invented UNKNOWN_LAYOUT fixture (src/test/
 * model-read-fixtures.ts), prepared and redacted exactly as the browser
 * would. This script reads NO file: nothing from `.samples/` can reach it.
 *
 * What is printed: the model, the outcome code, the token counts, and whether
 * the reply passes `ModelRead` and verifies against the invented text — as
 * counts. Never the reply, never a value, never the key.
 *
 * One addition, for a 4xx only: the vendor's error type and message, which
 * the adapter (rightly) never carries out. The text sent is invented, so the
 * message cannot quote a real document; the key is masked should it appear.
 * The app's path has no such tap: this is the smoke script's own transport.
 */
import { ReaderSmokeEnv, report } from '../src/env/schema.ts';
import { ModelRead } from '../src/lib/ratecon/model-read.ts';
import { prepareForReading } from '../src/lib/ratecon/redact.ts';
import { verifyRead } from '../src/lib/ratecon/verify-read.ts';
import { AnthropicReaderAdapter } from '../src/server/ratecon-reader/anthropic.ts';
import { UNKNOWN_LAYOUT } from '../src/test/model-read-fixtures.ts';

/** The route's own limit on a vendor call. */
const TIMEOUT_MS = 25_000;
const DISPATCH_TZ = 'America/Chicago';

function refuse(why: string): never {
  console.error(`reader:smoke refused: ${why}`);
  process.exit(2);
}

if (process.env.READER_SMOKE !== 'yes')
  refuse('set READER_SMOKE=yes. Each run is one paid call to Anthropic.');
const env = ReaderSmokeEnv.safeParse(process.env);
if (!env.success) refuse(`\n${report('reader smoke', env.error)}`);

const prepared = prepareForReading(UNKNOWN_LAYOUT);
if (!prepared.ok) refuse(`the invented fixture did not prepare (${prepared.reason})`);

const now = new Date();
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: DISPATCH_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(now);
/** The vendor's 4xx body, kept by this script's transport only. */
let rejected: { type: unknown; message: unknown } | null = null;
const tapped: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (response.status >= 400 && response.status < 500) {
    const raw = await response.clone().text();
    try {
      const body = JSON.parse(raw) as { error?: { type?: unknown; message?: unknown } };
      rejected = { type: body.error?.type, message: body.error?.message };
    } catch {
      // A gateway's page, not the API: say so, and how long, rather than print it.
      rejected = { type: '(not JSON)', message: `${raw.length} bytes` };
    }
  }
  return response;
};
const masked = (v: unknown) => String(v).split(env.data.LLM_READER_API_KEY).join('[KEY]');

const adapter = new AnthropicReaderAdapter({
  apiKey: env.data.LLM_READER_API_KEY,
  model: env.data.LLM_READER_MODEL,
  fetch: tapped,
});
const result = await adapter.read(
  { lines: prepared.lines.map(({ n, text }) => ({ n, text })), today },
  AbortSignal.timeout(TIMEOUT_MS),
);

console.info(`model: ${adapter.model}`);
console.info(`lines sent: ${prepared.lines.length}`);
if (!result.ok) {
  console.info(
    `outcome: ${result.code}${result.vendorStatus === null ? '' : ` (HTTP ${result.vendorStatus})`}`,
  );
  if (result.usage)
    console.info(
      `tokens: input ${result.usage.inputTokens}, output ${result.usage.outputTokens}`,
    );
  const said = rejected as { type: unknown; message: unknown } | null;
  if (said) console.info(`vendor said: ${masked(said.type)}: ${masked(said.message)}`);
  process.exitCode = 1;
} else {
  console.info('outcome: ok');
  console.info(
    `tokens: input ${result.usage.inputTokens}, output ${result.usage.outputTokens}`,
  );
  const parsed = ModelRead.safeParse(result.output);
  console.info(
    `ModelRead: ${parsed.success ? 'passes' : `fails (${parsed.error.issues.length} issues)`}`,
  );
  if (!parsed.success) {
    process.exitCode = 1;
  } else {
    const verified = verifyRead(parsed.data, prepared.lines, now);
    console.info(
      verified.ok
        ? `verified against the invented text: yes — ${verified.confirmed} values stood, ${verified.unconfirmed} did not`
        : `verified against the invented text: no — ${verified.reason}`,
    );
    if (!verified.ok) process.exitCode = 1;
  }
}
