import { handleOutcome } from '@/server/ratecon-reader/handle-outcome';
import { liveReadDeps } from '@/server/ratecon-reader/live';

/**
 * What the dispatcher did with an AI read (docs/llm-reader-design.md §4):
 * counts, once per read. Off with the reader; everything it does is in
 * `handleOutcome`, which never lets an error escape.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  return handleOutcome(request, liveReadDeps());
}
