import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { serverEnv } from '@/env/server';
import { AuthError, requireRole, requireUser } from '@/lib/auth';
import { ReopenRequest } from '@/lib/reopen-load';
import {
  RateLimitError,
  clientAddress,
  enforceRateLimit,
  rateLimitResponse,
} from '@/server/rate-limit';
import { recentlyClosed, reopenLoad, ReopenError } from '@/server/reopen-load';

/**
 * §12.107 — Reopen load. GET: a truck's loads closed in the last 7 days and
 * what reopening each would do (any signed-in role: a viewer sees the list
 * with the button disabled). POST: reopen one — dispatcher and admin only,
 * checked here, whatever the page drew.
 */
export const dynamic = 'force-dynamic';

function failure(error: unknown, prefix: string, fallback: string) {
  if (error instanceof ReopenError) {
    // The load moved under the open confirm step. Nothing was written.
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof RateLimitError) return rateLimitResponse(error);
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const reference = `${prefix}-500-${Date.now().toString(36).toUpperCase()}`;
  console.error(`${prefix} failed`, {
    reference,
    error: error instanceof Error ? error.message : String(error),
  });
  return NextResponse.json({ error: fallback, reference }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    await enforceRateLimit('address', clientAddress(request));
    const user = await requireUser();
    await enforceRateLimit('read', user.id);
    const truckId = z.string().uuid().safeParse(new URL(request.url).searchParams.get('truckId'));
    if (!truckId.success) {
      return NextResponse.json({ error: 'Which truck?' }, { status: 400 });
    }
    return NextResponse.json(
      { loads: await recentlyClosed(db, truckId.data) },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error: unknown) {
    return failure(error, 'REOPEN-GET', 'Recently closed loads could not be read.');
  }
}

export async function POST(request: Request) {
  try {
    await enforceRateLimit('address', clientAddress(request));
    const user = await requireRole('dispatcher');
    await enforceRateLimit('write', user.id);
    const parsed = ReopenRequest.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Choose a load to reopen.' }, { status: 400 });
    }
    return NextResponse.json(
      await reopenLoad(db, {
        actorUserId: user.id,
        request: parsed.data,
        dispatchTz: serverEnv.DISPATCH_TZ,
      }),
    );
  } catch (error: unknown) {
    return failure(error, 'REOPEN-POST', 'Nothing was changed: the reopen failed.');
  }
}
