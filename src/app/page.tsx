import { redirect } from 'next/navigation';
import { Console } from '@/components/console/Console';
import { serverEnv } from '@/env/server';
import { getSessionUser } from '@/lib/auth';
import { loadFleet } from '@/server/fleet';
import { loadAssignmentBoard } from '@/server/assignments';
import { loadFleetHealth } from '@/server/health';
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
  // §14 feature 8 rides along with the prefetch for the same reason the fleet
  // does: the strip has a value on the first paint, so it never flashes empty.
  const [payload, board, health] = await Promise.all([
    loadFleet(),
    loadAssignmentBoard(db),
    loadFleetHealth(db, serverEnv.DISPATCH_TZ),
  ]);

  return (
    <Console
      initial={payload}
      initialHealth={health}
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
