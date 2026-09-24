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
import { previewReassignment } from '@/server/reassign';

export const dynamic = 'force-dynamic';

const Body = z
  .object({ truckId: z.string().uuid(), driverId: z.string().uuid().nullable() })
  .strict();

/**
 * The confirm dialog renders from this, never from the client's own guess at
 * what a reassignment will do (§9.10).
 */
export async function POST(request: Request) {
  try {
    await enforceRateLimit('address', clientAddress(request));
    const user = await requireRole('dispatcher');
    await enforceRateLimit('read', user.id);
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid preview request.' }, { status: 400 });
    }
    return NextResponse.json(await previewReassignment(db, parsed.data));
  } catch (error: unknown) {
    if (error instanceof RateLimitError) return rateLimitResponse(error);
  if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const reference = `PREVIEW-500-${Date.now().toString(36).toUpperCase()}`;
    console.error('POST /api/assignments/preview failed', {
      reference,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Could not preview.', reference }, { status: 500 });
  }
}
