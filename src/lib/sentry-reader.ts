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

export const isReaderEvent = (event: ErrorEvent) =>
  (event.transaction ?? '').includes(READER_ROUTE) || (event.request?.url ?? '').includes(READER_ROUTE);

/**
 * An event with no text in it: the exception keeps its type and stack and
 * loses its value; the message, `extra`, request data and every breadcrumb's
 * text and data go. `placeholder` stands where a value or message was.
 *
 * Shared with every other route's unexpected error
 * (src/server/route-failure.ts, §12.142), so the two cannot disagree.
 */
export function withoutText(event: ErrorEvent, placeholder: string): ErrorEvent {
  const { extra: _extra, ...rest } = event;
  const values = event.exception?.values;
  const request = event.request;
  return {
    ...rest,
    ...(event.message !== undefined ? { message: placeholder } : {}),
    ...(event.exception ? { exception: values ? { values: values.map((v) => ({ ...v, value: placeholder })) } : {} } : {}),
    ...(request ? { request: (({ data: _data, ...kept }) => kept)(request) } : {}),
    ...(event.breadcrumbs ? { breadcrumbs: event.breadcrumbs.map(({ message: _m, data: _d, ...crumb }) => crumb) } : {}),
  };
}

/** An event from the reader route, without its text; any other route's event is untouched. */
export function scrubReaderEvent(event: ErrorEvent): ErrorEvent {
  return isReaderEvent(event) ? withoutText(event, REMOVED) : event;
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
