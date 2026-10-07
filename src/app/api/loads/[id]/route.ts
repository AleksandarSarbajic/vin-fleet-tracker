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
import { loadForEdit } from '@/server/load-read';

/**
 * §12.117. One load, its stops and its version, for the edit modal. A read:
 * any signed-in role, viewers included. Never cached — the version is only
 * worth anything if it is the one the database holds now.
 */
export const dynamic = 'force-dynamic';

const Params = z.object({ id: z.string().uuid() });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await enforceRateLimit('address', clientAddress(request));
    const user = await requireUser();
    await enforceRateLimit('read', user.id);
    const parsed = Params.safeParse(await params);
    if (!parsed.success) {
      return NextResponse.json({ error: 'A load id is required.' }, { status: 400 });
    }
    const load = await loadForEdit(db, parsed.data.id);
    if (!load) {
      return NextResponse.json({ error: 'That load no longer exists.' }, { status: 404 });
    }
    return NextResponse.json(load, { headers: { 'cache-control': 'no-store' } });
  } catch (error: unknown) {
    if (error instanceof RateLimitError) return rateLimitResponse(error);
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const reference = `LOAD-500-${Date.now().toString(36).toUpperCase()}`;
    console.error('GET /api/loads/[id] failed', {
      reference,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Could not read the load.', reference }, { status: 500 });
  }
}
