import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { AuthError, requireUser } from '@/lib/auth';
import {
  RateLimitError,
  clientAddress,
  enforceRateLimit,
  rateLimitResponse,
} from '@/server/rate-limit';
import { unexpectedFailure } from '@/server/route-failure';
import { loadTruckTimeline } from '@/server/timeline';

/** §14 feature 15. Read-only, never cached. */
export const dynamic = 'force-dynamic';

const Query = z.object({ truck: z.string().uuid() });

export async function GET(request: Request) {
  try {
    await enforceRateLimit('address', clientAddress(request));
    const user = await requireUser();
    await enforceRateLimit('read.heavy', user.id);
    const parsed = Query.safeParse({
      truck: new URL(request.url).searchParams.get('truck'),
    });
    if (!parsed.success) {
      return NextResponse.json({ error: 'A truck id is required.' }, { status: 400 });
    }
    return NextResponse.json(
      { stops: await loadTruckTimeline(db, parsed.data.truck) },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error: unknown) {
  if (error instanceof RateLimitError) return rateLimitResponse(error);
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return unexpectedFailure(error, {
      prefix: 'TIMELINE',
      log: 'GET /api/timeline failed',
      message: 'Could not load the timeline.',
    });
  }
}
