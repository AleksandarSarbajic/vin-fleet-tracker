import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { AuthError, requireRole, requireUser } from '@/lib/auth';
import { DriverCreate } from '@/lib/driver';
import {
  DriverError,
  createDriver,
  dismissMergeCandidate,
  linkDriver,
  openMergeCandidates,
  retireDriver,
} from '@/server/drivers';

export const dynamic = 'force-dynamic';

function failure(error: unknown, prefix: string) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof DriverError) {
    return NextResponse.json({ error: error.message, field: error.field }, { status: 400 });
  }
  const reference = `${prefix}-500-${Date.now().toString(36).toUpperCase()}`;
  console.error(`${prefix} failed`, {
    reference,
    error: error instanceof Error ? error.message : String(error),
  });
  return NextResponse.json({ error: 'The driver could not be saved.', reference }, { status: 500 });
}

/** Open merge candidates, for the prompt on the assignment board (§12.35). */
export async function GET() {
  try {
    await requireUser();
    return NextResponse.json(
      { candidates: await openMergeCandidates(db) },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error: unknown) {
    return failure(error, 'DRIVER-GET');
  }
}

/**
 * The actions, split by role (§12.35).
 *
 * CREATE is a dispatcher's job: a new hire walks in at 6am and the board has
 * to be able to hold them before an admin is awake. Gating it on admin means
 * the board cannot represent the real fleet for hours.
 *
 * LINK and RETIRE are admin-only. Linking rewrites which driver row past
 * assignments point at; retiring takes someone off the board. Both are rare,
 * both are hard to notice afterwards, and neither is urgent at 6am.
 */
const Action = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    driver: DriverCreate,
    /** §12.38: assign in the same transaction. Absent means create only. */
    truckId: z.string().uuid().optional(),
  }),
  z.object({
    action: z.literal('link'),
    appDriverId: z.string().uuid(),
    samsaraDriverId: z.string().uuid(),
  }),
  z.object({ action: z.literal('dismiss'), candidateId: z.string().uuid() }),
  z.object({
    action: z.literal('retire'),
    driverId: z.string().uuid(),
    retired: z.boolean(),
  }),
]);

export async function POST(request: Request) {
  try {
    const parsed = Action.safeParse(await request.json());
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        { error: first?.message ?? 'Invalid request.', field: first?.path.join('.') ?? '*' },
        { status: 400 },
      );
    }

    switch (parsed.data.action) {
      case 'create': {
        const user = await requireRole('dispatcher');
        const result = await createDriver(db, {
          actorUserId: user.id,
          driver: parsed.data.driver,
          ...(parsed.data.truckId !== undefined
            ? { assignToTruckId: parsed.data.truckId }
            : {}),
        });
        return NextResponse.json(result);
      }
      case 'link': {
        const user = await requireRole('admin');
        const result = await linkDriver(db, {
          actorUserId: user.id,
          appDriverId: parsed.data.appDriverId,
          samsaraDriverId: parsed.data.samsaraDriverId,
        });
        return NextResponse.json(result);
      }
      case 'dismiss': {
        // Dismissing only says "not the same person" — a dispatcher knows
        // that better than an admin does, and it destroys nothing.
        const user = await requireRole('dispatcher');
        await dismissMergeCandidate(db, {
          actorUserId: user.id,
          candidateId: parsed.data.candidateId,
        });
        return NextResponse.json({ ok: true });
      }
      case 'retire': {
        const user = await requireRole('admin');
        await retireDriver(db, {
          actorUserId: user.id,
          driverId: parsed.data.driverId,
          retired: parsed.data.retired,
        });
        return NextResponse.json({ ok: true });
      }
    }
  } catch (error: unknown) {
    return failure(error, 'DRIVER-POST');
  }
}
