import { NextResponse } from 'next/server';
import { db } from '@/db';
import { AuthError, requireRole } from '@/lib/auth';
import {
  RateLimitError,
  clientAddress,
  enforceRateLimit,
  rateLimitResponse,
} from '@/server/rate-limit';
import { unexpectedFailure } from '@/server/route-failure';
import { pastAddresses } from '@/server/stop-addresses';

/**
 * §12.164, phase 3bx (QoL 2). `GET /api/stops/addresses`: the company's own past stop addresses,
 * newest first, at most `PAST_ADDRESS_CAP`, for Street address to suggest from. Read-only.
 *
 * Dispatcher or admin: the suggestions are for entering a stop, which a viewer cannot do, and
 * the route asks itself (`requireRole`), never trusting the window not to call it. On the pooler,
 * as every route handler is (`@/db`). RLS is unchanged: no policy was added or widened. Never
 * cached: the window fetches it once as it opens and filters in the browser.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await enforceRateLimit('address', clientAddress(request));
    const user = await requireRole('dispatcher');
    await enforceRateLimit('read', user.id);
    return NextResponse.json(
      { addresses: await pastAddresses(db) },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error: unknown) {
    if (error instanceof RateLimitError) return rateLimitResponse(error);
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return unexpectedFailure(error, {
      prefix: 'ADDRESSES',
      log: 'GET /api/stops/addresses failed',
      message: 'Past addresses could not be read.',
    });
  }
}
