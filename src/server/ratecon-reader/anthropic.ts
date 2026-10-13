import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import {
  MODEL_INSTRUCTION,
  modelInput,
  modelReadJsonSchema,
} from '@/lib/ratecon/model-read';
import type { ReaderModel } from '@/env/schema';
import type {
  AdapterFailure,
  AdapterResult,
  AdapterUsage,
  ReaderAdapter,
  ReaderRequest,
} from './adapter';

/**
 * The language-model reader's one real vendor: Anthropic's Messages API
 * (docs/llm-reader-design.md §6; Alex, 2026-10-13/14). SERVER ONLY.
 *
 * What leaves: the shared instruction as `system`, and one user message —
 * today's date and the numbered lines (`modelInput`). No user id, no
 * metadata, no file name, no cache_control.
 *
 * What is NOT sent, on purpose: `temperature`, `top_p`, `top_k`, a forced
 * `tool_choice`, an assistant prefill. Claude Haiku 5.5 and Sonnet 5.5 answer
 * 400 to each (this corrects the design's "temperature 0"). Structured
 * outputs carry the shape instead.
 *
 * One attempt, never a retry (`maxRetries: 0`; the SDK's default is 2): a
 * retry would bill twice and the daily cap counts one read.
 *
 * Never throws, never logs. Every outcome is a code; no message from the
 * vendor or the SDK is carried out — an error's message is the vendor's
 * whole error body, and a reply can quote the document.
 */

/** Pinned, so an `ANTHROPIC_BASE_URL` in the environment cannot send the key elsewhere. */
export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

/**
 * How hard the model thinks. Thinking tokens bill as output. Constants, so
 * phase 3's evaluation can compare settings by changing one line.
 *
 * `THINKING` undefined sends no `thinking` parameter: both models then run
 * adaptive thinking, sized by `EFFORT`. Haiku 5.5 defaults to `medium`, so
 * `low` is set explicitly.
 */
export const EFFORT = 'low' satisfies NonNullable<Anthropic.OutputConfig['effort']>;
export const THINKING: Anthropic.ThinkingConfigParam | undefined = undefined;

/**
 * A ceiling on the reply, thinking included. A two-stop read is about 1,500
 * output tokens; twenty stops (the schema's most) fit too. At Sonnet 5.5's
 * $10 a million output tokens, the most one read can cost in output is 8¢.
 */
export const MAX_TOKENS = 8192;

/**
 * Where inference runs, set in code (design §6) rather than left to the
 * account default. `global` is the default and costs 1×; `us` costs 1.1×.
 * Anthropic offers no EU option.
 */
export const INFERENCE_GEO = 'global';

/** The SDK's own limit, matching the route's 25 s signal; whichever fires first, it is `timeout`. */
const CLIENT_TIMEOUT_MS = 25_000;

/**
 * The start of the 400 Anthropic sends when a spend limit the ACCOUNT set is
 * reached ("… API usage limits" or "… workspace API usage limits"; docs,
 * api/rate-limits, read 2026-10-13). Only the prefix is ever compared; the
 * message itself is never kept.
 */
const SPEND_LIMIT_PREFIX = 'You have reached your specified';

/** The 429 a TIER's monthly spend cap gives, told apart from a rate limit by this code (same page). */
const TIER_CAP_CODE = 'enforced_spend_limit_reached';

/**
 * A prepaid balance run dry — the limit Alex is likeliest to meet. Anthropic
 * documents the MESSAGE ("Your credit balance is too low to access the
 * Anthropic API. Please go to Plans & Billing to upgrade or purchase
 * credits.", about-claude/api-credits-for-subscribers, read 2026-10-14) but
 * not its HTTP status or error type, so it is matched on any 4xx. Only the
 * prefix is compared; the status still reaches the log.
 */
const CREDIT_PREFIX = 'Your credit balance is too low';

/**
 * The JSON keywords Anthropic's structured outputs accept (docs,
 * build-with-claude/structured-outputs, read 2026-10-13). Anything else is
 * dropped: `minLength`/`maxLength`, `minimum`/`maximum`, `maxItems`,
 * `pattern` and `$schema` among them. The route's `ModelRead.safeParse`
 * still enforces every one of them, so dropping them loosens nothing that
 * reaches the strip.
 *
 * Not the SDK's `transformJSONSchema`: in 0.133 it moves `enum` and `const`
 * into description text too, so the grammar would no longer pin `kind`,
 * `type`, `flag` or `schemaVersion` — all of which the API supports.
 */
const KEPT = new Set([
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
]);
const SUPPORTED_FORMATS = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'uri',
  'ipv4',
  'ipv6',
  'uuid',
]);

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** A JSON Schema, cut down to what structured outputs accept; every object closed. */
export function anthropicSchema(node: Json): Json {
  if (Array.isArray(node)) return node.map(anthropicSchema);
  if (node === null || typeof node !== 'object') return node;
  const out: { [key: string]: Json } = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'oneOf') out['anyOf'] = anthropicSchema(value);
    else if (key === 'properties' || key === '$defs') {
      // Names here are the schema's fields, not keywords: keep each, make each strict.
      out[key] = Object.fromEntries(
        Object.entries(value as { [k: string]: Json }).map(([k, v]) => [
          k,
          anthropicSchema(v),
        ]),
      );
    } else if (key === 'minItems') {
      if (value === 0 || value === 1) out[key] = value;
    } else if (key === 'format') {
      if (typeof value === 'string' && SUPPORTED_FORMATS.has(value)) out[key] = value;
    } else if (KEPT.has(key)) out[key] = anthropicSchema(value);
  }
  if (out['type'] === 'object') {
    out['additionalProperties'] = false;
    // Every property required: see OUTPUT_SCHEMA.
    out['required'] = Object.keys(
      (out['properties'] as { [k: string]: Json } | undefined) ?? {},
    );
  }
  return enumNotUnion(out);
}

/** One branch of an `anyOf` that is only a list of values: `{ type?, enum }` or `{ type: 'null' }`. */
function valuesOf(branch: Json): Json[] | null {
  if (branch === null || typeof branch !== 'object' || Array.isArray(branch)) return null;
  const keys = Object.keys(branch);
  if (keys.length === 1 && branch['type'] === 'null') return [null];
  const listed = branch['enum'];
  const typed =
    keys.length === 2 && keys.includes('type') && typeof branch['type'] === 'string';
  return Array.isArray(listed) && (keys.length === 1 || typed) ? listed : null;
}

/**
 * `anyOf: [{ enum: [...] }, { type: 'null' }]` — zod's nullable enum — as one
 * `enum` that lists `null` too. The same values; but a union is the costliest
 * thing in the grammar (docs: "exponential compilation cost"), and an enum
 * with `null` in it is not one.
 */
function enumNotUnion(node: { [key: string]: Json }): { [key: string]: Json } {
  const branches = node['anyOf'];
  if (
    !Array.isArray(branches) ||
    Object.keys(node).some((k) => k !== 'anyOf' && k !== 'description')
  )
    return node;
  const lists = branches.map(valuesOf);
  if (lists.some((l) => l === null)) return node;
  const { anyOf: _union, ...rest } = node;
  return { ...rest, enum: lists.flatMap((l) => l ?? []) };
}

/**
 * `ModelRead` as Anthropic's structured outputs accept it. Built once.
 *
 * EVERY property is required here, though `ModelRead` leaves two optional
 * (`lineEnd`, inlined with each of 12 quotes, and a range's `endQuote`).
 * As generated, the schema was refused: "The compiled grammar is too large"
 * (smoke run 2, 2026-10-14). Anthropic's docs: each optional property
 * "roughly doubles a portion of the grammar's state space", and their first
 * remedy is to make it required. The instruction says what to give when
 * there is nothing extra — `lineEnd` equal to `line`, `endQuote` the same as
 * `timeQuote` — and the verifier reads both that way already. `ModelRead`'s
 * rules, which the route parses with, are unchanged.
 *
 * And a nullable enum (the stop's `flag`) is sent as one enum listing
 * `null`, not as a union: see `enumNotUnion`.
 *
 * Neither was enough (smoke run 3: the same refusal). What was left was size:
 * the quote inlined 12 times, the cited text 5. So every part used more
 * than once is defined once, under `$defs`, and referred to (`'ref'`).
 */
export const OUTPUT_SCHEMA = anthropicSchema(modelReadJsonSchema('ref') as Json) as {
  [key: string]: unknown;
};

/** The whole request body. Exported so a test can hold every field of it. */
export function anthropicRequest(
  request: ReaderRequest,
  model: ReaderModel,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: MAX_TOKENS,
    system: MODEL_INSTRUCTION,
    messages: [{ role: 'user', content: modelInput(request.lines, request.today) }],
    output_config: {
      effort: EFFORT,
      format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
    },
    inference_geo: INFERENCE_GEO,
    ...(THINKING === undefined ? {} : { thinking: THINKING }),
  };
}

/** Every token billed: cached input counts too, though nothing here is cached. */
function usageOf(message: Anthropic.Message): AdapterUsage {
  const u = message.usage;
  return {
    inputTokens:
      u.input_tokens +
      (u.cache_creation_input_tokens ?? 0) +
      (u.cache_read_input_tokens ?? 0),
    outputTokens: u.output_tokens,
  };
}

/** The structured reply, from its text blocks (thinking blocks, when any, are skipped). */
function replyOf(message: Anthropic.Message, usage: AdapterUsage): AdapterResult {
  const fail = (code: AdapterFailure): AdapterResult => ({
    ok: false,
    code,
    vendorStatus: null,
    usage,
  });
  if (message.stop_reason === 'refusal') return fail('refused');
  // Cut off at max_tokens (or the context window), the JSON is incomplete;
  // any other stop is not a structured answer at all.
  if (message.stop_reason !== 'end_turn') return fail('malformed');
  const text = message.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('');
  try {
    return { ok: true, output: JSON.parse(text) as unknown, usage };
  } catch {
    // Not kept: a parse error quotes the text, and the text is the document's.
    return fail('malformed');
  }
}

/** A field of the vendor's error body, read without trusting its shape. */
function bodyField(body: unknown, ...path: string[]): unknown {
  let at: unknown = body;
  for (const key of path) {
    if (at === null || typeof at !== 'object') return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  return at;
}

/**
 * The account's own money is spent: a 402; a tier's 429 cap; the 400 of a
 * spend limit it set; or, on any 4xx, the documented out-of-credit message.
 */
function spendStopped(error: InstanceType<typeof Anthropic.APIError>): boolean {
  const status = error.status ?? 0;
  if (status < 400 || status > 499) return false;
  if (status === 402) return true;
  const message = bodyField(error.error, 'error', 'message');
  if (typeof message === 'string' && message.startsWith(CREDIT_PREFIX)) return true;
  if (status === 429)
    return bodyField(error.error, 'error', 'details', 'error_code') === TIER_CAP_CODE;
  return (
    status === 400 &&
    typeof message === 'string' &&
    message.startsWith(SPEND_LIMIT_PREFIX)
  );
}

/** Any error, as a code. The error's message is never read past the spend-limit and credit prefixes. */
export function failureOf(error: unknown, signal: AbortSignal): AdapterResult {
  if (
    signal.aborted ||
    error instanceof Anthropic.APIUserAbortError ||
    error instanceof Anthropic.APIConnectionTimeoutError
  ) {
    return { ok: false, code: 'timeout', vendorStatus: null };
  }
  if (error instanceof Anthropic.APIError && typeof error.status === 'number') {
    return {
      ok: false,
      code: spendStopped(error) ? 'vendor_capped' : 'unavailable',
      vendorStatus: error.status,
    };
  }
  // The network (APIConnectionError), or anything the SDK did not expect.
  return { ok: false, code: 'unavailable', vendorStatus: null };
}

export class AnthropicReaderAdapter implements ReaderAdapter {
  readonly vendor = 'anthropic';
  readonly model: ReaderModel;
  private readonly client: Anthropic;

  /** `fetch` is for tests (an injected transport, so no test reaches the network) and the smoke script's 4xx tap. */
  constructor(options: { apiKey: string; model: ReaderModel; fetch?: typeof fetch }) {
    this.model = options.model;
    this.client = new Anthropic({
      apiKey: options.apiKey,
      // Explicit, so ANTHROPIC_AUTH_TOKEN in the environment adds no second credential.
      authToken: null,
      baseURL: ANTHROPIC_BASE_URL,
      maxRetries: 0,
      timeout: CLIENT_TIMEOUT_MS,
      logLevel: 'off',
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  async read(request: ReaderRequest, signal: AbortSignal): Promise<AdapterResult> {
    if (signal.aborted) return { ok: false, code: 'timeout', vendorStatus: null };
    try {
      const message = await this.client.messages.create(
        anthropicRequest(request, this.model),
        { signal },
      );
      return replyOf(message, usageOf(message));
    } catch (error: unknown) {
      return failureOf(error, signal);
    }
  }
}
