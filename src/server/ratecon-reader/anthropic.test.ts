import * as Sentry from '@sentry/node';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import {
  MODEL_INSTRUCTION,
  ModelRead,
  modelInput,
  modelReadJsonSchema,
} from '@/lib/ratecon/model-read';
import { prepareForReading } from '@/lib/ratecon/redact';
import { SENTRY_DATA_COLLECTION } from '@/lib/sentry-privacy';
import { scrubReaderEvent, withoutAiIntegrations } from '@/lib/sentry-reader';
import { sampleTraces } from '@/lib/sentry-sampling';
import { MODEL_REPLY, SENTINEL, UNKNOWN_LAYOUT } from '@/test/model-read-fixtures';

/**
 * The Anthropic adapter (docs/llm-reader-design.md §6, phase 2b) through an
 * INJECTED transport: a `fetch` that records what the SDK would have sent and
 * answers as the API would. No test here reaches the network — and guard 4
 * (vitest.setup.ts) would refuse it if one tried.
 *
 * The key is invented. Every vendor error body below carries the key and the
 * sentinel, as a hostile or careless body could, and no test lets either reach
 * a result, a console call or a Sentry envelope.
 */

vi.mock('server-only', () => ({}));

const {
  AnthropicReaderAdapter,
  EFFORT,
  INFERENCE_GEO,
  MAX_TOKENS,
  OUTPUT_SCHEMA,
  THINKING,
  anthropicRequest,
  anthropicSchema,
} = await import('./anthropic');

const KEY = 'sk-ant-api03-INVENTED-test-key-0000000000000000';
const MODEL = 'claude-haiku-5-5';

const prepared = (() => {
  const p = prepareForReading(UNKNOWN_LAYOUT);
  if (!p.ok) throw new Error(p.reason);
  return p;
})();
const REQUEST = {
  lines: prepared.lines.map(({ n, text }) => ({ n, text })),
  today: '2026-10-13',
};

interface Sent {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

type Answer = Response | 'network' | 'hang';

/** A `fetch` that keeps every request and plays its answers in order. */
function transport(...answers: Answer[]) {
  const sent: Sent[] = [];
  const fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    sent.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const answer = answers.shift() ?? 'network';
    if (answer === 'network') throw new TypeError(`fetch failed ${SENTINEL} ${KEY}`);
    if (answer === 'hang') {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException(`aborted ${SENTINEL}`, 'AbortError')),
          { once: true },
        );
      });
    }
    return answer;
  }) as typeof globalThis.fetch;
  return { sent, fetch };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'request-id': 'req_invented' },
  });

const message = (
  over: { text?: string; stop_reason?: string; content?: unknown[] } = {},
) =>
  json(200, {
    id: 'msg_invented',
    type: 'message',
    role: 'assistant',
    model: MODEL,
    content: over.content ?? [
      { type: 'text', text: over.text ?? JSON.stringify(MODEL_REPLY) },
    ],
    stop_reason: over.stop_reason ?? 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 3100,
      output_tokens: 620,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  });

/** The vendor's error body, carrying what must never come back out. */
const vendorError = (
  status: number,
  type: string,
  text: string,
  details?: Record<string, unknown>,
) =>
  json(status, {
    type: 'error',
    error: {
      type,
      message: `${text} ${SENTINEL} ${KEY}`,
      ...(details ? { details } : {}),
    },
    request_id: 'req_invented',
  });

const adapter = (fetch: typeof globalThis.fetch) =>
  new AnthropicReaderAdapter({ apiKey: KEY, model: MODEL, fetch });
const read = (fetch: typeof globalThis.fetch, signal = new AbortController().signal) =>
  adapter(fetch).read(REQUEST, signal);

let consoleSpies: MockInstance[] = [];
beforeEach(() => {
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined),
  );
});
afterEach(() => {
  const said = JSON.stringify(consoleSpies.flatMap((s) => s.mock.calls));
  for (const s of consoleSpies) s.mockRestore();
  // The adapter never logs at all — so neither the key nor a line can be in a log.
  expect(said).toBe('[]');
});

describe('the request: what leaves, and what does not', () => {
  it('one POST to api.anthropic.com/v1/messages, the key in x-api-key and nowhere else', async () => {
    const { sent, fetch } = transport(message());
    await read(fetch);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(sent[0]!.headers.get('x-api-key')).toBe(KEY);
    expect(sent[0]!.headers.get('authorization')).toBeNull();
    expect(JSON.stringify(sent[0]!.body)).not.toContain(KEY);
  });

  it('the body holds exactly: the model, the token ceiling, the instruction, one user message, the output config, the region', async () => {
    const { sent, fetch } = transport(message());
    await read(fetch);
    const body = sent[0]!.body;
    expect(Object.keys(body).sort()).toEqual([
      'inference_geo',
      'max_tokens',
      'messages',
      'model',
      'output_config',
      'system',
    ]);
    expect(body).toEqual({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: MODEL_INSTRUCTION,
      messages: [{ role: 'user', content: modelInput(REQUEST.lines, REQUEST.today) }],
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
      },
      inference_geo: 'global',
    });
  });

  it('sends none of what these models refuse, nor anything that identifies a user or a file', async () => {
    const { sent, fetch } = transport(message());
    await read(fetch);
    const body = sent[0]!.body;
    for (const key of [
      'temperature',
      'top_p',
      'top_k',
      'tool_choice',
      'tools',
      'thinking',
      'metadata',
      'stop_sequences',
      'cache_control',
      'container',
    ]) {
      expect(body, key).not.toHaveProperty(key);
    }
    expect(JSON.stringify(body)).not.toContain('cache_control');
    // No assistant prefill: the one message is the user's.
    expect((body.messages as { role: string }[]).map((m) => m.role)).toEqual(['user']);
  });

  it('effort low and no thinking parameter are constants, bounded tokens, the region named', () => {
    expect([EFFORT, THINKING, INFERENCE_GEO]).toEqual(['low', undefined, 'global']);
    expect(MAX_TOKENS).toBeGreaterThan(0);
    expect(MAX_TOKENS).toBeLessThanOrEqual(8192);
  });

  it('sends only n and text of each line — never a page — and today', () => {
    const withPages = { lines: prepared.lines, today: '2026-10-13' };
    expect(anthropicRequest(withPages, MODEL).messages).toEqual(
      anthropicRequest(REQUEST, MODEL).messages,
    );
    expect(JSON.stringify(anthropicRequest(withPages, MODEL))).not.toContain('"page"');
  });

  it('the model is the one it was given: Sonnet 5.5 when the env says so', async () => {
    const { sent, fetch } = transport(message());
    await new AnthropicReaderAdapter({
      apiKey: KEY,
      model: 'claude-sonnet-5-5',
      fetch,
    }).read(REQUEST, new AbortController().signal);
    expect(sent[0]!.body.model).toBe('claude-sonnet-5-5');
  });

  it('never retries: a 529, a 429 and a 500 are each one call', async () => {
    for (const [status, type] of [
      [529, 'overloaded_error'],
      [429, 'rate_limit_error'],
      [500, 'api_error'],
    ] as const) {
      const { sent, fetch } = transport(
        vendorError(status, type, 'try again'),
        message(),
      );
      await read(fetch);
      expect(sent, String(status)).toHaveLength(1);
    }
  });

  it('a signal already aborted sends nothing', async () => {
    const { sent, fetch } = transport(message());
    const gone = new AbortController();
    gone.abort();
    expect(await read(fetch, gone.signal)).toEqual({
      ok: false,
      code: 'timeout',
      vendorStatus: null,
    });
    expect(sent).toHaveLength(0);
  });
});

describe('the reply, as a result', () => {
  it('a structured answer: its JSON, and the tokens billed', async () => {
    const { fetch } = transport(message());
    expect(await read(fetch)).toEqual({
      ok: true,
      output: MODEL_REPLY,
      usage: { inputTokens: 3100, outputTokens: 620 },
    });
  });

  it('thinking blocks before the answer are skipped', async () => {
    const { fetch } = transport(
      message({
        content: [
          { type: 'thinking', thinking: '', signature: 'sig' },
          { type: 'text', text: JSON.stringify(MODEL_REPLY) },
        ],
      }),
    );
    expect(await read(fetch)).toMatchObject({ ok: true, output: MODEL_REPLY });
  });

  it.each([
    ['a refusal', 'refusal', JSON.stringify(MODEL_REPLY), 'refused'],
    [
      'cut off at max_tokens',
      'max_tokens',
      JSON.stringify(MODEL_REPLY).slice(0, 80),
      'malformed',
    ],
    [
      'cut off at the context window',
      'model_context_window_exceeded',
      '{"schemaVersion":1',
      'malformed',
    ],
    [
      'a tool call, which nothing asked for',
      'tool_use',
      JSON.stringify(MODEL_REPLY),
      'malformed',
    ],
    ['not JSON at all', 'end_turn', `Here is the load ${SENTINEL}`, 'malformed'],
  ] as const)(
    '%s: %s — the tokens still counted, nothing of the reply returned',
    async (_, stop_reason, text, code) => {
      const { fetch } = transport(message({ stop_reason, text }));
      const result = await read(fetch);
      expect(result).toEqual({
        ok: false,
        code,
        vendorStatus: null,
        usage: { inputTokens: 3100, outputTokens: 620 },
      });
    },
  );
});

describe('every vendor failure is one fixed code, and carries neither the key nor the text', () => {
  it.each([
    [
      '401 bad key',
      'unavailable',
      401,
      vendorError(401, 'authentication_error', 'invalid x-api-key'),
    ],
    [
      '403 not permitted',
      'unavailable',
      403,
      vendorError(403, 'permission_error', 'not allowed'),
    ],
    [
      '404 no such model',
      'unavailable',
      404,
      vendorError(404, 'not_found_error', 'model: claude-haiku-5-5'),
    ],
    [
      '429 rate limit',
      'unavailable',
      429,
      vendorError(
        429,
        'rate_limit_error',
        'Number of requests has exceeded your rate limit',
      ),
    ],
    ['500', 'unavailable', 500, vendorError(500, 'api_error', 'Internal server error')],
    [
      '529 overloaded',
      'unavailable',
      529,
      vendorError(529, 'overloaded_error', 'Overloaded'),
    ],
    [
      '400, any other',
      'unavailable',
      400,
      vendorError(400, 'invalid_request_error', 'max_tokens: too large'),
    ],
    [
      '400, the account’s own spend limit',
      'vendor_capped',
      400,
      vendorError(
        400,
        'invalid_request_error',
        'You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.',
      ),
    ],
    [
      '400, a workspace’s own spend limit',
      'vendor_capped',
      400,
      vendorError(
        400,
        'invalid_request_error',
        'You have reached your specified workspace API usage limits.',
      ),
    ],
    [
      '429, the tier’s monthly spend cap',
      'vendor_capped',
      429,
      vendorError(429, 'rate_limit_error', 'You have reached your API usage limits', {
        error_code: 'enforced_spend_limit_reached',
      }),
    ],
    [
      '402 billing',
      'vendor_capped',
      402,
      vendorError(402, 'billing_error', 'payment method declined'),
    ],
    [
      'a gateway page, not JSON',
      'unavailable',
      502,
      new Response(`<html>${SENTINEL} ${KEY}</html>`, { status: 502 }),
    ],
  ] as const)('%s: %s', async (_, code, vendorStatus, answer) => {
    const { fetch } = transport(answer);
    const result = await read(fetch);
    expect(result).toEqual({ ok: false, code, vendorStatus });
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('"You have reached your specified" only counts at the start of a 400', async () => {
    const { fetch } = transport(
      vendorError(
        400,
        'invalid_request_error',
        'quoted: You have reached your specified limit',
      ),
    );
    expect(await read(fetch)).toEqual({
      ok: false,
      code: 'unavailable',
      vendorStatus: 400,
    });
  });

  it('the network failing: unavailable, no status', async () => {
    const { fetch } = transport('network');
    expect(await read(fetch)).toEqual({
      ok: false,
      code: 'unavailable',
      vendorStatus: null,
    });
  });

  it('the signal firing mid-call (the route’s 25 s, or Cancel): timeout — the route tells Cancel apart', async () => {
    const { fetch } = transport('hang');
    const signal = AbortSignal.timeout(30);
    expect(await read(fetch, signal)).toEqual({
      ok: false,
      code: 'timeout',
      vendorStatus: null,
    });
  });
});

describe('the schema Anthropic is given', () => {
  /** Every keyword used anywhere, and every object, from a JSON Schema. */
  const walk = (node: unknown, keys: Set<string>, objects: Record<string, unknown>[]) => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, keys, objects));
    if (node === null || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    if (o.type === 'object') objects.push(o);
    for (const [k, v] of Object.entries(o)) {
      if (k === 'properties' || k === '$defs') {
        for (const p of Object.values(v as Record<string, unknown>))
          walk(p, keys, objects);
      } else {
        keys.add(k);
        walk(v, keys, objects);
      }
    }
  };
  const keys = new Set<string>();
  const objects: Record<string, unknown>[] = [];
  walk(OUTPUT_SCHEMA, keys, objects);

  it('uses only keywords the API documents as supported — no oneOf, no length or number bounds', () => {
    const supported = new Set([
      'type',
      'properties',
      'required',
      'additionalProperties',
      'items',
      'anyOf',
      'allOf',
      'enum',
      'const',
      'description',
      'title',
      'default',
      '$ref',
      '$defs',
      'minItems',
      'format',
    ]);
    expect([...keys].filter((k) => !supported.has(k))).toEqual([]);
    expect(keys.has('oneOf')).toBe(false);
  });

  it('keeps what pins the shape: the discriminator, the stop types, the flag, the version', () => {
    const text = JSON.stringify(OUTPUT_SCHEMA);
    for (const kind of ['none', 'exact', 'range', 'unclear'])
      expect(text).toContain(`"const":"${kind}"`);
    expect(text).toContain('"enum":["PU","DEL"]');
    expect(text).toContain('"const":1');
  });

  it('closes every object, as structured outputs require', () => {
    expect(objects.length).toBeGreaterThan(5);
    expect(objects.filter((o) => o.additionalProperties !== false)).toEqual([]);
  });

  it('sends the nullable flag as one enum listing null, not as a union — the same values', () => {
    const text = JSON.stringify(OUTPUT_SCHEMA);
    expect(text).toMatch(/"flag":\{"\$ref":"#\/\$defs\/(\w+)"\}/);
    const flagDef = /"flag":\{"\$ref":"#\/\$defs\/(\w+)"\}/.exec(text)![1]!;
    expect((OUTPUT_SCHEMA.$defs as Record<string, unknown>)[flagDef]).toEqual({
      enum: ['APPT', 'FCFS', null],
    });
    expect(
      anthropicSchema({ anyOf: [{ type: 'string', enum: ['A'] }, { type: 'null' }] }),
    ).toEqual({ enum: ['A', null] });
    // A nullable OBJECT stays a union: it is not a list of values.
    const obj = { anyOf: [{ type: 'object', properties: {} }, { type: 'null' }] };
    expect(anthropicSchema(obj)).toEqual({
      anyOf: [
        { type: 'object', properties: {}, additionalProperties: false, required: [] },
        { type: 'null' },
      ],
    });
  });

  it('leaves no property optional — the grammar was too large with them (smoke run 2)', () => {
    const optional = objects.flatMap((o) => {
      const required = new Set((o.required as string[] | undefined) ?? []);
      return Object.keys(
        (o.properties as Record<string, unknown> | undefined) ?? {},
      ).filter((p) => !required.has(p));
    });
    expect(optional).toEqual([]);
  });

  it('what a required lineEnd and endQuote produce still parses: the route is unchanged', () => {
    const appointment = MODEL_REPLY.stops[0]!.appointment;
    if (appointment.kind !== 'range') throw new Error('the fixture changed');
    const full = {
      ...MODEL_REPLY,
      loadNumber: {
        ...MODEL_REPLY.loadNumber!,
        quote: { ...MODEL_REPLY.loadNumber!.quote, lineEnd: 2 },
      },
      stops: [
        {
          ...MODEL_REPLY.stops[0]!,
          appointment: { ...appointment, endQuote: appointment.timeQuote },
        },
        MODEL_REPLY.stops[1]!,
      ],
    };
    expect(ModelRead.safeParse(full).success).toBe(true);
  });

  it('keeps minItems only as 0 or 1', () => {
    expect(JSON.stringify(OUTPUT_SCHEMA)).not.toMatch(/"minItems":(?![01][,}])/);
  });

  it('stays inside the documented compile limits: 24 optional parameters, 16 unions', () => {
    const optional = objects.reduce((n, o) => {
      const required = new Set((o.required as string[] | undefined) ?? []);
      return (
        n +
        Object.keys((o.properties as Record<string, unknown> | undefined) ?? {}).filter(
          (p) => !required.has(p),
        ).length
      );
    }, 0);
    const unions =
      (JSON.stringify(OUTPUT_SCHEMA).match(/"anyOf"/g) ?? []).length +
      (JSON.stringify(OUTPUT_SCHEMA).match(/"type":\[/g) ?? []).length;
    expect(optional).toBeLessThanOrEqual(24);
    expect(unions).toBeLessThanOrEqual(16);
  });

  it('defines each part used more than once a single time and refers to it — the quote and the cited text above all (smoke run 3)', () => {
    const text = JSON.stringify(OUTPUT_SCHEMA);
    const defs = OUTPUT_SCHEMA.$defs as Record<string, unknown>;
    const quoteDef = Object.entries(defs).find(([, d]) =>
      JSON.stringify(d).includes('"lineEnd"'),
    )?.[0];
    expect(quoteDef).toBeDefined();
    expect((text.match(/"lineEnd":/g) ?? []).length).toBe(1);
    // 8 references reach it 12 ways: the five cited texts share one, through their own definition.
    expect((text.match(new RegExp(`"#/\\$defs/${quoteDef}"`, 'g')) ?? []).length).toBe(8);
    // Every reference points at a definition that exists.
    for (const [, name] of text.matchAll(/"#\/\$defs\/(\w+)"/g))
      expect(defs, name).toHaveProperty(name!);
  });

  it('turns a oneOf into an anyOf, should zod ever emit one for the discriminated union', () => {
    const converted = anthropicSchema({
      type: 'object',
      properties: { a: { oneOf: [{ type: 'string' }, { type: 'null' }] } },
    });
    expect(converted).toEqual({
      type: 'object',
      properties: { a: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
      additionalProperties: false,
      required: ['a'],
    });
  });

  it('loosens nothing that reaches the strip: the route still parses with ModelRead, which keeps every bound', () => {
    expect(JSON.stringify(modelReadJsonSchema())).toContain('maxLength');
    expect(ModelRead.safeParse({ ...MODEL_REPLY, stops: [] }).success).toBe(false);
  });
});

describe('nothing the adapter does puts the key or the text in a Sentry envelope', () => {
  const sent: string[] = [];
  Sentry.init({
    dsn: 'https://public@o0.ingest.sentry.io/0',
    dataCollection: SENTRY_DATA_COLLECTION,
    tracesSampler: sampleTraces,
    beforeSend: scrubReaderEvent,
    integrations: withoutAiIntegrations,
    transport: () => ({
      send: async (envelope) => {
        sent.push(JSON.stringify(envelope));
        return {};
      },
      flush: async () => true,
    }),
  });
  afterAll(() => Sentry.close());

  it('after a success, every failure and a refusal, an event from ANOTHER route (so nothing is scrubbed) carries neither', async () => {
    const answers: Answer[] = [
      message(),
      message({ stop_reason: 'refusal' }),
      vendorError(
        400,
        'invalid_request_error',
        'You have reached your specified API usage limits.',
      ),
      vendorError(401, 'authentication_error', 'invalid x-api-key'),
      vendorError(529, 'overloaded_error', 'Overloaded'),
      'network',
    ];
    for (const answer of answers) await read(transport(answer).fetch);
    Sentry.withScope((scope) => {
      scope.setTransactionName('POST /api/stops');
      Sentry.captureException(new Error('probe'));
    });
    await Sentry.flush(2000);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.join('\n')).toContain('probe');
    expect(sent.join('\n')).not.toContain(SENTINEL);
    expect(sent.join('\n')).not.toContain(KEY);
  });
});
