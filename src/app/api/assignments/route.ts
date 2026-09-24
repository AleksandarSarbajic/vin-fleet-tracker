import { NextResponse } from 'next/server';
import { db } from '@/db';
import { AuthError, requireRole, requireUser } from '@/lib/auth';
import {
  RateLimitError,
  clientAddress,
  enforceRateLimit,
  rateLimitResponse,
} from '@/server/rate-limit';
import { BulkAssignmentSave } from '@/lib/assignments';
import {
  AssignmentConflictError,
  loadAssignmentBoard,
  saveAssignments,
} from '@/server/assignments';

export const dynamic = 'force-dynamic';

/** Route handlers answer for themselves — a JSON client never gets HTML. */
function failure(error: unknown, prefix: string) {
  if (error instanceof RateLimitError) return rateLimitResponse(error);
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const reference = `${prefix}-500-${Date.now().toString(36).toUpperCase()}`;
  console.error(`${prefix} failed`, {
    reference,
    error: error instanceof Error ? error.message : String(error),
  });
  return NextResponse.json(
    { error: 'The assignment board could not be reached.', reference },
    { status: 500 },
  );
}

export async function GET(request: Request) {
  try {
    await enforceRateLimit('address', clientAddress(request));
    const user = await requireUser();
    await enforceRateLimit('read', user.id);
    return NextResponse.json(await loadAssignmentBoard(db), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error: unknown) {
    return failure(error, 'ASSIGN-GET');
  }
}

export async function POST(request: Request) {
  try {
    // Checked server-side on every mutating route, whatever the UI showed.
    await enforceRateLimit('address', clientAddress(request));
    const user = await requireRole('dispatcher');
    // The two-sided reassignment transaction.
    await enforceRateLimit('write', user.id);

    const parsed = BulkAssignmentSave.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid save.', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const result = await saveAssignments(db, {
      actorUserId: user.id,
      changes: parsed.data.changes,
    });
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof AssignmentConflictError) {
      // 409, with every conflict named. Nothing was written.
      return NextResponse.json({ conflicts: error.conflicts }, { status: 409 });
    }
    return failure(error, 'ASSIGN-POST');
  }
}
