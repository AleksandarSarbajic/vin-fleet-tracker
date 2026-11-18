import { randomBytes } from 'node:crypto';

/**
 * §12.165. A sampled parent for one request, as a `sentry-trace` header: `sampleTraces` keeps any
 * span whose parent was kept, so that request is traced every time, not 1% of the time (3bw found
 * wrong 9). The trace id is returned too, to find the request's own spans in the sink.
 */
export function sampledParent(): { traceId: string; header: string } {
  const traceId = randomBytes(16).toString('hex');
  return { traceId, header: `${traceId}-${randomBytes(8).toString('hex')}-1` };
}
