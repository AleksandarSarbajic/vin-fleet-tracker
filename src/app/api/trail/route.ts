import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { AuthError, requireUser } from '@/lib/auth';
import { loadTrail } from '@/server/trail';

/** §14 feature 9. One truck's last half hour, never cached. */
export const dynamic = 'force-dynamic';

const Query = z.object({ truck: z.string().uuid() });

export async function GET(request: Request) {
  try {
    await requireUser();
    const parsed = Query.safeParse({
      truck: new URL(request.url).searchParams.get('truck'),
    });
    if (!parsed.success) {
      return NextResponse.json({ error: 'A truck id is required.' }, { status: 400 });
    }
    return NextResponse.json(
      { points: await loadTrail(db, parsed.data.truck) },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const reference = `TRAIL-500-${Date.now().toString(36).toUpperCase()}`;
    console.error('GET /api/trail failed', {
      reference,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Could not load the trail.', reference },
      { status: 500 },
    );
  }
}
