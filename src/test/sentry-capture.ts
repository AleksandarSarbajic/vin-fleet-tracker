import type { NodeOptions } from '@sentry/node';
import { SENTRY_DATA_COLLECTION } from '@/lib/sentry-privacy';
import { withoutAiIntegrations } from '@/lib/sentry-reader';
import { sampleTraces } from '@/lib/sentry-sampling';
import { scrubServerEvent, textlessErrors } from '@/lib/sentry-server-errors';

/**
 * Options for starting Sentry in a test as sentry.server.config.ts starts it,
 * with a transport that keeps every envelope it would have sent (§12.142). A
 * test asserts on what would have LEFT, not on a mock's arguments.
 *
 * The config adds `textlessErrors` after starting; here it is in the list.
 * Where it sits makes no difference: it hooks in `afterAllSetup` (§12.143).
 *
 * The test file starts Sentry with these itself: sentry-privacy.test.ts counts
 * every init call outside a test file as a runtime.
 */

export interface SentEvent {
  tags?: Record<string, string>;
  exception?: {
    values?: { type?: string; value?: string; stacktrace?: { frames?: { filename?: string; lineno?: number }[] } }[];
  };
}

type Envelope = [Record<string, unknown>, [{ type: string }, SentEvent][]];

export function sentryCapture() {
  const sent: string[] = [];
  const options: NodeOptions = {
    dsn: 'https://public@o0.ingest.sentry.io/0',
    dataCollection: SENTRY_DATA_COLLECTION,
    tracesSampler: sampleTraces,
    beforeSend: scrubServerEvent,
    integrations: (defaults) => [...withoutAiIntegrations(defaults), textlessErrors()],
    transport: () => ({
      send: async (envelope) => {
        sent.push(JSON.stringify(envelope));
        return {};
      },
      flush: async () => true,
    }),
  };
  return {
    options,
    /** Every envelope, serialised as it would have gone over the wire. */
    sent,
    /** The error events among them. */
    events: (): SentEvent[] =>
      sent.flatMap((raw) =>
        (JSON.parse(raw) as Envelope)[1].filter(([header]) => header.type === 'event').map(([, event]) => event),
      ),
  };
}
