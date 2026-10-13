import { handleRead } from '@/server/ratecon-reader/handle-read';
import { liveReadDeps } from '@/server/ratecon-reader/live';

/**
 * The language-model reader (docs/llm-reader-design.md §4). Off unless
 * LLM_READER_ENABLED is set and a vendor is named; everything it does is in
 * `handleRead`, which never lets an error escape.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** Above the vendor call's own 25 s timeout, so the server's timeout is the one that fires. */
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  return handleRead(request, liveReadDeps());
}
