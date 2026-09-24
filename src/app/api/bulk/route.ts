import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { AppointmentTimeError } from '@/lib/appointment';
import { AuthError, requireRole } from '@/lib/auth';
import {
  RateLimitError,
  clientAddress,
  enforceRateLimit,
  rateLimitResponse,
} from '@/server/rate-limit';
import { BulkNoteInput, BulkOverrideInput } from '@/lib/override';
import { BulkError, bulkNote, bulkOverride } from '@/server/bulk';
import { statusConfig } from '@/server/fleet';
import { OverrideError } from '@/server/override';

export const dynamic = 'force-dynamic';

/**
 * §14 feature 2. One act across several stops, in one transaction.
 *
 * A discriminated union rather than two routes: the two actions share their
 * target list, their authorisation and their all-or-nothing guarantee, and
 * splitting them would invite one of the two to grow a different answer to
 * "what happens when a stop has gone".
 */
const BulkRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('override'), override: BulkOverrideInput }).strict(),
  z.object({ action: z.literal('note'), note: BulkNoteInput }).strict(),
]);

function failure(error: unknown) {
  if (error instanceof BulkError || error instanceof OverrideError) {
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
  const reference = `BULK-500-${Date.now().toString(36).toUpperCase()}`;
  console.error('bulk route failed', {
    reference,
    error: error instanceof Error ? error.message : String(error),
  });
  return NextResponse.json({ error: 'Nothing was changed.', reference }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    // Re-checked server-side on every mutating route, whatever the UI showed.
    await enforceRateLimit('address', clientAddress(request));
    const user = await requireRole('dispatcher');
    await enforceRateLimit('write', user.id);
    const parsed = BulkRequest.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'That bulk change is not complete.',
          fields: parsed.error.issues.map((i) => ({
            field: i.path.join('.'),
            message: i.message,
          })),
        },
        { status: 400 },
      );
    }

    const result =
      parsed.data.action === 'override'
        ? await bulkOverride(db, {
            actorUserId: user.id,
            dispatchTz: statusConfig.dispatchTz,
            override: parsed.data.override,
          })
        : await bulkNote(db, { actorUserId: user.id, note: parsed.data.note });

    return NextResponse.json(result);
  } catch (error: unknown) {
    return failure(error);
  }
}
