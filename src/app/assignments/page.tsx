import { redirect } from 'next/navigation';
import { AssignmentBoard } from '@/components/assignments/AssignmentBoard';
import { db } from '@/db';
import { getSessionUser } from '@/lib/auth';
import { loadAssignmentBoard } from '@/server/assignments';
import { loadFleet } from '@/server/fleet';

/** The mapping changes under you; never cached. */
export const dynamic = 'force-dynamic';

export default async function AssignmentsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  // §12.145. The fleet the console loads, for the board's Currently column:
  // painted on the first render, then polled by the console's own hook.
  const [board, fleet] = await Promise.all([loadAssignmentBoard(db), loadFleet()]);

  // A viewer sees the board without its edit controls and a "View only"
  // badge saying why (§12.141, which departs from §12.14 on this page). The
  // role is enforced again on the route that writes.
  return <AssignmentBoard board={board} role={user.role} initialFleet={fleet} />;
}
