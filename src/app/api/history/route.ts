import { NextResponse } from 'next/server';
import { db } from '@/db';
import { serverEnv } from '@/env/server';
import { AuthError, requireUser } from '@/lib/auth';
import { currentIsoWeek, parseIsoWeek } from '@/lib/history-week';
import { loadHistoryWeek } from '@/server/history';
import {
  RateLimitError,
  clientAddress,
  enforceRateLimit,
  rateLimitResponse,
} from '@/server/rate-limit';

/**
 * §12.101 — one week of the driver history page. Read-only and never cached.
 *
 * Any signed-in role may read it: a viewer sees exactly what a dispatcher
 * sees, and nothing on the page changes data. `read.heavy`, the timeline's
 * limit: a week is a join over loads, stops and assignments, not a lookup.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await enforceRateLimit('address', clientAddress(request));
    const user = await requireUser();
    await enforceRateLimit('read.heavy', user.id);

    const raw = new URL(request.url).searchParams.get('week');
    const week = raw === null ? currentIsoWeek(new Date(), serverEnv.DISPATCH_TZ) : parseIsoWeek(raw);
    if (!week) {
      return NextResponse.json({ error: 'A week is written like 2026-W40.' }, { status: 400 });
    }
    return NextResponse.json(await loadHistoryWeek(db, week, serverEnv.DISPATCH_TZ), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error: unknown) {
    if (error instanceof RateLimitError) return rateLimitResponse(error);
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const reference = `HISTORY-500-${Date.now().toString(36).toUpperCase()}`;
    console.error('GET /api/history failed', {
      reference,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Could not load this week.', reference }, { status: 500 });
  }
}
