import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { AuthError, requireRole } from '@/lib/auth';
import { setTruckActive } from '@/server/stop-edit';

export const dynamic = 'force-dynamic';

const Body = z.object({ truckId: z.string().uuid(), active: z.boolean() }).strict();

/** Only an admin may flip `trucks.active` (§12.14). There is no admin screen. */
export async function PATCH(request: Request) {
  try {
    const user = await requireRole('admin');
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
    }
    await setTruckActive(db, { actorUserId: user.id, ...parsed.data });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const reference = `TRUCK-500-${Date.now().toString(36).toUpperCase()}`;
    console.error('PATCH /api/trucks failed', {
      reference,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'The change failed.', reference }, { status: 500 });
  }
}
