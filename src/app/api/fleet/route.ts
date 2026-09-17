import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { loadFleet } from '@/server/fleet';

/** Never cached — the console polls this for live positions. */
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    const fleet = await loadFleet();
    return NextResponse.json(
      { fleet, fetchedAt: new Date().toISOString() },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    // Panel-level error boundaries need a reference code, not a stack.
    const reference = `FLEET-500-${Date.now().toString(36).toUpperCase()}`;
    console.error('GET /api/fleet failed', {
      reference,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Could not load the fleet.', reference },
      { status: 500 },
    );
  }
}
