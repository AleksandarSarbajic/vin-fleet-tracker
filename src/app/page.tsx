import { redirect } from 'next/navigation';
import { Console } from '@/components/console/Console';
import { serverEnv } from '@/env/server';
import { getSessionUser } from '@/lib/auth';
import { loadFleet } from '@/server/fleet';
import { loadAssignmentBoard } from '@/server/assignments';
import { db } from '@/db';

/** Live positions — never cached. */
export const dynamic = 'force-dynamic';

const first = (v: string | string[] | undefined): string | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

export default async function ConsolePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  // Search params are read HERE, on the server, and passed down. Reading them
  // in the client component with useSearchParams opts its whole subtree out
  // of server rendering, which threw away this prefetch entirely.
  const params = await searchParams;
  // The driver list feeds the edit modal's picker. Small, and it changes far
  // less often than positions do.
  const [payload, board] = await Promise.all([loadFleet(), loadAssignmentBoard(db)]);

  return (
    <Console
      initial={payload}
      dispatchTz={serverEnv.DISPATCH_TZ}
      user={{ fullName: user.fullName, email: user.email, role: user.role }}
      initialQuery={first(params['q']) ?? ''}
      initialTruck={first(params['truck'])}
      initialChips={(first(params['chips']) ?? '').split(',').filter(Boolean)}
      drivers={board.drivers}
      role={user.role}
    />
  );
}
