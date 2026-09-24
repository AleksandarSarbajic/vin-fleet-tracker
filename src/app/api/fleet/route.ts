import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import {
  RateLimitError,
  clientAddress,
  enforceRateLimit,
  rateLimitResponse,
} from '@/server/rate-limit';
import { loadFleet } from '@/server/fleet';

/** Never cached — the console polls this for live positions. */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await enforceRateLimit('address', clientAddress(request));
    const user = await requireUser();
    // The full lateral join. Polled every 20s per open tab, so the limit sits
    // roughly seven times above normal use and still stops a runaway loop.
    await enforceRateLimit('read.heavy', user.id);
    // feedStale rides along with the fleet: one request, one consistent view.
    return NextResponse.json(await loadFleet(), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error: unknown) {
  if (error instanceof RateLimitError) return rateLimitResponse(error);
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
