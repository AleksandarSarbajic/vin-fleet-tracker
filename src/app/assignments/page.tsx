import { redirect } from 'next/navigation';
import { AssignmentBoard } from '@/components/assignments/AssignmentBoard';
import { db } from '@/db';
import { getSessionUser } from '@/lib/auth';
import { loadAssignmentBoard } from '@/server/assignments';

/** The mapping changes under you; never cached. */
export const dynamic = 'force-dynamic';

export default async function AssignmentsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const board = await loadAssignmentBoard(db);

  // A viewer sees the board with every control disabled and a tooltip saying
  // why — never hidden (§12.14). Hidden controls make people think the app is
  // broken. The role is enforced again on the route that writes.
  return <AssignmentBoard board={board} role={user.role} />;
}
