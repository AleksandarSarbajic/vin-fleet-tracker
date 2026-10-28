import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { AuthError, requireRole } from '@/lib/auth';
import {
  RateLimitError,
  clientAddress,
  enforceRateLimit,
  rateLimitResponse,
} from '@/server/rate-limit';
import { unexpectedFailure } from '@/server/route-failure';
import { setTruckActive } from '@/server/stop-edit';

export const dynamic = 'force-dynamic';

const Body = z.object({ truckId: z.string().uuid(), active: z.boolean() }).strict();

/** Only an admin may flip `trucks.active` (§12.14). There is no admin screen. */
export async function PATCH(request: Request) {
  try {
    await enforceRateLimit('address', clientAddress(request));
    const user = await requireRole('admin');
    await enforceRateLimit('write', user.id);
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
    }
    await setTruckActive(db, { actorUserId: user.id, ...parsed.data });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    if (error instanceof RateLimitError) return rateLimitResponse(error);
  if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return unexpectedFailure(error, {
      prefix: 'TRUCK',
      log: 'PATCH /api/trucks failed',
      message: 'The change failed.',
    });
  }
}
