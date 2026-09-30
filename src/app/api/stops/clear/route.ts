import { NextResponse } from 'next/server';
import { db } from '@/db';
import { AuthError, requireRole } from '@/lib/auth';
import { ClearStopRequest } from '@/lib/clear-stop';
import {
  RateLimitError,
  clientAddress,
  enforceRateLimit,
  rateLimitResponse,
} from '@/server/rate-limit';
import { clearStop, ClearStopError } from '@/server/clear-stop';

/** §12.88 — Clear stop. Closes one load; see server/clear-stop.ts. */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    await enforceRateLimit('address', clientAddress(request));
    const user = await requireRole('dispatcher');
    await enforceRateLimit('write', user.id);

    const parsed = ClearStopRequest.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Choose which load to close, and whether it was delivered or cancelled.',
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      await clearStop(db, { actorUserId: user.id, request: parsed.data }),
    );
  } catch (error: unknown) {
    if (error instanceof ClearStopError) {
      // The load moved under the open confirm step. Nothing was written.
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof RateLimitError) return rateLimitResponse(error);
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const reference = `CLEAR-500-${Date.now().toString(36).toUpperCase()}`;
    console.error('POST /api/stops/clear failed', {
      reference,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Nothing was changed: the clear failed.', reference },
      { status: 500 },
    );
  }
}
