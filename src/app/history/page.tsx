import { redirect } from 'next/navigation';
import { HistoryPage } from '@/components/history/HistoryPage';
import { db } from '@/db';
import { serverEnv } from '@/env/server';
import { getSessionUser } from '@/lib/auth';
import { currentIsoWeek, parseIsoWeek } from '@/lib/history-week';
import { loadFleet } from '@/server/fleet';
import { loadHistoryWeek } from '@/server/history';
import { loadTruckLists } from '@/server/truck-lists';

/**
 * §12.101 — /history?week=2026-W40&q=name. A record, read by any role; the
 * week on the first paint is loaded here, so the page never opens on a
 * skeleton. The fleet comes too, for the header's sync state.
 */
export const dynamic = 'force-dynamic';

const first = (v: string | string[] | undefined): string | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

export default async function HistoryRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const params = await searchParams;
  const asked = first(params['week']);
  const week = (asked ? parseIsoWeek(asked) : null) ?? currentIsoWeek(new Date(), serverEnv.DISPATCH_TZ);
  const [fleet, view, lists] = await Promise.all([
    loadFleet(),
    loadHistoryWeek(db, week, serverEnv.DISPATCH_TZ),
    // §12.104. So the Board button never goes back to a list that was deleted.
    loadTruckLists(db),
  ]);

  return (
    <HistoryPage
      initialWeek={week}
      initialView={view}
      initialQ={first(params['q']) ?? ''}
      initialFleet={fleet}
      listIds={lists.map((l) => l.id)}
      dispatchTz={serverEnv.DISPATCH_TZ}
      user={{ fullName: user.fullName, email: user.email, role: user.role }}
    />
  );
}
