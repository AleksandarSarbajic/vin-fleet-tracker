import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { db } from '@/db';
import { AuthError, requireRole, requireUser } from '@/lib/auth';
import {
  CreateListRequest,
  DeleteListRequest,
  PatchListRequest,
} from '@/lib/truck-lists';
import { statusConfig } from '@/server/fleet';
import {
  RateLimitError,
  clientAddress,
  enforceRateLimit,
  rateLimitResponse,
} from '@/server/rate-limit';
import {
  TruckListError,
  addToTruckList,
  createTruckList,
  deleteTruckList,
  loadTruckLists,
  updateTruckList,
} from '@/server/truck-lists';

/**
 * §12.90 — shared truck lists.
 *
 * GET for anyone signed in (a viewer reads and applies lists). POST, PATCH
 * and DELETE require `dispatcher`, which an admin outranks — and the server
 * functions check the role again, so this gate is not the only one.
 *
 * GET spends `read`, not `read.heavy`: it is two small queries, and it polls
 * every 20 s beside the fleet, which already spends `read.heavy`.
 */
export const dynamic = 'force-dynamic';

function failure(error: unknown, route: string): Response {
  if (error instanceof TruckListError) {
    return NextResponse.json(
      { error: error.message, kind: error.kind, current: error.current },
      { status: error.status },
    );
  }
  if (error instanceof RateLimitError) return rateLimitResponse(error);
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const reference = `LISTS-500-${Date.now().toString(36).toUpperCase()}`;
  console.error(`${route} /api/truck-lists failed`, {
    reference,
    error: error instanceof Error ? error.message : String(error),
  });
  return NextResponse.json(
    { error: 'The list could not be saved.', reference },
    { status: 500 },
  );
}

function invalid(error: z.ZodError): Response {
  return NextResponse.json(
    { error: error.issues[0]?.message ?? 'That request is not valid.', kind: 'invalid' },
    { status: 400 },
  );
}

export async function GET(request: Request) {
  try {
    await enforceRateLimit('address', clientAddress(request));
    const user = await requireUser();
    await enforceRateLimit('read', user.id);
    return NextResponse.json(
      { lists: await loadTruckLists(db) },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error: unknown) {
    return failure(error, 'GET');
  }
}

export async function POST(request: Request) {
  try {
    await enforceRateLimit('address', clientAddress(request));
    const user = await requireRole('dispatcher');
    await enforceRateLimit('write', user.id);
    const parsed = CreateListRequest.safeParse(await request.json());
    if (!parsed.success) return invalid(parsed.error);
    return NextResponse.json(
      await createTruckList(db, {
        actor: { id: user.id, role: user.role },
        request: parsed.data,
      }),
    );
  } catch (error: unknown) {
    return failure(error, 'POST');
  }
}

export async function PATCH(request: Request) {
  try {
    await enforceRateLimit('address', clientAddress(request));
    const user = await requireRole('dispatcher');
    await enforceRateLimit('write', user.id);
    const parsed = PatchListRequest.safeParse(await request.json());
    if (!parsed.success) return invalid(parsed.error);
    const actor = { id: user.id, role: user.role };
    return NextResponse.json(
      parsed.data.op === 'add'
        ? await addToTruckList(db, { actor, request: parsed.data })
        : await updateTruckList(db, {
            actor,
            request: parsed.data,
            dispatchTz: statusConfig.dispatchTz,
          }),
    );
  } catch (error: unknown) {
    return failure(error, 'PATCH');
  }
}

export async function DELETE(request: Request) {
  try {
    await enforceRateLimit('address', clientAddress(request));
    const user = await requireRole('dispatcher');
    await enforceRateLimit('write', user.id);
    const parsed = DeleteListRequest.safeParse(await request.json());
    if (!parsed.success) return invalid(parsed.error);
    await deleteTruckList(db, {
      actor: { id: user.id, role: user.role },
      request: parsed.data,
      dispatchTz: statusConfig.dispatchTz,
    });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return failure(error, 'DELETE');
  }
}
