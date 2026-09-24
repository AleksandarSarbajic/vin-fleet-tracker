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
import { StopEdit } from '@/lib/stop-edit';
import { statusConfig } from '@/server/fleet';
import { saveStopEdit, StopEditError } from '@/server/stop-edit';
import { StalePreviewError } from '@/server/reassign';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    await enforceRateLimit('address', clientAddress(request));
    const user = await requireRole('dispatcher');
    // The tightest limit in the set: every save geocodes through an external
    // service and there is deliberately no cache layer to absorb a retry loop.
    await enforceRateLimit('geocode', user.id);

    const parsed = StopEdit.safeParse(await request.json());
    if (!parsed.success) {
      // Field-level errors, under their own field — never a summary banner.
      return NextResponse.json(
        {
          error: 'Some fields need attention.',
          fields: parsed.error.issues.map((i) => ({
            field: i.path.join('.'),
            message: i.message,
          })),
        },
        { status: 400 },
      );
    }

    const result = await saveStopEdit(db, {
      actorUserId: user.id,
      edit: parsed.data,
      // §12.28: the override rides along, and END_OF_DAY / UNTIL_APPT are
      // resolved against the dispatch zone, not the browser's.
      dispatchTz: statusConfig.dispatchTz,
    });
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof AppointmentTimeError) {
      // The hour does not exist at that facility on that date.
      return NextResponse.json(
        { error: error.message, fields: [{ field: 'appointment.time', message: error.message }] },
        { status: 400 },
      );
    }
    if (error instanceof StopEditError) {
      return NextResponse.json(
        { error: error.message, fields: [{ field: error.field, message: error.message }] },
        { status: 400 },
      );
    }
    if (error instanceof StalePreviewError) {
      // Someone moved the driver while the confirm dialog was open. Nothing
      // was written; the client re-opens the dialog on the fresh preview.
      return NextResponse.json(
        { error: error.message, preview: error.fresh, stalePreview: true },
        { status: 409 },
      );
    }
    if (error instanceof RateLimitError) return rateLimitResponse(error);
  if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const reference = `STOP-500-${Date.now().toString(36).toUpperCase()}`;
    console.error('POST /api/stops failed', {
      reference,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'The save failed.', reference }, { status: 500 });
  }
}
