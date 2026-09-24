import { NextResponse } from 'next/server';
import { db } from '@/db';
import { serverEnv } from '@/env/server';
import { AuthError, requireUser } from '@/lib/auth';
import {
  RateLimitError,
  clientAddress,
  enforceRateLimit,
  rateLimitResponse,
} from '@/server/rate-limit';
import { loadFleetHealth } from '@/server/health';

/**
 * §14 feature 8. Its own endpoint, not a field on `/api/fleet`.
 *
 * The fleet payload is a one-row-per-truck lateral over the present and is
 * fetched every 20 seconds; this is an aggregate over the day's history and
 * changes a handful of times per shift. Bolting it on would make every
 * console poll pay for a scan it uses once an hour.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await enforceRateLimit('address', clientAddress(request));
    const user = await requireUser();
    await enforceRateLimit('read', user.id);
    return NextResponse.json(await loadFleetHealth(db, serverEnv.DISPATCH_TZ), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error: unknown) {
  if (error instanceof RateLimitError) return rateLimitResponse(error);
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const reference = `HEALTH-500-${Date.now().toString(36).toUpperCase()}`;
    console.error('GET /api/health failed', {
      reference,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Could not load the day’s totals.', reference },
      { status: 500 },
    );
  }
}
