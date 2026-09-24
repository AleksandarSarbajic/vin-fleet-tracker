import { NextResponse } from 'next/server';
import { db } from '@/db';
import { AppointmentTimeError } from '@/lib/appointment';
import { AuthError, requireRole } from '@/lib/auth';
import {
  RateLimitError,
  clientAddress,
  enforceRateLimit,
  rateLimitResponse,
} from '@/server/rate-limit';
import { ClearOverrideInput, OverrideInput } from '@/lib/override';
import { statusConfig } from '@/server/fleet';
import { OverrideError, clearOverride, setOverride } from '@/server/override';

export const dynamic = 'force-dynamic';

function failure(error: unknown) {
  if (error instanceof OverrideError) {
    return NextResponse.json(
      { error: error.message, fields: [{ field: error.field, message: error.message }] },
      { status: 400 },
    );
  }
  if (error instanceof AppointmentTimeError) {
    return NextResponse.json(
      { error: error.message, fields: [{ field: error.field, message: error.message }] },
      { status: 400 },
    );
  }
  if (error instanceof RateLimitError) return rateLimitResponse(error);
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const reference = `OVERRIDE-500-${Date.now().toString(36).toUpperCase()}`;
  console.error('overrides route failed', {
    reference,
    error: error instanceof Error ? error.message : String(error),
  });
  return NextResponse.json({ error: 'The override failed.', reference }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    await enforceRateLimit('address', clientAddress(request));
    // Re-checked server-side on every mutating route, whatever the UI showed.
    const user = await requireRole('dispatcher');
    await enforceRateLimit('write', user.id);
    const parsed = OverrideInput.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'The override needs a reason and an expiry.',
          fields: parsed.error.issues.map((i) => ({
            field: i.path.join('.'),
            message: i.message,
          })),
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      await setOverride(db, {
        actorUserId: user.id,
        dispatchTz: statusConfig.dispatchTz,
        override: parsed.data,
      }),
    );
  } catch (error: unknown) {
    return failure(error);
  }
}

/** `Clear now`. Returns the row to its computed status immediately. */
export async function DELETE(request: Request) {
  try {
    await enforceRateLimit('address', clientAddress(request));
    const user = await requireRole('dispatcher');
    await enforceRateLimit('write', user.id);
    const parsed = ClearOverrideInput.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
    }
    return NextResponse.json(
      await clearOverride(db, { actorUserId: user.id, clear: parsed.data }),
    );
  } catch (error: unknown) {
    return failure(error);
  }
}
