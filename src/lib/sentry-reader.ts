import type { ErrorEvent, Integration } from '@sentry/core';

/**
 * Keeping document text out of Sentry on the language-model reader's route
 * (docs/llm-reader-design.md §5). Used by sentry.server.config.ts.
 *
 * Request bodies, headers, cookies and frame locals are already off for every
 * route (sentry-privacy.ts). The route itself lets no error escape and gives
 * every error it makes a constant message. These are the third layer, for
 * whatever gets past both: an exception's message can quote what it was
 * given (a Zod enum error quotes the value it received), and so can `extra`,
 * a captured message or a breadcrumb.
 */

export const READER_ROUTE = '/api/ratecon/read';
const REMOVED = '[removed: the reader route never reports text]';

const isReaderEvent = (event: ErrorEvent) =>
  (event.transaction ?? '').includes(READER_ROUTE) || (event.request?.url ?? '').includes(READER_ROUTE);

/**
 * For an event from the reader route: the exception keeps its type and
 * stack and loses its value; the message, `extra`, request data and every
 * breadcrumb's text and data go. Any other route's event is untouched.
 */
export function scrubReaderEvent(event: ErrorEvent): ErrorEvent {
  if (!isReaderEvent(event)) return event;
  const { extra: _extra, ...rest } = event;
  const values = event.exception?.values;
  const request = event.request;
  return {
    ...rest,
    ...(event.message !== undefined ? { message: REMOVED } : {}),
    ...(event.exception ? { exception: values ? { values: values.map((v) => ({ ...v, value: REMOVED })) } : {} } : {}),
    ...(request ? { request: (({ data: _data, ...kept }) => kept)(request) } : {}),
    ...(event.breadcrumbs ? { breadcrumbs: event.breadcrumbs.map(({ message: _m, data: _d, ...crumb }) => crumb) } : {}),
  };
}

/**
 * Sentry's AI-monitoring integrations record prompts and replies on spans.
 * With tracing on, this Sentry installs ten of them by default (LangChain,
 * LangGraph, Mastra, VercelAI, OpenAI, Anthropic_AI, Google_GenAI, Mistral,
 * Groq, TogetherAI) — whether or not a vendor SDK is ever loaded. All go.
 */
const AI_INTEGRATION = /AI$|GenAI|OpenAI|Anthropic|LangChain|LangGraph|Mastra|Mistral|Groq|Together/;

export function withoutAiIntegrations(integrations: Integration[]): Integration[] {
  return integrations.filter((i) => !AI_INTEGRATION.test(i.name));
}
