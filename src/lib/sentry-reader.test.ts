import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Sentry from '@sentry/node';
import type { ErrorEvent, Integration } from '@sentry/core';
import { afterAll, describe, expect, it } from 'vitest';
import { SENTINEL } from '@/test/model-read-fixtures';
import { SENTRY_DATA_COLLECTION } from './sentry-privacy';
import { sampleTraces } from './sentry-sampling';
import { scrubReaderEvent, withoutAiIntegrations } from './sentry-reader';

/**
 * The language-model reader's route never puts document text in front of
 * Sentry (docs/llm-reader-design.md §5). Request bodies, headers, cookies and
 * frame locals are already off for every route (sentry-privacy.ts); what is
 * left is an exception's MESSAGE, `extra`, breadcrumbs, and the AI-monitoring
 * integrations that record prompts and replies on spans.
 */

/** Case-sensitive, as integration names are: "VercelAI" and "Anthropic_AI" both end in AI. */
const AI = /AI$|GenAI|OpenAI|Anthropic|LangChain|LangGraph|Mastra|Mistral|Groq|Together/;

const routeEvent = (): ErrorEvent => ({
  type: undefined,
  transaction: 'POST /api/ratecon/read',
  message: `read failed ${SENTINEL}`,
  exception: {
    values: [{ type: 'ZodError', value: `Invalid enum value, received '${SENTINEL}'`, stacktrace: { frames: [{ function: 'POST' }] } }],
  },
  extra: { body: SENTINEL },
  request: { url: 'https://app.example/api/ratecon/read', data: SENTINEL },
  breadcrumbs: [
    { category: 'console', message: `logged ${SENTINEL}`, timestamp: 1 },
    { category: 'http', data: { url: 'https://vendor.example', body: SENTINEL }, timestamp: 2 },
  ],
});

describe('an event from the reader route', () => {
  it('carries no document text: the message, the exception value, extra, request data, breadcrumb text all go', () => {
    expect(JSON.stringify(scrubReaderEvent(routeEvent()))).not.toContain(SENTINEL);
  });

  it('keeps what finds the bug: the exception type, its stack, the transaction, the breadcrumb trail', () => {
    const out = scrubReaderEvent(routeEvent());
    expect(out.exception?.values?.[0]).toMatchObject({ type: 'ZodError', stacktrace: { frames: [{ function: 'POST' }] } });
    expect(out.transaction).toBe('POST /api/ratecon/read');
    expect(out.breadcrumbs?.map((b) => b.category)).toEqual(['console', 'http']);
  });

  it('is recognised by its URL when the transaction is not named', () => {
    const { transaction: _none, ...event } = routeEvent();
    expect(JSON.stringify(scrubReaderEvent(event))).not.toContain(SENTINEL);
  });

  it('leaves every other route\'s event as it was', () => {
    const other = { ...routeEvent(), transaction: 'POST /api/stops', request: { url: 'https://app.example/api/stops' } };
    expect(scrubReaderEvent(structuredClone(other))).toEqual(other);
  });
});

describe('AI-monitoring integrations', () => {
  const named = (names: string[]): Integration[] => names.map((name) => ({ name }));

  it('are removed, and nothing else is', () => {
    expect(withoutAiIntegrations(named(['Http', 'OpenAI', 'Anthropic_AI', 'Postgres', 'VercelAI'])).map((i) => i.name)).toEqual([
      'Http',
      'Postgres',
    ]);
  });

  it('are installed by the Sentry this repo runs, with tracing on — so the filter is not idle', () => {
    const defaults = Sentry.getDefaultIntegrations({ tracesSampler: sampleTraces }).map((i) => i.name);
    expect(defaults.filter((n) => AI.test(n)).length).toBeGreaterThan(0);
    expect(withoutAiIntegrations(Sentry.getDefaultIntegrations({ tracesSampler: sampleTraces })).map((i) => i.name).filter((n) => AI.test(n))).toEqual([]);
  });
});

describe('the server config, started for real with a transport that keeps what it is sent', () => {
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

  it('sends an error thrown in the reader route without its message', async () => {
    Sentry.withScope((scope) => {
      scope.setTransactionName('POST /api/ratecon/read');
      Sentry.addBreadcrumb({ category: 'console', message: `logged ${SENTINEL}` });
      Sentry.captureException(new Error(`boom ${SENTINEL}`));
    });
    await Sentry.flush(2000);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.join('\n')).not.toContain(SENTINEL);
  });

  it('installs no AI-monitoring integration', () => {
    const installed = Sentry.getClient()?.getOptions().integrations.map((i) => i.name) ?? [];
    expect(installed.length).toBeGreaterThan(0);
    expect(installed.filter((n) => AI.test(n))).toEqual([]);
  });

  it('is how sentry.server.config.ts starts Sentry: both hooks are wired there', () => {
    const config = readFileSync(join(import.meta.dirname, '..', '..', 'sentry.server.config.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(config).toMatch(/beforeSend:\s*scrubReaderEvent\b/);
    expect(config).toMatch(/integrations:\s*withoutAiIntegrations\b/);
  });
});
