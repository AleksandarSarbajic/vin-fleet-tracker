import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { Console } from '@/components/console/Console';
import { serverEnv } from '@/env/server';
import { getSessionUser } from '@/lib/auth';
import { loadFleet } from '@/server/fleet';

/** Live positions — never cached. */
export const dynamic = 'force-dynamic';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase();
}

export default async function ConsolePage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  // Server component runs the query directly, so first paint has data and
  // there is no loading flash before the first client poll.
  const fleet = await loadFleet();

  return (
    <Suspense fallback={null}>
      <Console
        initial={{ fleet, fetchedAt: new Date().toISOString() }}
        dispatchTz={serverEnv.DISPATCH_TZ}
        userInitials={initials(user.fullName)}
      />
    </Suspense>
  );
}
